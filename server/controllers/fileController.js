const path = require('path');
const fs = require('fs');
const Drawing = require('../models/Drawing');
const { uploadToS3, deleteFromS3, getDataFromS3 } = require('../config/s3');
const { parseDxfFile } = require('../services/dxfParser');
const { parseDwgFile } = require('../services/converter');
const { parseProjectionDetails } = require('../services/geoExtractor');

/**
 * POST /api/files/upload
 * Upload a DWG or DXF file
 */
const uploadFile = async (req, res) => {
  try {
    const mainFile = req.files && req.files['file'] ? req.files['file'][0] : null;
    const prjFile = req.files && req.files['prj'] ? req.files['prj'][0] : null;

    if (!mainFile) {
      return res.status(400).json({ error: 'No CAD file uploaded' });
    }

    const { originalname, buffer, size } = mainFile;
    const ext = originalname.split('.').pop().toLowerCase();
    
    let prjText = null;
    if (prjFile) {
      prjText = prjFile.buffer.toString('utf-8');
      console.log(`[Server Log] 📄 Received sidecar .prj file: ${prjFile.originalname}`);
    }

    console.log(`[Server Log] 📥 Received upload request for file: ${originalname} (${size} bytes)`);

    // Create drawing record
    const drawing = new Drawing({
      originalName: originalname,
      fileType: ext,
      fileSize: size,
      status: 'uploaded',
    });

    await drawing.save();

    // Process based on file type
    if (ext === 'dxf') {
      console.log(`[Server Log] ⚙️ Processing DXF file...`);
      await processDxfFile(drawing, buffer, prjText);
    } else if (ext === 'dwg') {
      console.log(`[Server Log] ⚙️ Processing DWG file...`);
      await processDwgFile(drawing, buffer, originalname, prjText);
    } else {
      console.warn(`[Server Log] ⚠️ Unsupported file extension: ${ext}`);
    }

    res.status(201).json({
      message: 'File uploaded and processed successfully',
      drawing: {
        id: drawing._id,
        originalName: drawing.originalName,
        fileType: drawing.fileType,
        status: drawing.status,
        metadata: drawing.metadata,
      },
    });
  } catch (error) {
    console.error(`[Server Log] ❌ Upload error:`, error);
    res.status(500).json({ error: error.message || 'File upload failed' });
  }
};

/**
 * Process a DXF file: parse and store
 */
const processDxfFile = async (drawing, buffer, prjText = null) => {
  try {
    console.log(`[Server Log] 🛠️ Starting DXF parsing for ${drawing.originalName}`);
    const parsedData = parseDxfFile(buffer);
    console.log(`[Server Log] ✅ DXF parsing complete. Extracted ${parsedData.entityCount} entities and ${parsedData.layers.length} layers.`);

    // Instead of storing parsedData in Mongo, we upload it to S3 as JSON
    const jsonS3Key = `drawings/json/${drawing._id}/data.json`;
    console.log(`[Server Log] ☁️ Uploading parsed JSON to S3...`);
    const jsonBuffer = Buffer.from(JSON.stringify(parsedData));
    await uploadToS3(jsonBuffer, jsonS3Key, 'application/json');
    drawing.jsonS3Key = jsonS3Key;

    drawing.status = 'ready';
    drawing.metadata = {
      layers: parsedData.layers.map((l) => l.name),
      entityCount: parsedData.entityCount,
      bounds: parsedData.bounds,
    };
    if (parsedData.geolocation) {
      drawing.metadata.geolocation = parsedData.geolocation;
    }
    
    // Override projection details if a .prj sidecar file was provided
    if (prjText) {
      if (!drawing.metadata.geolocation) drawing.metadata.geolocation = {};
      drawing.metadata.geolocation.source = 'SIDECAR_PRJ';
      drawing.metadata.geolocation.projectionDetails = parseProjectionDetails(prjText);
      console.log(`[Server Log] ✅ Applied exact projection metadata from sidecar .prj file`);
    }

    // Upload to S3 for persistence
    const s3Key = `drawings/dxf/${drawing._id}/${drawing.originalName}`;
    try {
      console.log(`[Server Log] ☁️ Uploading DXF to S3...`);
      await uploadToS3(buffer, s3Key, 'application/dxf');
      drawing.s3Key = s3Key;
      console.log(`[Server Log] ✅ S3 upload successful: ${s3Key}`);
    } catch (s3Err) {
      console.warn(`[Server Log] ⚠️ S3 upload failed:`, s3Err.message);
    }

    // Override projection details if a .prj sidecar file was provided
    if (prjText) {
      if (!drawing.metadata.geolocation) drawing.metadata.geolocation = {};
      drawing.metadata.geolocation.source = 'SIDECAR_PRJ';
      drawing.metadata.geolocation.projectionDetails = parseProjectionDetails(prjText);
      console.log(`[Server Log] ✅ Applied exact projection metadata from sidecar .prj file`);
    }

    await drawing.save();
  } catch (err) {
    drawing.status = 'error';
    drawing.errorMessage = err.message;
    await drawing.save();
    throw err;
  }
};

