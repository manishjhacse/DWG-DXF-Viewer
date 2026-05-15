const proj4 = require('proj4');

/**
 * Extract geolocation data from a DWG file using the RAW WASM API.
 *
 * The high-level DwgDatabase from libredwg.convert() does NOT include GEODATA
 * objects. We must use the low-level dynapi functions on the raw Dwg_Data
 * pointer (before it is freed) to access header variables and GEODATA objects.
 *
 * @param {object} libredwg  - The initialized LibreDwg WASM instance
 * @param {number} dwgDataPtr - Raw Dwg_Data pointer from dwg_read_file
 * @returns {{ latitude: number, longitude: number, northDirection: number,
 *             coordinateSystem: string, designPoint: object, referencePoint: object,
 *             source: string } | null}
 */
const extractGeoFromDwgRaw = (libredwg, dwgDataPtr) => {
  if (!dwgDataPtr) return null;

  let geolocation = null;

  // ─── Strategy 1: Read $LATITUDE / $LONGITUDE header variables ───
  try {
    const latResult = libredwg.dwg_dynapi_header_value(dwgDataPtr, 'LATITUDE');
    const lngResult = libredwg.dwg_dynapi_header_value(dwgDataPtr, 'LONGITUDE');

    console.log('🌍 Header $LATITUDE result:', JSON.stringify(latResult));
    console.log('🌍 Header $LONGITUDE result:', JSON.stringify(lngResult));

    if (latResult?.success && lngResult?.success) {
      const lat = typeof latResult.data === 'number' ? latResult.data : parseFloat(latResult.data);
      const lng = typeof lngResult.data === 'number' ? lngResult.data : parseFloat(lngResult.data);

      if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0) && isValidLatLng(lat, lng)) {
        geolocation = {
          latitude: lat,
          longitude: lng,
          northDirection: 0,
          coordinateSystem: 'WGS84',
          designPoint: null,
          referencePoint: null,
          source: 'HEADER_VARS',
        };

        // Also try to read $NORTHDIRECTION
        try {
          const northResult = libredwg.dwg_dynapi_header_value(dwgDataPtr, 'NORTHDIRECTION');
          if (northResult?.success && typeof northResult.data === 'number') {
            geolocation.northDirection = northResult.data;
          }
        } catch (e) { /* optional field */ }

        console.log('✅ Extracted geolocation from DWG header vars:', geolocation);
        return geolocation;
      }
    }
  } catch (headerErr) {
    console.warn('⚠️ Header variable extraction failed:', headerErr.message);
  }

  // ─── Strategy 2: Find GEODATA objects via dwg_getall_object_by_type ───
  try {
    // DWG_TYPE_GEODATA = 638 (from the library's enum)
    const DWG_TYPE_GEODATA = 638;
    const geodataObjects = libredwg.dwg_getall_object_by_type(dwgDataPtr, DWG_TYPE_GEODATA);

    console.log(`🌍 Found ${geodataObjects ? geodataObjects.length : 0} GEODATA objects`);

    if (geodataObjects && geodataObjects.length > 0) {
      for (const geodataPtr of geodataObjects) {
        if (!geodataPtr) continue;

        const geoResult = extractFieldsFromGeodata(libredwg, geodataPtr);
        if (geoResult) {
          console.log('✅ Extracted geolocation from GEODATA object:', geoResult);
          return geoResult;
        }
      }
    }
  } catch (geodataErr) {
    console.warn('⚠️ GEODATA object extraction failed:', geodataErr.message);
  }

  // ─── Strategy 2b: Walk all objects looking for GEODATA by dxfname ───
  try {
    // The LibreDwg Proxy delegates unknown methods to wasmInstance automatically
    const numObjects = libredwg.dwg_get_num_objects
      ? libredwg.dwg_get_num_objects(dwgDataPtr)
      : (libredwg.wasmInstance ? libredwg.wasmInstance.dwg_get_num_objects(dwgDataPtr) : 0);
    console.log(`🔍 Scanning ${numObjects} raw objects for GEODATA by dxfname...`);

    for (let i = 0; i < numObjects; i++) {
      try {
        const objPtr = libredwg.dwg_get_object
          ? libredwg.dwg_get_object(dwgDataPtr, i)
          : libredwg.wasmInstance.dwg_get_object(dwgDataPtr, i);
        if (!objPtr) continue;

        const dxfName = libredwg.dwg_object_get_dxfname
          ? libredwg.dwg_object_get_dxfname(objPtr)
          : libredwg.wasmInstance.dwg_object_get_dxfname(objPtr);
        if (dxfName === 'GEODATA') {
          console.log(`🌍 Found GEODATA object at index ${i} via dxfname scan`);

          // Get the TIO (type-specific data) pointer
          const supertype = libredwg.dwg_object_get_supertype
            ? libredwg.dwg_object_get_supertype(objPtr)
            : libredwg.wasmInstance.dwg_object_get_supertype(objPtr);
          let tioPtr;
          if (supertype === 1) {
            // It's an object (not entity)
            tioPtr = libredwg.dwg_object_to_object_tio(objPtr);
          } else {
            tioPtr = libredwg.dwg_object_to_entity_tio(objPtr);
          }

          if (tioPtr) {
            const geoResult = extractFieldsFromGeodata(libredwg, tioPtr);
            if (geoResult) {
              console.log('✅ Extracted geolocation from GEODATA (dxfname scan):', geoResult);
              return geoResult;
            }
          }
        }
      } catch (e) {
        // Skip individual object errors
      }
    }
  } catch (scanErr) {
    console.warn('⚠️ Object scan for GEODATA failed:', scanErr.message);
  }

  console.log('ℹ️ No geolocation data found in DWG file');
  return null;
};

