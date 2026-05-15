const path = require('path');
const fs = require('fs');
const { extractGeoFromDwgRaw } = require('./geoExtractor');

let libredwgInstance = null;
let DwgFileType = null;

/**
 * Initialize the LibreDWG WASM module (lazy singleton)
 */
const getLibreDwg = async () => {
  if (libredwgInstance) return libredwgInstance;

  // Dynamic import for the ESM package
  const mod = await import('@mlightcad/libredwg-web');
  const LibreDwg = mod.LibreDwg;
  DwgFileType = mod.Dwg_File_Type;

  const wasmDir = path.join(
    __dirname, '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm'
  ) + path.sep;

  libredwgInstance = await LibreDwg.create(wasmDir);
  console.log('[Server Log] ✅ LibreDWG WASM engine initialized successfully');
  return libredwgInstance;
};

/**
 * Parse a DWG file using the WASM engine and extract entities directly.
 * Returns parsed data in the same format as dxfParser.js
 * @param {Buffer} fileBuffer - Buffer containing the DWG file data
 * @returns {Promise<Object>} Parsed drawing data
 */
const parseDwgFile = async (fileBuffer) => {
  const libredwg = await getLibreDwg();

  // Use the raw WASM FS approach (more reliable in Node.js)
  const tmpName = `input_${Date.now()}.dwg`;
  let dwgDataPtr;

  try {
    // Write buffer to WASM virtual filesystem
    const uint8Data = new Uint8Array(fileBuffer);
    libredwg.FS.writeFile(tmpName, uint8Data);
    console.log(`[Server Log] 📝 WASM FS: Written ${tmpName}, size: ${uint8Data.length} bytes`);

    // Read using the WASM file reader
    console.log(`[Server Log] 🛠️ Calling LibreDWG dwg_read_file on ${tmpName}`);
    const result = libredwg.dwg_read_file(tmpName, DwgFileType.DWG);

    if (result.error >= 128) {
      console.error(`[Server Log] ❌ dwg_read_file returned severe error ${result.error} for ${tmpName}`);
      throw new Error(`LibreDWG error code: ${result.error}`);
    } else if (result.error !== 0) {
      console.warn(`[Server Log] ⚠️ LibreDWG non-critical warning (code ${result.error}) for ${tmpName}. Continuing parsing...`);
    } else {
      console.log(`[Server Log] ✅ dwg_read_file succeeded for ${tmpName}`);
    }

    dwgDataPtr = result.data;
  } catch (fsErr) {
    console.error('[Server Log] ❌ LibreDWG parsing failed:', fsErr.message);
    throw fsErr;
  } finally {
    // Clean up WASM virtual FS
    try { 
      libredwg.FS.unlink(tmpName); 
    } catch (e) { 
      /* ok */ 
    }
  }

  // Step 2: Extract geolocation from raw WASM pointer BEFORE converting/freeing
  // The dynapi functions need the raw Dwg_Data pointer, which is destroyed after convert + free.
  let geolocation = null;
  console.log(`[Server Log] 🌍 Attempting to extract geolocation data from raw DWG pointer...`);
  try {
    geolocation = extractGeoFromDwgRaw(libredwg, dwgDataPtr);
  } catch (geoErr) {
    console.warn('[Server Log] ⚠️ Geolocation extraction error (non-fatal):', geoErr.message);
  }

  // Step 3: Convert the low-level WASM data into a high-level DwgDatabase
  console.log(`[Server Log] 🔄 Converting raw DWG pointer to high-level DwgDatabase...`);
  const db = libredwg.convert(dwgDataPtr);
  console.log(`[Server Log] ✅ Conversion to DwgDatabase successful.`);

  // Step 4: Free the low-level WASM data (db is independent now)
  try { libredwg.dwg_free(dwgDataPtr); } catch (e) { /* ok */ }

  if (!db || !db.entities) {
    throw new Error('LibreDWG conversion returned no entities');
  }

  // Extract entities, layers, and bounds
  const entities = [];
  const layerSet = new Set();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const updateBounds = (x, y) => {
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  // Extract layers from tables
  const layerEntries = [];
  if (db.tables?.LAYER?.entries) {
    db.tables.LAYER.entries.forEach((l) => {
      layerEntries.push({
        name: l.name || '0',
        color: l.colorIndex || 7,
        visible: l.isOff !== true,
      });
      layerSet.add(l.name || '0');
    });
  }

  // Process entities
  const unknownTypes = new Set();
  db.entities.forEach((entity) => {
    try {
      const layerName = entity.layer || '0';
      layerSet.add(layerName);
      const parsed = convertEntity(entity, updateBounds);
      if (parsed) {
        entities.push(parsed);
      } else if (entity.type) {
        unknownTypes.add(entity.type);
      }
    } catch (e) {
      console.warn(`⚠️ Failed to parse entity type ${entity.type}:`, e.message);
    }
  });

  if (unknownTypes.size > 0) {
    console.log(`[Server Log] ℹ️ Skipped unhandled entity types: ${[...unknownTypes].join(', ')}`);
  }

  // Build final layers (merge table layers + entity-discovered layers)
  const layers = Array.from(layerSet).map((name) => {
    const tableEntry = layerEntries.find((l) => l.name === name);
    return tableEntry || { name, color: 7, visible: true };
  });

  // Extract block definitions for resolving INSERT entities
  const blocks = {};
  const noopBounds = () => {}; // don't affect main bounds for block-internal geometry

  // Try multiple locations where blocks might be stored
  const blockSources = [
    db.blocks,
    db.tables?.BLOCK?.entries,
    db.tables?.BLOCK_RECORD?.entries,
  ].filter(Boolean);

  for (const source of blockSources) {
    const blockList = Array.isArray(source) ? source : Object.values(source);
    for (const block of blockList) {
      const name = block.name || block.blockName || '';
      // Skip model/paper space blocks and empty names
      if (!name || name.startsWith('*') || name === 'Model_Space' || name === 'Paper_Space') continue;
      if (blocks[name]) continue; // already found

      const blockEntities = block.entities || block.ownedObjects || [];
      if (blockEntities.length === 0) continue;

      const convertedEntities = [];
      blockEntities.forEach((ent) => {
        try {
          const parsed = convertEntity(ent, noopBounds);
          if (parsed) convertedEntities.push(parsed);
        } catch (e) { /* skip bad entity */ }
      });

      if (convertedEntities.length > 0) {
        blocks[name] = {
          name,
          basePoint: block.basePoint || block.base_pt || { x: 0, y: 0 },
          entities: convertedEntities,
        };
      }
    }
  }

  const blockCount = Object.keys(blocks).length;
  if (blockCount > 0) {
    console.log(`[Server Log] ✅ Extracted ${blockCount} block definitions: ${Object.keys(blocks).slice(0, 10).join(', ')}${blockCount > 10 ? '...' : ''}`);
  } else {
    console.log('[Server Log] ℹ️ No block definitions found (INSERT entities will show as markers)');
  }

  const bounds = {
    minX: isFinite(minX) ? minX : 0,
    minY: isFinite(minY) ? minY : 0,
    maxX: isFinite(maxX) ? maxX : 100,
    maxY: isFinite(maxY) ? maxY : 100,
  };

  // Geolocation was already extracted from the raw WASM pointer (before dwg_free)
  // in Step 2 above. Just include it in the result.
  if (geolocation) {
    console.log('[Server Log] ✅ Final geolocation for this DWG attached to response.');
  } else {
    console.log('[Server Log] ℹ️ No geolocation data found in this DWG file.');
  }

  return {
    entities,
    layers,
    bounds,
    blocks,
    entityCount: entities.length,
    header: {},
    ...(geolocation && { geolocation }),
  };
};

/**
 * Convert a DwgEntity from the database into our simplified format
 */
const convertEntity = (entity, updateBounds) => {
  // Normalize the type — LibreDWG can return different casings and aliases
  const rawType = (entity.type || '').toUpperCase().trim();
  // Map known variants to canonical names
  const TYPE_ALIASES = {
    'LW_POLYLINE': 'LWPOLYLINE',
    'LWPOLY':      'LWPOLYLINE',
    'POLYLINE_2D': 'LWPOLYLINE',
    'POLYLINE_3D': 'LWPOLYLINE',
    'LINE2':       'LINE',
  };
  const t = TYPE_ALIASES[rawType] || rawType;

  const base = {
    type: t,
    layer: entity.layer || '0',
    color: entity.colorIndex,
  };

  if (t === 'LINE') {
    const s = entity.startPoint || entity.start;
    const e = entity.endPoint || entity.end;
    if (s && e) {
      updateBounds(s.x, s.y);
      updateBounds(e.x, e.y);
      return { ...base, startPoint: { x: s.x, y: s.y }, endPoint: { x: e.x, y: e.y } };
    }
  }

  if (t === 'LWPOLYLINE') {
    const verts = entity.vertices || entity.points || [];
    if (verts.length > 0) {
      const vertices = verts.map((v) => {
        updateBounds(v.x, v.y);
        return { x: v.x, y: v.y, bulge: v.bulge || 0 };
      });
      return { ...base, vertices, closed: entity.closed || entity.flag === 1 || false };
    }
  }

  if (t === 'POLYLINE_2D' || t === 'POLYLINE_3D' || t === 'POLYLINE') {
    const verts = entity.vertices || entity.points || [];
    if (verts.length > 0) {
      const vertices = verts.map((v) => {
        const x = v.x ?? v.point?.x;
        const y = v.y ?? v.point?.y;
        updateBounds(x, y);
        return { x, y, bulge: v.bulge || 0 };
      });
      return { ...base, type: 'LWPOLYLINE', vertices, closed: entity.closed || false };
    }
  }

  if (t === 'CIRCLE') {
    const c = entity.center;
    const r = entity.radius || 0;
    if (c) {
      updateBounds(c.x - r, c.y - r);
      updateBounds(c.x + r, c.y + r);
      return { ...base, center: { x: c.x, y: c.y }, radius: r };
    }
  }

  if (t === 'ARC') {
    const c = entity.center;
    const r = entity.radius || 0;
    if (c) {
      updateBounds(c.x - r, c.y - r);
      updateBounds(c.x + r, c.y + r);
      return {
        ...base, center: { x: c.x, y: c.y }, radius: r,
        startAngle: entity.startAngle || 0,
        endAngle: entity.endAngle || 360,
      };
    }
  }

  if (t === 'ELLIPSE') {
    const c = entity.center;
    if (c) {
      updateBounds(c.x, c.y);
      return {
        ...base, center: { x: c.x, y: c.y },
        majorAxis: entity.majorAxisEndPoint || entity.majorAxis || { x: 1, y: 0 },
        axisRatio: entity.axisRatio || entity.minorToMajorRatio || 1,
        startAngle: entity.startAngle || 0,
        endAngle: entity.endAngle || Math.PI * 2,
      };
    }
  }

  if (t === 'TEXT') {
    const pos = entity.insertionPoint || entity.startPoint || entity.firstAlignmentPoint;
    if (pos) {
      updateBounds(pos.x, pos.y);
      return {
        ...base, position: { x: pos.x, y: pos.y },
        text: entity.text || entity.value || '',
        height: entity.height || 1,
        rotation: entity.rotation || 0,
      };
    }
  }

  if (t === 'MTEXT') {
    const pos = entity.insertionPoint || entity.position;
    if (pos) {
      updateBounds(pos.x, pos.y);
      return {
        ...base, position: { x: pos.x, y: pos.y },
        text: entity.text || entity.contents || '',
        height: entity.height || entity.nominalTextHeight || 1,
        rotation: entity.rotation || 0,
      };
    }
  }

  if (t === 'POINT') {
    const pos = entity.position || entity.point;
    if (pos) {
      updateBounds(pos.x, pos.y);
      return { ...base, position: { x: pos.x, y: pos.y } };
    }
  }

  if (t === 'SPLINE') {
    const pts = entity.controlPoints || entity.fitPoints || [];
    if (pts.length > 0) {
      const controlPoints = pts.map((p) => {
        updateBounds(p.x, p.y);
        return { x: p.x, y: p.y };
      });
      return { ...base, controlPoints, fitPoints: [], degree: entity.degree || 3 };
    }
  }

  if (t === 'INSERT') {
    const pos = entity.insertionPoint || entity.position;
    if (pos) {
      updateBounds(pos.x, pos.y);
      return {
        ...base, position: { x: pos.x, y: pos.y },
        blockName: entity.blockName || entity.name || '',
        scale: { x: entity.xScale || 1, y: entity.yScale || 1 },
        rotation: entity.rotation || 0,
      };
    }
  }

  if (t === 'SOLID' || t === '3DFACE') {
    const points = [];
    ['corner1', 'corner2', 'corner3', 'corner4'].forEach((key) => {
      const p = entity[key];
      if (p) { updateBounds(p.x, p.y); points.push({ x: p.x, y: p.y }); }
    });
    if (points.length >= 3) return { ...base, points };
  }

  if (t === 'HATCH') {
    const boundaries = (entity.boundaries || entity.boundaryPaths || []).map(bp => {
      return (bp.edges || bp.polyline || []).map(e => {
        const verts = e.vertices || e.points || [];
        return verts.map(v => {
          updateBounds(v.x, v.y);
          return { x: v.x, y: v.y };
        });
      });
    });
    return { ...base, boundaries };
  }

  return null;
};

module.exports = { parseDwgFile };
