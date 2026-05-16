const DxfParser = require('dxf-parser');
const fs = require('fs');
const { extractGeoFromDxfText } = require('./geoExtractor');

/**
 * Parse DXF content and extract entities, layers, and bounding box
 * @param {string|Buffer} fileContent - Content of the DXF file
 * @returns {Object} Parsed data with entities, layers, and bounds
 */
const parseDxfFile = (fileContent) => {
  const content = Buffer.isBuffer(fileContent) ? fileContent.toString('utf-8') : fileContent;
  const parser = new DxfParser();

  let dxf;
  try {
    dxf = parser.parseSync(content);
  } catch (err) {
    throw new Error(`Failed to parse DXF file: ${err.message}`);
  }

  if (!dxf) {
    throw new Error('DXF parser returned null — file may be corrupt or unsupported');
  }

  // Extract layers
  const layers = [];
  if (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
    for (const [name, layerData] of Object.entries(dxf.tables.layer.layers)) {
      layers.push({
        name,
        color: layerData.color || 7,
        visible: layerData.visible !== false,
      });
    }
  }

  // Extract entities and calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const entities = [];

  const updateBounds = (x, y) => {
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  const unknownTypes = new Set();
  if (dxf.entities) {
    dxf.entities.forEach((entity) => {
      try {
        const parsed = parseEntity(entity, updateBounds);
        if (parsed) {
          entities.push(parsed);
        } else if (entity.type) {
          unknownTypes.add(entity.type);
        }
      } catch (e) {
        console.warn(`⚠️ DXF: Failed to parse entity type ${entity.type}:`, e.message);
      }
    });
  }

  if (unknownTypes.size > 0) {
    console.log(`ℹ️ DXF skipped unhandled entity types: ${[...unknownTypes].join(', ')}`);
  }

  const blocks = {};
  const noopBounds = () => {}; // block-internal geometry shouldn't affect global map bounds

  if (dxf.blocks) {
    for (const [name, blockData] of Object.entries(dxf.blocks)) {
      if (!name || name.startsWith('*') || name === 'Model_Space' || name === 'Paper_Space') continue;
      
      const blockEntities = blockData.entities || [];
      if (blockEntities.length === 0) continue;

      const convertedEntities = [];
      blockEntities.forEach((ent) => {
        try {
          const parsed = parseEntity(ent, noopBounds);
          if (parsed) convertedEntities.push(parsed);
        } catch (e) { /* skip bad entity */ }
      });

      if (convertedEntities.length > 0) {
        blocks[name] = {
          name,
          basePoint: { x: blockData.position?.x || blockData.x || 0, y: blockData.position?.y || blockData.y || 0 },
          entities: convertedEntities,
        };
      }
    }
    const blockCount = Object.keys(blocks).length;
    if (blockCount > 0) {
      console.log(`✅ Extracted ${blockCount} block definitions from DXF`);
    }
  }

  const bounds = {
    minX: isFinite(minX) ? minX : 0,
    minY: isFinite(minY) ? minY : 0,
    maxX: isFinite(maxX) ? maxX : 100,
    maxY: isFinite(maxY) ? maxY : 100,
  };

  // Extract geolocation — Strategy 1: Scan raw DXF text for GEODATA object (in OBJECTS section)
  let geolocation = extractGeoFromDxfText(content);


  if (geolocation) {
    console.log('✅ DXF geolocation:', JSON.stringify(geolocation));
  }

  return {
    entities,
    layers,
    bounds,
    blocks,
    entityCount: entities.length,
    header: dxf.header || {},

    ...(geolocation && { geolocation }),
  };
};

/**
 * Parse a single DXF entity into a simplified format
 */
const parseEntity = (entity, updateBounds) => {
  const base = {
    type: entity.type,
    layer: entity.layer || '0',
    color: entity.color,
    lineType: entity.lineType,
  };

  switch (entity.type) {
    case 'LINE': {
      const { x: x1, y: y1 } = entity.vertices?.[0] || entity.startPoint || {};
      const { x: x2, y: y2 } = entity.vertices?.[1] || entity.endPoint || {};
      updateBounds(x1, y1);
      updateBounds(x2, y2);
      return { ...base, startPoint: { x: x1, y: y1 }, endPoint: { x: x2, y: y2 } };
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = (entity.vertices || []).map((v) => {
        updateBounds(v.x, v.y);
        return { x: v.x, y: v.y, bulge: v.bulge || 0 };
      });
      return { ...base, vertices, closed: entity.shape || false };
    }

    case 'CIRCLE': {
      const cx = entity.center?.x;
      const cy = entity.center?.y;
      const r = entity.radius || 0;
      updateBounds(cx - r, cy - r);
      updateBounds(cx + r, cy + r);
      return { ...base, center: { x: cx, y: cy }, radius: r };
    }

    case 'ARC': {
      const acx = entity.center?.x;
      const acy = entity.center?.y;
      const ar = entity.radius || 0;
      updateBounds(acx - ar, acy - ar);
      updateBounds(acx + ar, acy + ar);
      return {
        ...base,
        center: { x: acx, y: acy },
        radius: ar,
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
      };
    }

    case 'ELLIPSE': {
      const ecx = entity.center?.x;
      const ecy = entity.center?.y;
      updateBounds(ecx, ecy);
      return {
        ...base,
        center: { x: ecx, y: ecy },
        majorAxis: entity.majorAxisEndPoint,
        axisRatio: entity.axisRatio,
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
      };
    }

    case 'SPLINE': {
      const controlPoints = (entity.controlPoints || []).map((p) => {
        updateBounds(p.x, p.y);
        return { x: p.x, y: p.y };
      });
      const fitPoints = (entity.fitPoints || []).map((p) => {
        updateBounds(p.x, p.y);
        return { x: p.x, y: p.y };
      });
      return { ...base, controlPoints, fitPoints, degree: entity.degreeOfSplineCurve };
    }

    case 'TEXT':
    case 'MTEXT': {
      const tx = entity.position?.x || entity.startPoint?.x;
      const ty = entity.position?.y || entity.startPoint?.y;
      updateBounds(tx, ty);
      return {
        ...base,
        position: { x: tx, y: ty },
        text: entity.text || '',
        height: entity.height || entity.nominalTextHeight || 1,
        rotation: entity.rotation || 0,
      };
    }

    case 'POINT': {
      const px = entity.position?.x;
      const py = entity.position?.y;
      updateBounds(px, py);
      return { ...base, position: { x: px, y: py } };
    }

    case 'INSERT': {
      const ix = entity.position?.x;
      const iy = entity.position?.y;
      updateBounds(ix, iy);
      return {
        ...base,
        position: { x: ix, y: iy },
        blockName: entity.name,
        scale: { x: entity.xScale || 1, y: entity.yScale || 1 },
        rotation: entity.rotation || 0,
      };
    }

    case 'DIMENSION': {
      // Simplified dimension handling
      if (entity.anchorPoint) {
        updateBounds(entity.anchorPoint.x, entity.anchorPoint.y);
      }
      return {
        ...base,
        anchorPoint: entity.anchorPoint,
        middleOfText: entity.middleOfText,
      };
    }

    case 'SOLID':
    case '3DFACE': {
      const points = [];
      for (let i = 0; i < 4; i++) {
        const key = `corner${i + 1}` in entity ? `corner${i + 1}` : null;
        const p = entity.points?.[i] || (key ? entity[key] : null);
        if (p) {
          updateBounds(p.x, p.y);
          points.push({ x: p.x, y: p.y });
        }
      }
      return { ...base, points };
    }

    case 'HATCH': {
      // Extract boundary paths for hatches
      const boundaries = (entity.boundaries || entity.boundaryPaths || []).map(bp => {
        return (bp.edges || bp.polyline || []).map(e => {
          if (e.vertices) {
            return e.vertices.map(v => {
              updateBounds(v.x, v.y);
              return { x: v.x, y: v.y };
            });
          }
          return [];
        });
      });
      return { ...base, boundaries };
    }

    default:
      return null;
  }
};

module.exports = { parseDxfFile };
