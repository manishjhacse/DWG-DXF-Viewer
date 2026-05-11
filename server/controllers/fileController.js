const path = require('path');
const fs = require('fs');
const Drawing = require('../models/Drawing');
const { uploadToS3, deleteFromS3 } = require('../config/s3');
const { parseDxfFile } = require('../services/dxfParser');
const { parseDwgFile } = require('../services/converter');

/**
 * POST /api/files/upload
 * Upload a DWG or DXF file
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, size } = req.file;
    const ext = originalname.split('.').pop().toLowerCase();

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
      await processDxfFile(drawing, buffer);
    } else if (ext === 'dwg') {
      await processDwgFile(drawing, buffer, originalname);
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
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'File upload failed' });
  }
};

/**
 * Process a DXF file: parse and store
 */
const processDxfFile = async (drawing, buffer) => {
  try {
    const parsedData = parseDxfFile(buffer);

    drawing.parsedData = parsedData;
    drawing.status = 'ready';
    drawing.metadata = {
      layers: parsedData.layers.map((l) => l.name),
      entityCount: parsedData.entityCount,
      bounds: parsedData.bounds,
    };
    if (parsedData.geolocation) {
      drawing.metadata.geolocation = parsedData.geolocation;
    }

    // Upload to S3 for persistence
    const s3Key = `drawings/dxf/${drawing._id}/${drawing.originalName}`;
    try {
      await uploadToS3(buffer, s3Key, 'application/dxf');
      drawing.s3Key = s3Key;
    } catch (s3Err) {
      console.warn('S3 upload failed:', s3Err.message);
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
const processDwgFile = async (drawing, buffer, originalName) => {
  try {
    // Step 1: Upload DWG to S3
    const s3Key = `drawings/dwg/${drawing._id}/${originalName}`;
    try {
      await uploadToS3(buffer, s3Key, 'application/octet-stream');
      drawing.s3Key = s3Key;
    } catch (s3Err) {
      console.warn('S3 upload skipped:', s3Err.message);
    }

    // Step 2: Parse DWG directly using WASM engine
    drawing.status = 'converting';
    await drawing.save();

    let parsedData;
    try {
      parsedData = await parseDwgFile(buffer);
    } catch (parseErr) {
      drawing.status = 'error';
      drawing.errorMessage = `DWG parsing failed: ${parseErr.message}`;
      await drawing.save();
      throw parseErr;
    }

    // Step 3: Store parsed data
    drawing.parsedData = parsedData;
    drawing.status = 'ready';
    drawing.metadata = {
      layers: parsedData.layers.map((l) => l.name),
      entityCount: parsedData.entityCount,
      bounds: parsedData.bounds,
    };
    if (parsedData.geolocation) {
      drawing.metadata.geolocation = parsedData.geolocation;
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
    res.json({ drawing });
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
      .select('-parsedData')
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
      
      const bucketName = process.env.S3_BUCKET_NAME;
      const region = process.env.AWS_REGION || 'us-east-1';
      const url = `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;

      drawing.orthomosaic = {
        s3Key: s3Key,
        url: url,
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

module.exports = { uploadFile, getFile, listFiles, deleteFile, uploadOrthomosaic, updateOrthomosaicAlignment };