/**
 * Process a DWG file: upload to S3, then parse directly with WASM
 */
const processDwgFile = async (drawing, buffer, originalName, prjText = null) => {
  try {
    // Step 1: Upload DWG to S3
    const s3Key = `drawings/dwg/${drawing._id}/${originalName}`;
    try {
      console.log(`[Server Log] ☁️ Uploading DWG to S3...`);
      await uploadToS3(buffer, s3Key, 'application/octet-stream');
      drawing.s3Key = s3Key;
      console.log(`[Server Log] ✅ S3 upload successful: ${s3Key}`);
    } catch (s3Err) {
      console.warn(`[Server Log] ⚠️ S3 upload skipped:`, s3Err.message);
    }

    // Step 2: Parse DWG directly using WASM engine
    drawing.status = 'converting';
    await drawing.save();

    let parsedData;
    try {
      console.log(`[Server Log] 🛠️ Starting WASM DWG parsing for ${originalName}`);
      parsedData = await parseDwgFile(buffer);
      console.log(`[Server Log] ✅ DWG parsing complete. Extracted ${parsedData.entityCount} entities and ${parsedData.layers.length} layers.`);
    } catch (parseErr) {
      drawing.status = 'error';
      drawing.errorMessage = `DWG parsing failed: ${parseErr.message}`;
      await drawing.save();
      throw parseErr;
    }

    // Instead of storing parsedData in Mongo, we upload it to S3 as JSON
    const jsonS3Key = `drawings/json/${drawing._id}/data.json`;
    console.log(`[Server Log] ☁️ Uploading parsed JSON to S3...`);
    const jsonBuffer = Buffer.from(JSON.stringify(parsedData));
    await uploadToS3(jsonBuffer, jsonS3Key, 'application/json');
    drawing.jsonS3Key = jsonS3Key;

    drawing.status = 'ready';
    drawing.metadata = {
      layers: parsedData.layers.map((l) => l.name),
      entityCount: parsedData.entityCount,
      bounds: parsedData.bounds,
    };
    if (parsedData.geolocation) {
      drawing.metadata.geolocation = parsedData.geolocation;
    }

    // Override projection details if a .prj sidecar file was provided
    if (prjText) {
      if (!drawing.metadata.geolocation) drawing.metadata.geolocation = {};
      drawing.metadata.geolocation.source = 'SIDECAR_PRJ';
      drawing.metadata.geolocation.projectionDetails = parseProjectionDetails(prjText);
      console.log(`[Server Log] ✅ Applied exact projection metadata from sidecar .prj file`);
    }

    await drawing.save();
  } catch (err) {
    if (drawing.status !== 'error') {
      drawing.status = 'error';
      drawing.errorMessage = err.message;
      await drawing.save();
    }
    throw err;
  }
};

/**
 * GET /api/files/:id
 * Get a specific drawing with parsed data
 */
