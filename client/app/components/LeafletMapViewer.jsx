"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import proj4 from "proj4";

// ACI color palette (same as DrawingCanvas)
const ACI_COLORS = [
  "#000000","#FF0000","#FFFF00","#00FF00","#00FFFF","#0000FF","#FF00FF","#FFFFFF",
  "#808080","#C0C0C0","#FF0000","#FF7F7F","#CC0000","#CC6666","#990000","#994C4C",
  "#FF3300","#FF9F7F","#CC2900","#CC7F66","#993D00","#996059","#FF6600","#FFB27F",
  "#CC5200","#CC8E66","#994F00","#996B4C","#FF9900","#FFC57F","#CC7A00","#CC9E66",
  "#997A00","#99774C","#FFCC00","#FFD97F","#CCA300","#CCAE66","#99A500","#99834C",
  "#FFFF00","#FFFF7F","#CCCC00","#CCCC66","#999900","#99994C","#CCFF00","#E5FF7F",
  "#A3CC00","#B8CC66","#7A9900","#8A994C","#99FF00","#CCFF7F","#7ACC00","#A3CC66",
  "#5C9900","#7A994C","#66FF00","#B2FF7F","#52CC00","#8ECC66","#3D9900","#6B994C",
  "#33FF00","#99FF7F","#29CC00","#7ACC66","#1F9900","#5C994C","#00FF00","#7FFF7F",
];

const getColorForEntity = (entity, layerMap) => {
  if (entity.color && entity.color > 0 && entity.color < ACI_COLORS.length) {
    return ACI_COLORS[entity.color];
  }
  const layer = layerMap?.[entity.layer];
  if (layer?.color && layer.color > 0 && layer.color < ACI_COLORS.length) {
    return ACI_COLORS[layer.color];
  }
  return "#00FFFF";
};

/**
 * Convert CAD coordinates to lat/lng given anchor point, rotation, and scale.
 * CAD units are assumed to be in meters.
 */
const cadToLatLng = (L, cadX, cadY, bounds, anchorLat, anchorLng, rotation, scale, proj4String) => {
  if (proj4String) {
    try {
      // proj4 mathematically converts the local planar coordinate (cadX, cadY)
      // from the user's selected projection to global WGS84 Lat/Lng
      const [lng, lat] = proj4(proj4String, 'EPSG:4326', [cadX, cadY]);
      return L.latLng(lat, lng);
    } catch (e) {
      console.warn("Proj4 conversion failed for points:", [cadX, cadY], e);
      // Fallback to local translation if projection fails for this point
    }
  }

  // Fallback: Local arbitrary transformation based on map placement anchors
  if (anchorLat == null || anchorLng == null) {
     // If no anchor and no valid proj4, just return [0,0] to avoid crash
     return L.latLng(0, 0);
  }

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  let x = (cadX - cx) * scale;
  let y = (cadY - cy) * scale;

  // Apply rotation
  const rad = (rotation * Math.PI) / 180;
  const rx = x * Math.cos(rad) - y * Math.sin(rad);
  const ry = x * Math.sin(rad) + y * Math.cos(rad);

  // Convert meters to geographic offset
  const latOffset = ry / 111320;
  const lngOffset = rx / (111320 * Math.cos((anchorLat * Math.PI) / 180));

  return L.latLng(anchorLat + latOffset, anchorLng + lngOffset);
};