/**
 * Extract geographic fields from a GEODATA TIO pointer using dynapi.
 *
 * GEODATA struct fields (from LibreDWG dwg.h):
 *   - coord_type   (BS/int16): 0=unknown, 1=local_grid, 2=projected_grid, 3=geographic
 *   - design_pt    (3BD/point3d): Reference point in DWG design coordinates
 *   - ref_pt       (3BD/point3d): Corresponding point in geographic coordinates
 *   - unit_scale_horiz (BD): Horizontal unit scale factor
 *   - north_dir_angle_deg (BD): North direction angle in degrees
 *   - coordinate_system_definition (T/string): CRS definition (WKT or EPSG XML)
 *   - geo_rss_tag  (T/string): GeoRSS tag
 */
const extractFieldsFromGeodata = (libredwg, geodataPtr) => {
  const fields = {};

  // List of fields to attempt extraction
  const fieldNames = [
    'coord_type',
    'design_pt',
    'ref_pt',
    'north_dir_angle_deg',
    'north_direction',
    'unit_scale_horiz',
    'coordinate_system_definition',
    'geo_rss_tag',
    'ref_pt_unit_scale_horiz',
    'observation_from_pt',
    'observation_to_pt',
  ];

  for (const field of fieldNames) {
    try {
      const result = libredwg.dwg_dynapi_entity_value(geodataPtr, field);
      if (result?.success && result.data != null) {
        fields[field] = result.data;
        console.log(`  GEODATA.${field} =`, JSON.stringify(result.data));
      }
    } catch (e) {
      // Field not available in this version
    }
  }

  // Log all discovered fields for debugging
  console.log('🌍 GEODATA extracted fields:', Object.keys(fields).join(', '));

  // Determine latitude/longitude from the extracted fields
  let lat = null, lng = null;
  let northDirection = 0;
  let coordinateSystem = null;
  let designPoint = null;
  let referencePoint = null;

  // Extract coordinate system definition
  if (fields.coordinate_system_definition) {
    coordinateSystem = fields.coordinate_system_definition;
    console.log('  CRS definition (first 200 chars):', coordinateSystem.substring(0, 200));
  }

  // Extract north direction
  if (typeof fields.north_dir_angle_deg === 'number') {
    northDirection = fields.north_dir_angle_deg;
  } else if (typeof fields.north_direction === 'number') {
    northDirection = fields.north_direction;
  }

  // Extract reference point (geographic coordinates)
  if (fields.ref_pt) {
    const rp = fields.ref_pt;
    referencePoint = { x: rp.x, y: rp.y };
    console.log(`  ref_pt: (${rp.x}, ${rp.y})`);
  }

  // Extract design point (CAD coordinates)
  if (fields.design_pt) {
    const dp = fields.design_pt;
    designPoint = { x: dp.x, y: dp.y };
    console.log(`  design_pt: (${dp.x}, ${dp.y})`);
  }

  // coord_type determines how to interpret ref_pt:
  //   0 = unknown
  //   1 = local_grid
  //   2 = projected_grid (UTM, State Plane, etc.)
  //   3 = geographic (already lat/lng)
  const coordType = fields.coord_type;
  console.log(`  coord_type: ${coordType}`);

  if (referencePoint) {
    if (coordType === 3) {
      // Type 3: ref_pt is already geographic (lat/lng)
      // Note: In AutoCAD GEODATA, x = longitude, y = latitude
      lat = referencePoint.y;
      lng = referencePoint.x;
    } else if (coordType === 2 && coordinateSystem) {
      // Type 2: ref_pt is in a projected coordinate system
      // Try to convert using proj4
      const converted = convertProjectedToWGS84(referencePoint.x, referencePoint.y, coordinateSystem);
      if (converted) {
        lat = converted.lat;
        lng = converted.lng;
      }
    } else if (coordType === 1 || coordType === 0) {
      // Local grid or unknown — try coordinate system conversion anyway
      if (coordinateSystem) {
        const converted = convertProjectedToWGS84(referencePoint.x, referencePoint.y, coordinateSystem);
        if (converted) {
          lat = converted.lat;
          lng = converted.lng;
        }
      }
      // If ref_pt looks like lat/lng directly (common in some files)
      if (lat === null && isValidLatLng(referencePoint.y, referencePoint.x)) {
        lat = referencePoint.y;
        lng = referencePoint.x;
      }
    }
  }

  // Fallback: if we have design_pt and it looks geographic
  if (lat === null && designPoint && isValidLatLng(designPoint.y, designPoint.x)) {
    lat = designPoint.y;
    lng = designPoint.x;
  }

  if (lat !== null && lng !== null && isValidLatLng(lat, lng)) {
    return {
      latitude: lat,
      longitude: lng,
      northDirection,
      coordinateSystem: coordinateSystem || null,
      projectionDetails: coordinateSystem ? parseProjectionDetails(coordinateSystem) : null,
      designPoint,
      referencePoint,
      source: 'GEODATA',
    };
  }

  return null;
};