const getFile = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    // Convert to plain object to attach parsedData
    const drawingObj = drawing.toObject();

    // If there is a sidecar JSON file on S3, fetch it
    if (drawing.jsonS3Key) {
      try {
        console.log(`[Server Log] ☁️ Fetching parsed JSON from S3 (${drawing.jsonS3Key})...`);
        const startTime = Date.now();
        const jsonContent = await getDataFromS3(drawing.jsonS3Key);
        console.log("done1");
        const downloadTime = Date.now() - startTime;
        console.log(`[Server Log] 📥 Downloaded ${Math.round(jsonContent.length / 1024)}KB from S3 in ${downloadTime}ms`);
        
        console.log(`[Server Log] ⚙️ Parsing JSON data...`);
        const parseStart = Date.now();
        drawingObj.parsedData = JSON.parse(jsonContent);
        console.log(`[Server Log] ✅ JSON parsed in ${Date.now() - parseStart}ms`);
      } catch (s3Err) {
        console.error(`[Server Log] ❌ Failed to fetch/parse JSON from S3:`, s3Err.message);
      }
    }

    res.json({ drawing: drawingObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/files
 * List all drawings (without heavy parsedData)
 */
const listFiles = async (req, res) => {
  try {
    const drawings = await Drawing.find()
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ drawings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/files/:id
 * Delete a drawing
 */
const deleteFile = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    // Delete from S3
    if (drawing.s3Key) {
      try { await deleteFromS3(drawing.s3Key); } catch (e) { /* ignore */ }
    }
    if (drawing.dxfS3Key) {
      try { await deleteFromS3(drawing.dxfS3Key); } catch (e) { /* ignore */ }
    }
    if (drawing.jsonS3Key) {
      try { await deleteFromS3(drawing.jsonS3Key); } catch (e) { /* ignore */ }
    }

    await Drawing.findByIdAndDelete(req.params.id);
    res.json({ message: 'Drawing deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
/**
 * POST /api/files/:id/orthomosaic
 * Upload an orthomosaic image for a drawing
 */
const uploadOrthomosaic = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      // If we used diskStorage, clean up the file
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Drawing not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Find the main image file
    let mainFile = req.files.find(f => {
      const ext = (f.originalname || '').split('.').pop().toLowerCase();
      return ['ecw', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp'].includes(ext);
    });

    if (!mainFile) {
      req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
      return res.status(400).json({ error: 'No valid main image file found in the upload' });
    }

    const ext = mainFile.originalname.split('.').pop().toLowerCase();
    let tempPath = mainFile.path;
    let mimetype = mainFile.mimetype;
    let s3KeyOriginalName = mainFile.originalname;

    if (ext === 'ecw') {
      try {
        const outPath = tempPath + '.jpg';
        await new Promise((resolve, reject) => {
          require('child_process').exec(`gdal_translate -of JPEG "${tempPath}" "${outPath}"`, (err, stdout, stderr) => {
            if (err) {
              console.error("GDAL Error:", stderr);
              reject(err);
            } else {
              resolve();
            }
          });
        });
        tempPath = outPath;
        mimetype = 'image/jpeg';
        s3KeyOriginalName = mainFile.originalname.replace(/\.ecw$/i, '.jpg');
      } catch (e) {
        req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(500).json({ error: 'Failed to convert ECW file. Please ensure GDAL is installed with ECW support.' });
      }
    }

    // Upload to S3
    const s3Key = `drawings/orthomosaic/${drawing._id}/${Date.now()}-${s3KeyOriginalName}`;
    try {
      const fileStream = fs.createReadStream(tempPath);
      await uploadToS3(fileStream, s3Key, mimetype);
      
      // Use a backend proxy URL instead of direct S3 to avoid CORS issues with Three.js TextureLoader
      const proxyUrl = `/api/files/${drawing._id}/orthomosaic/image`;

      drawing.orthomosaic = {
        s3Key: s3Key,
        url: proxyUrl,
        scale: 1,
        rotation: 0,
        offsetX: 0,
        offsetY: 0
      };

      await drawing.save();

      // Clean up temp files
      req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
      if (ext === 'ecw' && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

      res.status(200).json({
        message: 'Orthomosaic uploaded successfully',
        orthomosaic: drawing.orthomosaic
      });
    } catch (s3Err) {
      req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
      if (ext === 'ecw' && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      console.error('S3 upload failed:', s3Err);
      res.status(500).json({ error: 'Failed to upload orthomosaic to S3' });
    }
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Orthomosaic upload failed' });
  }
};

/**
 * PUT /api/files/:id/orthomosaic/align
 * Update alignment metadata
 */
const updateOrthomosaicAlignment = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    const { scale, rotation, offsetX, offsetY } = req.body;
    
    if (drawing.orthomosaic) {
      if (scale !== undefined) drawing.orthomosaic.scale = scale;
      if (rotation !== undefined) drawing.orthomosaic.rotation = rotation;
      if (offsetX !== undefined) drawing.orthomosaic.offsetX = offsetX;
      if (offsetY !== undefined) drawing.orthomosaic.offsetY = offsetY;
      
      await drawing.save();
    }

    res.json({ message: 'Alignment updated', orthomosaic: drawing.orthomosaic });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/files/:id/orthomosaic/image
 * Proxy the orthomosaic image from S3 to the browser, adding CORS headers
 * so Three.js TextureLoader can load it cross-origin
 */
const proxyOrthomosaicImage = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing || !drawing.orthomosaic?.s3Key) {
      return res.status(404).json({ error: 'Orthomosaic not found' });
    }

    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { s3Client } = require('../config/s3');

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: drawing.orthomosaic.s3Key,
    });

    const s3Response = await s3Client.send(command);

    // Set CORS and caching headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    
    // Detect content type from key extension
    const key = drawing.orthomosaic.s3Key.toLowerCase();
    const ext = key.split('.').pop();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };
    res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');

    s3Response.Body.pipe(res);
  } catch (error) {
    console.error('Orthomosaic proxy error:', error);
    res.status(500).json({ error: error.message });
  }
};
/**
 * PUT /api/files/:id/map-placement
 * Save the user's map placement (anchor coordinates, rotation, scale)
 */
const saveMapPlacement = async (req, res) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    const { anchorLat, anchorLng, rotation, scale, proj4String, epsg } = req.body;

    drawing.mapPlacement = {
      anchorLat: anchorLat ?? null,
      anchorLng: anchorLng ?? null,
      rotation: rotation ?? 0,
      scale: scale ?? 1,
      proj4String: proj4String ?? null,
      epsg: epsg ?? null,
    };

    await drawing.save();
    res.json({ message: 'Map placement saved', mapPlacement: drawing.mapPlacement });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { uploadFile, getFile, listFiles, deleteFile, uploadOrthomosaic, updateOrthomosaicAlignment, proxyOrthomosaicImage, saveMapPlacement };