export default function LeafletMapViewer({
  parsedData,
  visibleLayers,
  showLabels = true,
  anchorLat,
  anchorLng,
  rotation,
  scale,
  proj4String,
  onAnchorChange,
  isDragging,
  onDragStart,
  onDragEnd,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawingLayerRef = useRef(null);
  const anchorMarkerRef = useRef(null);
  const LRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize Leaflet map
  useEffect(() => {
    let map;
    let cancelled = false;

    const initMap = async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      LRef.current = L;

      // Fix Leaflet default icon issue
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      map = L.map(containerRef.current, {
        center: [20.5937, 78.9629], // India center
        zoom: 5,
        zoomControl: false,
        attributionControl: false,
        maxZoom: 24,
        preferCanvas: true, // Massive optimization: draw all vectors on a single HTML5 canvas
      });

      // Satellite imagery layer (Google)
      const satellite = L.tileLayer(
        "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        { maxZoom: 24, maxNativeZoom: 21, attribution: "Google" }
      );

      // Street/Labels layer
      const streets = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 24, maxNativeZoom: 19, attribution: "OSM" }
      );

      // Hybrid: satellite + labels overlay (Google)
      const labels = L.tileLayer(
        "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        { maxZoom: 24, maxNativeZoom: 21, attribution: "Google" }
      );

      // Layer controls
      const baseMaps = {
        "Satellite": satellite,
        "Streets": streets,
      };
      const overlayMaps = {
        "Labels": labels,
      };

      satellite.addTo(map);
      labels.addTo(map);

      L.control.layers(baseMaps, overlayMaps, { position: "bottomright" }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      // Drawing layer group
      const drawingLayer = L.layerGroup().addTo(map);
      drawingLayerRef.current = drawingLayer;

      mapRef.current = map;
      setMapReady(true);

      // Click to place anchor
      map.on("click", (e) => {
        if (onAnchorChange) {
          onAnchorChange(e.latlng.lat, e.latlng.lng);
        }
      });
    };

    initMap();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
      }
      mapRef.current = null;
      drawingLayerRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Update anchor marker and fly to location
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    let centerLat = anchorLat;
    let centerLng = anchorLng;

    // If we have a projection string, we can calculate the true center of the drawing
    // without needing a manual anchor point.
    if (proj4String && parsedData?.bounds) {
       const cx = (parsedData.bounds.minX + parsedData.bounds.maxX) / 2;
       const cy = (parsedData.bounds.minY + parsedData.bounds.maxY) / 2;
       try {
         const [lng, lat] = proj4(proj4String, 'EPSG:4326', [cx, cy]);
         centerLat = lat;
         centerLng = lng;
       } catch (e) {
         console.warn("Could not calculate center from proj4:", e);
       }
    }

    if (centerLat == null || centerLng == null) return;

    // Remove old marker
    if (anchorMarkerRef.current) {
      map.removeLayer(anchorMarkerRef.current);
    }

    // Only show the draggable anchor marker if we are relying on manual placement
    if (anchorLat != null && anchorLng != null) {
      // Custom anchor icon
      const anchorIcon = L.divIcon({
        className: "anchor-marker",
        html: `<div class="anchor-marker-inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" width="24" height="24">
            <circle cx="12" cy="10" r="3"/>
            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
          </svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      const marker = L.marker([anchorLat, anchorLng], {
        icon: anchorIcon,
        draggable: true,
        zIndexOffset: 1000,
      }).addTo(map);

      // Drag to reposition
      marker.on("dragend", (e) => {
        const pos = e.target.getLatLng();
        if (onAnchorChange) {
          onAnchorChange(pos.lat, pos.lng);
        }
      });

      anchorMarkerRef.current = marker;
    }

    // Fly to the calculated center
    const drawingWidth = parsedData?.bounds
      ? ((parsedData.bounds.maxX - parsedData.bounds.minX) * scale) / 111320
      : 0.01;
    const drawingHeight = parsedData?.bounds
      ? ((parsedData.bounds.maxY - parsedData.bounds.minY) * scale) / 111320
      : 0.01;
    const maxSpan = Math.max(drawingWidth, drawingHeight, 0.002);

    map.flyTo([centerLat, centerLng], map.getBoundsZoom(
      L.latLngBounds(
        [centerLat - maxSpan, centerLng - maxSpan],
        [centerLat + maxSpan, centerLng + maxSpan]
      )
    ), { duration: 1.2 });
  }, [anchorLat, anchorLng, mapReady, proj4String, parsedData]);

  // Render CAD entities on map
  useEffect(() => {
    const L = LRef.current;
    const drawingLayer = drawingLayerRef.current;
    
    // We can render if we have a proj4String, OR if we have manual anchors
    const canRender = proj4String || (anchorLat != null && anchorLng != null);
    
    if (!L || !drawingLayer || !mapReady || !parsedData || !canRender) return;

    drawingLayer.clearLayers();

    const bounds = parsedData.bounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const layerMap = {};
    (parsedData.layers || []).forEach((l) => { layerMap[l.name] = l; });

    const toLL = (x, y) => cadToLatLng(L, x, y, bounds, anchorLat, anchorLng, rotation, scale, proj4String);

    const colorLineBatches = {};
    const colorPolygonBatches = {};

    const addLineBatch = (color, latLngs) => {
      if (!colorLineBatches[color]) colorLineBatches[color] = [];
      colorLineBatches[color].push(latLngs);
    };

    const addPolygonBatch = (color, latLngs) => {
      if (!colorPolygonBatches[color]) colorPolygonBatches[color] = [];
      colorPolygonBatches[color].push(latLngs);
    };

    const processEntity = (entity, parentTransformFunc = null, colorOverride = null) => {
      // Layer visibility check (only for top-level entities, nested take parent visibility implicitly)
      if (!parentTransformFunc && visibleLayers && !visibleLayers.has(entity.layer)) return;

      const color = colorOverride || getColorForEntity(entity, layerMap);

      const transformLL = (x, y) => {
        let pt = { x, y };
        if (parentTransformFunc) {
          pt = parentTransformFunc(x, y);
        }
        return toLL(pt.x, pt.y);
      };

      try {
        switch (entity.type) {
          case "LINE":
            if (entity.startPoint && entity.endPoint) {
              addLineBatch(color, [
                transformLL(entity.startPoint.x, entity.startPoint.y),
                transformLL(entity.endPoint.x, entity.endPoint.y),
              ]);
            }
            break;

          case "LWPOLYLINE":
          case "POLYLINE":
            if (entity.vertices?.length > 1) {
              const pts = entity.vertices.map((v) => transformLL(v.x, v.y));
              if (entity.closed && pts.length > 0) pts.push(pts[0]);
              addLineBatch(color, pts);
            }
            break;

          case "CIRCLE":
            if (entity.center && entity.radius) {
              const circlePts = [];
              for (let i = 0; i <= 64; i++) {
                const angle = (i / 64) * Math.PI * 2;
                const cx = entity.center.x + entity.radius * Math.cos(angle);
                const cy = entity.center.y + entity.radius * Math.sin(angle);
                circlePts.push(transformLL(cx, cy));
              }
              addLineBatch(color, circlePts);
            }
            break;

          case "ARC":
            if (entity.center && entity.radius) {
              const arcPts = [];
              const startAngle = ((entity.startAngle || 0) * Math.PI) / 180;
              const endAngle = ((entity.endAngle || 360) * Math.PI) / 180;
              let sweep = endAngle - startAngle;
              if (sweep <= 0) sweep += Math.PI * 2;
              for (let i = 0; i <= 64; i++) {
                const angle = startAngle + (i / 64) * sweep;
                arcPts.push(transformLL(
                  entity.center.x + entity.radius * Math.cos(angle),
                  entity.center.y + entity.radius * Math.sin(angle)
                ));
              }
              addLineBatch(color, arcPts);
            }
            break;

          case "TEXT":
          case "MTEXT":
            if (showLabels && entity.position) {
              const pos = transformLL(entity.position.x, entity.position.y);
              const text = (entity.text || "").replace(/\\P/g, "\n").replace(/\{[^}]+\}/g, "");
              if (text.trim()) {
                L.marker(pos, {
                  icon: L.divIcon({
                    className: "map-cad-label",
                    html: `<span style="color:${color}">${text}</span>`,
                    iconSize: null,
                  }),
                }).addTo(drawingLayer);
              }
            }
            break;

          case "POINT":
            if (entity.position) {
              L.circleMarker(transformLL(entity.position.x, entity.position.y), {
                radius: 3,
                color,
                fillColor: color,
                fillOpacity: 1,
                weight: 1,
              }).addTo(drawingLayer);
            }
            break;

          case "SOLID":
          case "3DFACE":
            if (entity.points?.length >= 3) {
              const polyPts = entity.points.map((p) => transformLL(p.x, p.y));
              addPolygonBatch(color, polyPts);
            }
            break;

          case "HATCH":
            if (entity.boundaries?.length) {
              entity.boundaries.forEach((b) =>
                b.forEach((path) => {
                  if (path.length >= 3) {
                    const pts = path.map((p) => transformLL(p.x, p.y));
                    addPolygonBatch(color, pts);
                  }
                })
              );
            }
            break;

          case "INSERT":
            if (entity.blockName && parsedData.blocks && parsedData.blocks[entity.blockName]) {
              const block = parsedData.blocks[entity.blockName];
              
              // Create a closure that transforms local block coordinates into its parent's coordinate space
              const blockTransformFunc = (localX, localY) => {
                let dx = localX - (block.basePoint?.x || 0);
                let dy = localY - (block.basePoint?.y || 0);
                
                dx *= (entity.scale?.x || 1);
                dy *= (entity.scale?.y || 1);
                
                const rad = ((entity.rotation || 0) * Math.PI) / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                
                const worldX = rx + (entity.position?.x || 0);
                const worldY = ry + (entity.position?.y || 0);
                
                // If this block is nested inside another block, pass it up the chain!
                return parentTransformFunc ? parentTransformFunc(worldX, worldY) : { x: worldX, y: worldY };
              };

              // Recursively process all entities inside this block
              (block.entities || []).forEach(child => processEntity(child, blockTransformFunc, color));
            }
            break;
        }
      } catch (e) {
        // Skip unparseable entities
      }
    };

    (parsedData.entities || []).forEach(ent => processEntity(ent));

    // Render accumulated multi-polylines (massive performance optimization)
    Object.keys(colorLineBatches).forEach(color => {
      L.polyline(colorLineBatches[color], { color, weight: 2, opacity: 0.85 }).addTo(drawingLayer);
    });

    // Render accumulated multi-polygons
    Object.keys(colorPolygonBatches).forEach(color => {
      L.polygon(colorPolygonBatches[color], { color, weight: 1, fillColor: color, fillOpacity: 0.15 }).addTo(drawingLayer);
    });
  }, [parsedData, visibleLayers, showLabels, anchorLat, anchorLng, rotation, scale, proj4String, mapReady]);

  return (
    <div
      ref={containerRef}
      id="leaflet-map"
      className="leaflet-map-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
    />
  );
}