/**
 * Convert projected coordinates to WGS84 using the CRS definition string.
 * Handles WKT, EPSG codes, and proj4 strings.
 */
const convertProjectedToWGS84 = (x, y, crsDefinition) => {
  try {
    let sourceCRS = null;

    // Try to parse as proj4 string directly
    if (crsDefinition.startsWith('+proj=') || crsDefinition.startsWith('+init=')) {
      sourceCRS = crsDefinition;
    }
    // Try to extract EPSG code from XML-style CRS definition (AutoCAD format)
    else if (crsDefinition.includes('EPSG:') || crsDefinition.includes('epsg:')) {
      const epsgMatch = crsDefinition.match(/EPSG[:\s]*(\d+)/i);
      if (epsgMatch) {
        sourceCRS = `EPSG:${epsgMatch[1]}`;
        // Register the EPSG if not already known
        try {
          proj4.defs(sourceCRS);
        } catch (e) {
          console.warn(`⚠️ EPSG:${epsgMatch[1]} not in proj4 database, attempting WKT parse`);
          sourceCRS = null;
        }
      }
    }
    // Try to parse as WKT
    else if (crsDefinition.includes('PROJCS') || crsDefinition.includes('GEOGCS')) {
      // proj4 can parse WKT strings
      try {
        sourceCRS = proj4.Proj(crsDefinition);
      } catch (e) {
        console.warn('⚠️ WKT parse failed, trying to extract key params...');
        sourceCRS = extractProj4FromWKT(crsDefinition);
      }
    }
    // AutoCAD XML-like definition — try to find EPSG or proj params
    else if (crsDefinition.includes('<CoordinateSystem') || crsDefinition.includes('<?xml')) {
      const epsgMatch = crsDefinition.match(/(?:EPSG|epsg|code)[:\s"=]*(\d{4,6})/i);
      if (epsgMatch) {
        sourceCRS = `EPSG:${epsgMatch[1]}`;
      }
      // Look for projection name patterns
      if (!sourceCRS) {
        const utmMatch = crsDefinition.match(/UTM[- ]?(?:Zone\s*)?(\d+)\s*([NS])?/i);
        if (utmMatch) {
          const zone = parseInt(utmMatch[1]);
          const south = (utmMatch[2] || 'N').toUpperCase() === 'S';
          sourceCRS = `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
        }
      }
    }

    if (!sourceCRS) {
      console.log('⚠️ Could not parse CRS definition for proj4 conversion');
      return null;
    }

    console.log('🔄 Converting coordinates using CRS:', typeof sourceCRS === 'string' ? sourceCRS.substring(0, 100) : 'WKT object');

    const result = proj4(sourceCRS, 'EPSG:4326', [x, y]);
    if (result && result.length >= 2 && !isNaN(result[0]) && !isNaN(result[1])) {
      const lng = result[0];
      const lat = result[1];
      if (isValidLatLng(lat, lng)) {
        console.log(`✅ Projected (${x}, ${y}) → WGS84 (${lat}, ${lng})`);
        return { lat, lng };
      }
    }
  } catch (e) {
    console.warn('⚠️ proj4 conversion failed:', e.message);
  }
  return null;
};

/**
 * Attempt to extract a proj4 string from a WKT coordinate system definition.
 */
const extractProj4FromWKT = (wkt) => {
  try {
    // Try direct proj4 WKT parsing
    return proj4.Proj(wkt);
  } catch (e) {
    // Manual extraction of key UTM parameters from WKT
    const utmMatch = wkt.match(/UTM[_\s]*[Zz]one[_\s]*(\d+)/i);
    if (utmMatch) {
      const zone = parseInt(utmMatch[1]);
      const south = wkt.toLowerCase().includes('south');
      return `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
    }
  }
  return null;
};

/**
 * Extract geolocation from DXF header variables.
 * @param {object} dxfHeader - The parsed DXF header object
 * @returns {object|null} Geolocation data or null
 */
const extractGeoFromDxfHeader = (dxfHeader) => {
  if (!dxfHeader) return null;

  // $LATITUDE and $LONGITUDE are standard DXF header variables
  const lat = dxfHeader['$LATITUDE'] ?? dxfHeader.LATITUDE ?? dxfHeader.latitude;
  const lng = dxfHeader['$LONGITUDE'] ?? dxfHeader.LONGITUDE ?? dxfHeader.longitude;

  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isValidLatLng(lat, lng) && (lat !== 0 || lng !== 0)) {
    let northDir = 0;
    const nd = dxfHeader['$NORTHDIRECTION'] ?? dxfHeader.NORTHDIRECTION;
    if (nd != null && !isNaN(nd)) northDir = nd;

    console.log(`✅ DXF header geolocation: lat=${lat}, lng=${lng}, north=${northDir}`);
    return {
      latitude: lat,
      longitude: lng,
      northDirection: northDir,
      coordinateSystem: null,
      designPoint: null,
      referencePoint: null,
      source: 'HEADER_VARS',
    };
  }

  return null;
};

/**
 * Extract geolocation from DXF raw text by scanning for GEODATA object.
 * The dxf-parser library doesn't parse the OBJECTS section, so we scan manually.
 *
 * In DXF, GEODATA has:
 *   Group 0:  GEODATA
 *   Group 40: horizontal_unit_scale
 *   Group 41: horizontal unit / scale factor (was used for lat in old docs)
 *   Group 90: coord_type (0=unknown, 1=local, 2=projected, 3=geographic)
 *   Groups 10,20,30: design_pt (x,y,z)
 *   Groups 11,21,31: ref_pt (x,y,z)
 *   Group 301: coordinate_system_definition (multi-line)
 *   Group 302: geo_rss_tag
 *
 * @param {string} dxfContent - Raw DXF file text content
 * @returns {object|null} Geolocation data or null
 */
const extractGeoFromDxfText = (dxfContent) => {
  if (!dxfContent || typeof dxfContent !== 'string') return null;

  // Find the GEODATA object in the raw text
  const geodataStart = dxfContent.indexOf('\nGEODATA\n');
  const geodataStart2 = dxfContent.indexOf('\r\nGEODATA\r\n');
  const startIdx = Math.max(geodataStart, geodataStart2);

  if (startIdx === -1) {
    // Also try the pattern: group code 0 followed by GEODATA
    const altPattern = /\n\s*0\s*\n\s*GEODATA\s*\n/i;
    const altMatch = altPattern.exec(dxfContent);
    if (!altMatch) {
      console.log('ℹ️ No GEODATA object found in DXF text');
      return null;
    }
  }

  console.log('🌍 Found GEODATA in DXF text, scanning group codes...');

  // Extract the GEODATA section (up to next "0" group code entity)
  const lines = dxfContent.substring(startIdx >= 0 ? startIdx : 0).split(/\r?\n/);
  let inGeodata = false;
  let coordType = null;
  let designPt = { x: 0, y: 0 };
  let refPt = { x: 0, y: 0 };
  let csDef = '';
  let northDir = 0;

  for (let i = 0; i < lines.length && i < 500; i++) {
    const line = lines[i].trim();

    if (line === 'GEODATA') {
      inGeodata = true;
      continue;
    }

    if (!inGeodata) continue;

    // Stop at next entity (group code 0)
    if (line === '0' && i > 5) break;

    const groupCode = parseInt(line);
    if (isNaN(groupCode) || i + 1 >= lines.length) continue;

    const value = lines[i + 1]?.trim();
    if (value === undefined) continue;

    switch (groupCode) {
      case 90: coordType = parseInt(value); break;
      case 10: designPt.x = parseFloat(value); break;
      case 20: designPt.y = parseFloat(value); break;
      case 11: refPt.x = parseFloat(value); break;
      case 21: refPt.y = parseFloat(value); break;
      case 301: csDef += value; break;
      case 302: break; // geo_rss_tag, skip
      case 40: northDir = parseFloat(value); break;
    }
  }

  console.log(`  DXF GEODATA: coord_type=${coordType}, ref_pt=(${refPt.x}, ${refPt.y}), design_pt=(${designPt.x}, ${designPt.y})`);

  // Determine lat/lng
  let lat = null, lng = null;

  if (coordType === 3) {
    // Geographic: ref_pt is lat/lng (x=lng, y=lat)
    lat = refPt.y;
    lng = refPt.x;
  } else if ((coordType === 2 || coordType === 1 || coordType === 0) && csDef) {
    // Projected: convert ref_pt using CRS
    const converted = convertProjectedToWGS84(refPt.x, refPt.y, csDef);
    if (converted) {
      lat = converted.lat;
      lng = converted.lng;
    }
  }

  // Fallback: check if ref_pt looks geographic
  if (lat === null && isValidLatLng(refPt.y, refPt.x)) {
    lat = refPt.y;
    lng = refPt.x;
  }

  if (lat !== null && lng !== null && isValidLatLng(lat, lng)) {
    console.log(`✅ DXF GEODATA geolocation: lat=${lat}, lng=${lng}`);
    return {
      latitude: lat,
      longitude: lng,
      northDirection: northDir || 0,
      coordinateSystem: csDef || null,
      projectionDetails: csDef ? parseProjectionDetails(csDef) : null,
      designPoint,
      referencePoint: refPt,
      source: 'DXF_GEODATA',
    };
  }

  return null;
};

/**
 * Validate that coordinates are plausible lat/lng values.
 */
const isValidLatLng = (lat, lng) => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
};

/**
 * Parse the coordinate system definition string (XML or WKT) to extract
 * projection parameters for the frontend map placement.
 * @param {string} crsDef - Coordinate System Definition string
 * @returns {object|null} Extracted projection details
 */
const parseProjectionDetails = (crsDef) => {
  if (!crsDef || typeof crsDef !== 'string') return null;
  
  const details = {
    epsg: null,
    zone: null,
    datum: null,
    projection: null,
    units: null,
    scaleFactor: null,
    centralMeridian: null,
    originLatitude: null,
    falseEasting: null,
    falseNorthing: null,
  };

  try {
    // 1. Try extracting EPSG
    const epsgMatch = crsDef.match(/(?:EPSG|epsg|code)[:\s"=]*(\d{4,6})/i);
    if (epsgMatch) {
      details.epsg = `EPSG:${epsgMatch[1]}`;
    }

    // 2. Determine if it is XML or WKT
    if (crsDef.includes('<CoordinateSystem') || crsDef.includes('<?xml')) {
      // It's XML format
      const nameMatch = crsDef.match(/<Name>([^<]+)<\/Name>/i);
      if (nameMatch) details.projection = nameMatch[1].trim();
      
      const datumMatch = crsDef.match(/<Datum.*?>[\s\S]*?<Name>([^<]+)<\/Name>/i);
      if (datumMatch) details.datum = datumMatch[1].trim();
      
      const unitsMatch = crsDef.match(/<Unit.*?>[\s\S]*?<Name>([^<]+)<\/Name>/i);
      if (unitsMatch) details.units = unitsMatch[1].trim();
      
      // Parameters
      const paramMatches = [...crsDef.matchAll(/<Parameter>[\s\S]*?<ParameterCode>([^<]+)<\/ParameterCode>[\s\S]*?<Value>([^<]+)<\/Value>[\s\S]*?<\/Parameter>/gi)];
      for (const p of paramMatches) {
        const code = p[1].toLowerCase().replace(/\s+/g, '');
        const value = parseFloat(p[2]);
        if (!isNaN(value)) {
          if (code.includes('scale')) details.scaleFactor = value;
          else if (code.includes('centralmeridian')) details.centralMeridian = value;
          else if (code.includes('originlatitude')) details.originLatitude = value;
          else if (code.includes('falseeasting')) details.falseEasting = value;
          else if (code.includes('falsenorthing')) details.falseNorthing = value;
        }
      }
    } else {
      // It's likely WKT
      const projcsMatch = crsDef.match(/PROJCS\["([^"]+)"/i);
      if (projcsMatch) details.projection = projcsMatch[1].trim();
      
      const geogcsMatch = crsDef.match(/GEOGCS\["([^"]+)"/i);
      if (geogcsMatch) details.datum = geogcsMatch[1].trim();
      
      const unitMatch = crsDef.match(/UNIT\["([^"]+)"/i);
      if (unitMatch) details.units = unitMatch[1].trim();
      
      const paramsMatches = [...crsDef.matchAll(/PARAMETER\["([^"]+)",([\d.-]+)\]/gi)];
      for (const p of paramsMatches) {
        const code = p[1].toLowerCase().replace(/\s+/g, '_');
        const value = parseFloat(p[2]);
        if (!isNaN(value)) {
          if (code.includes('scale')) details.scaleFactor = value;
          else if (code.includes('central_meridian')) details.centralMeridian = value;
          else if (code.includes('latitude_of_origin')) details.originLatitude = value;
          else if (code.includes('false_easting')) details.falseEasting = value;
          else if (code.includes('false_northing')) details.falseNorthing = value;
        }
      }
    }
    
    // Extract Zone from projection name if missing
    if (details.projection && !details.zone) {
      const zoneMatch = details.projection.match(/UTM.*?(?:Zone)?\s*(\d+)/i);
      if (zoneMatch) {
        details.zone = parseInt(zoneMatch[1]);
      }
    }

    console.log('[Server Log] ✅ Parsed Projection Details:', JSON.stringify(details));
    return details;
  } catch (error) {
    console.warn('[Server Log] ⚠️ Error parsing projection details:', error.message);
    return null;
  }
};

module.exports = {
  extractGeoFromDwgRaw,
  extractGeoFromDxfHeader,
  extractGeoFromDxfText,
  convertProjectedToWGS84,
  isValidLatLng,
  parseProjectionDetails,
};
