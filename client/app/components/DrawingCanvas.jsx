"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer";

// CAD color index to hex (simplified ACI palette)
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
  return "#CCCCCC";
};

export default function DrawingCanvas({ 
  parsedData, 
  visibleLayers, 
  bgColor = "dark", 
  showLabels = true,
  onSelectEntity,
  selectedEntity,
  zoom: externalZoom,
  onZoomChange,
  orthomosaic
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const labelRendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const entityGroupRef = useRef(null);
  const orthomosaicMeshRef = useRef(null);
  const [internalZoom, setInternalZoom] = useState(100);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Map to store reference from Three.js Object3D to original entity data
  const objectToEntityMap = useRef(new Map());

  // Initialize Scene/Camera once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // transparent clear
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    camera.position.set(0, 0, 1000);
    cameraRef.current = camera;

    const group = new THREE.Group();
    entityGroupRef.current = group;
    scene.add(group);

    const render = () => {
      if (!renderer.domElement.parentNode) return;
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    container._render = render;

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;

      const aspect = w / h;
      camera.left = -500 * aspect;
      camera.right = 500 * aspect;
      camera.top = 500;
      camera.bottom = -500;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      render();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    const animate = () => {
      if (!rendererRef.current) return;
      requestAnimationFrame(animate);
      render();
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      if (renderer.domElement.parentNode) container.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentNode) container.removeChild(labelRenderer.domElement);
      renderer.dispose();
    };
  }, []);

  // Update Scene Content
  useEffect(() => {
    if (!parsedData || !entityGroupRef.current) return;

    const scene = sceneRef.current;
    const group = entityGroupRef.current;

    // Clear existing
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
      group.remove(child);
    }
    objectToEntityMap.current.clear();

    const layerMap = {};
    (parsedData.layers || []).forEach(l => { layerMap[l.name] = l; });

    // Initial Fit View (only once or on new data)
    if (parsedData.bounds && cameraRef.current) {
      const b = parsedData.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const dx = b.maxX - b.minX || 100;
      const dy = b.maxY - b.minY || 100;
      
      const cam = cameraRef.current;
      cam.position.set(cx, cy, 1000);
      
      const container = containerRef.current;
      const aspect = container.clientWidth / container.clientHeight;
      const viewWidth = dx * 1.1;
      const viewHeight = dy * 1.1;
      
      // Calculate zoom to fit
      const zoomX = (1000 * aspect) / viewWidth;
      const zoomY = 1000 / viewHeight;
      cam.zoom = Math.min(zoomX, zoomY);
      cam.updateProjectionMatrix();
      setInternalZoom(Math.round(cam.zoom * 100));
    }

    const colorGroups = {}; // hexColor -> { positions: [], entityMap: [] }

    const addLineSegment = (hexColor, p1, p2, entity) => {
      if (!colorGroups[hexColor]) colorGroups[hexColor] = { positions: [], entityMap: [] };
      const cg = colorGroups[hexColor];
      const idx = cg.positions.length / 3;
      cg.positions.push(p1.x, p1.y, 0, p2.x, p2.y, 0);
      cg.entityMap[idx] = entity;
      cg.entityMap[idx + 1] = entity;
    };

    (parsedData.entities || []).forEach((entity) => {
      if (visibleLayers && !visibleLayers.has(entity.layer)) return;
      
      const hexColor = getColorForEntity(entity, layerMap);
      const isSelected = selectedEntity && 
                        selectedEntity.type === entity.type && 
                        selectedEntity.layer === entity.layer && 
                        JSON.stringify(entity.position || entity.startPoint) === JSON.stringify(selectedEntity.position || selectedEntity.startPoint);

      const color = isSelected ? "#ffffff" : hexColor;

      switch (entity.type) {
        case "LINE":
          if (entity.startPoint && entity.endPoint) {
            addLineSegment(color, entity.startPoint, entity.endPoint, entity);
          }
          break;

        case "LWPOLYLINE":
        case "POLYLINE": {
          const verts = entity.vertices;
          if (verts?.length) {
            for (let i = 0; i < verts.length - 1; i++) {
              const v0 = verts[i];
              const v1 = verts[i + 1];
              const bulge = v0.bulge || 0;
              if (Math.abs(bulge) < 1e-9) {
                // Straight segment
                addLineSegment(color, v0, v1, entity);
              } else {
                // Arc segment from bulge
                const dx = v1.x - v0.x;
                const dy = v1.y - v0.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1e-9) break;
                const r = (dist / 2) * (1 / Math.abs(bulge) + Math.abs(bulge)) / 2;
                const a = 4 * Math.atan(Math.abs(bulge));
                const midX = (v0.x + v1.x) / 2;
                const midY = (v0.y + v1.y) / 2;
                const d = Math.sqrt(r * r - (dist / 2) * (dist / 2));
                const nx = -dy / dist;
                const ny = dx / dist;
                const sign = bulge > 0 ? -1 : 1;
                const cx = midX + sign * d * nx;
                const cy = midY + sign * d * ny;
                const startAng = Math.atan2(v0.y - cy, v0.x - cx);
                const endAng = Math.atan2(v1.y - cy, v1.x - cx);
                const curve = new THREE.EllipseCurve(cx, cy, r, r,
                  startAng, endAng, bulge < 0);
                const bPts = curve.getPoints(Math.max(8, Math.ceil(a / (Math.PI / 16))));
                for (let j = 0; j < bPts.length - 1; j++) {
                  addLineSegment(color, bPts[j], bPts[j + 1], entity);
                }
              }
            }
            if (entity.closed && verts.length > 1) {
              addLineSegment(color, verts[verts.length - 1], verts[0], entity);
            }
          }
          break;
        }

        case "CIRCLE":
          if (entity.center) {
            const curve = new THREE.EllipseCurve(
              entity.center.x, entity.center.y,
              entity.radius, entity.radius,
              0, Math.PI * 2
            );
            const pts = curve.getPoints(72);
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, pts[i], pts[i + 1], entity);
            // Close the circle
            addLineSegment(color, pts[pts.length - 1], pts[0], entity);
          }
          break;

        case "ARC":
          if (entity.center) {
            let sA = (entity.startAngle || 0) * Math.PI / 180;
            let eA = (entity.endAngle || 360) * Math.PI / 180;
            // Normalize for THREE.js EllipseCurve (counterclockwise)
            const curve = new THREE.EllipseCurve(
              entity.center.x, entity.center.y,
              entity.radius, entity.radius,
              sA, eA, false
            );
            const pts = curve.getPoints(72);
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, pts[i], pts[i + 1], entity);
          }
          break;

        case "ELLIPSE":
          if (entity.center && entity.majorAxis) {
            const { x: cx, y: cy } = entity.center;
            const { x: mx, y: my } = entity.majorAxis;
            const majorR = Math.sqrt(mx * mx + my * my);
            const minorR = majorR * (entity.axisRatio || 1);
            const rotAngle = Math.atan2(my, mx);
            const sA = entity.startAngle || 0;
            const eA = entity.endAngle || Math.PI * 2;
            const curve = new THREE.EllipseCurve(cx, cy, majorR, minorR, sA, eA, false, rotAngle);
            const pts = curve.getPoints(72);
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, pts[i], pts[i + 1], entity);
          }
          break;

        case "SPLINE":
          // Use control points or fit points to draw a Catmull-Rom approximation
          {
            const pts = entity.controlPoints?.length ? entity.controlPoints : entity.fitPoints || [];
            if (pts.length >= 2) {
              if (pts.length === 2) {
                addLineSegment(color, pts[0], pts[1], entity);
              } else {
                // Catmull-Rom through the control points
                const vecs = pts.map(p => new THREE.Vector2(p.x, p.y));
                const curve = new THREE.SplineCurve(vecs);
                const splinePts = curve.getPoints(Math.max(pts.length * 8, 64));
                for (let i = 0; i < splinePts.length - 1; i++) {
                  addLineSegment(color, splinePts[i], splinePts[i + 1], entity);
                }
              }
            }
          }
          break;

        case "POINT":
          // Render points as a small cross
          if (entity.position) {
            const { x, y } = entity.position;
            const s = 2; // cross size
            addLineSegment(color, { x: x - s, y }, { x: x + s, y }, entity);
            addLineSegment(color, { x, y: y - s }, { x, y: y + s }, entity);
          }
          break;

        case "TEXT":
        case "MTEXT":
          if (entity.position && showLabels) {
            const div = document.createElement("div");
            div.className = `drawing-label ${bgColor === "light" ? "light" : "dark"} ${isSelected ? "selected" : ""}`;
            div.textContent = (entity.text || "").replace(/\\P/g, "\n").replace(/\{[^}]+\}/g, "");
            div.style.color = color;
            const label = new CSS2DObject(div);
            label.position.set(entity.position.x, entity.position.y, 0);
            group.add(label);
          }
          break;

        case "SOLID":
        case "3DFACE":
          if (entity.points?.length >= 3) {
            const shape = new THREE.Shape();
            shape.moveTo(entity.points[0].x, entity.points[0].y);
            entity.points.slice(1).forEach(p => shape.lineTo(p.x, p.y));
            const mesh = new THREE.Mesh(
              new THREE.ShapeGeometry(shape),
              new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
            );
            group.add(mesh);
            objectToEntityMap.current.set(mesh, entity);
          }
          break;

        case "HATCH":
          if (entity.boundaries?.length) {
            entity.boundaries.forEach(b => b.forEach(path => {
              if (path.length >= 3) {
                const s = new THREE.Shape();
                s.moveTo(path[0].x, path[0].y);
                path.slice(1).forEach(p => s.lineTo(p.x, p.y));
                const hMesh = new THREE.Mesh(
                  new THREE.ShapeGeometry(s),
                  new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
                );
                group.add(hMesh);
                objectToEntityMap.current.set(hMesh, entity);
              }
            }));
          }
          break;

        // INSERT — resolve block geometry and draw actual shapes
        case "INSERT":
          if (entity.position) {
            const blockDef = parsedData.blocks?.[entity.blockName];
            if (blockDef && blockDef.entities?.length > 0) {
              // Transform each block entity to the INSERT position/scale/rotation
              const ix = entity.position.x;
              const iy = entity.position.y;
              const sx = entity.scale?.x || 1;
              const sy = entity.scale?.y || 1;
              const rot = (entity.rotation || 0) * Math.PI / 180;
              const cosR = Math.cos(rot);
              const sinR = Math.sin(rot);
              const bx = blockDef.basePoint?.x || 0;
              const by = blockDef.basePoint?.y || 0;

              // Helper: transform a point from block space to world space
              const txPt = (px, py) => {
                const lx = (px - bx) * sx;
                const ly = (py - by) * sy;
                return {
                  x: lx * cosR - ly * sinR + ix,
                  y: lx * sinR + ly * cosR + iy,
                };
              };

              blockDef.entities.forEach(bEnt => {
                switch (bEnt.type) {
                  case "LINE":
                    if (bEnt.startPoint && bEnt.endPoint) {
                      addLineSegment(color, txPt(bEnt.startPoint.x, bEnt.startPoint.y), txPt(bEnt.endPoint.x, bEnt.endPoint.y), entity);
                    }
                    break;
                  case "LWPOLYLINE":
                  case "POLYLINE":
                    if (bEnt.vertices?.length > 1) {
                      for (let i = 0; i < bEnt.vertices.length - 1; i++) {
                        addLineSegment(color, txPt(bEnt.vertices[i].x, bEnt.vertices[i].y), txPt(bEnt.vertices[i+1].x, bEnt.vertices[i+1].y), entity);
                      }
                      if (bEnt.closed) {
                        addLineSegment(color, txPt(bEnt.vertices[bEnt.vertices.length-1].x, bEnt.vertices[bEnt.vertices.length-1].y), txPt(bEnt.vertices[0].x, bEnt.vertices[0].y), entity);
                      }
                    }
                    break;
                  case "CIRCLE":
                    if (bEnt.center) {
                      const cr = bEnt.radius || 0;
                      const steps = Math.max(24, Math.ceil(cr * 4));
                      for (let i = 0; i < steps; i++) {
                        const a1 = (i / steps) * Math.PI * 2;
                        const a2 = ((i + 1) / steps) * Math.PI * 2;
                        addLineSegment(color,
                          txPt(bEnt.center.x + cr * Math.cos(a1), bEnt.center.y + cr * Math.sin(a1)),
                          txPt(bEnt.center.x + cr * Math.cos(a2), bEnt.center.y + cr * Math.sin(a2)),
                          entity);
                      }
                    }
                    break;
                  case "ARC":
                    if (bEnt.center) {
                      const ar = bEnt.radius || 0;
                      let sA = (bEnt.startAngle || 0) * Math.PI / 180;
                      let eA = (bEnt.endAngle || 360) * Math.PI / 180;
                      let sweep = eA - sA;
                      if (sweep <= 0) sweep += Math.PI * 2;
                      const arcSteps = Math.max(16, Math.ceil(sweep / (Math.PI / 16)));
                      for (let i = 0; i < arcSteps; i++) {
                        const a1 = sA + (i / arcSteps) * sweep;
                        const a2 = sA + ((i + 1) / arcSteps) * sweep;
                        addLineSegment(color,
                          txPt(bEnt.center.x + ar * Math.cos(a1), bEnt.center.y + ar * Math.sin(a1)),
                          txPt(bEnt.center.x + ar * Math.cos(a2), bEnt.center.y + ar * Math.sin(a2)),
                          entity);
                      }
                    }
                    break;
                  case "POINT":
                    if (bEnt.position) {
                      const pp = txPt(bEnt.position.x, bEnt.position.y);
                      const ps = 1;
                      addLineSegment(color, { x: pp.x - ps, y: pp.y }, { x: pp.x + ps, y: pp.y }, entity);
                      addLineSegment(color, { x: pp.x, y: pp.y - ps }, { x: pp.x, y: pp.y + ps }, entity);
                    }
                    break;
                  default:
                    // For other entity types in blocks (like 3DFACE, SOLID), draw lines if they have vertices
                    if (bEnt.vertices?.length > 1) {
                      for (let i = 0; i < bEnt.vertices.length - 1; i++) {
                        addLineSegment(color, txPt(bEnt.vertices[i].x, bEnt.vertices[i].y), txPt(bEnt.vertices[i+1].x, bEnt.vertices[i+1].y), entity);
                      }
                      // Close the shape for faces/solids
                      if (bEnt.type === '3DFACE' || bEnt.type === 'SOLID' || bEnt.type === 'TRACE' || bEnt.closed) {
                         addLineSegment(color, txPt(bEnt.vertices[bEnt.vertices.length-1].x, bEnt.vertices[bEnt.vertices.length-1].y), txPt(bEnt.vertices[0].x, bEnt.vertices[0].y), entity);
                      }
                    }
                    break;
                }
              });
            } else {
              // Fallback: small dot if block definition not found
              const { x, y } = entity.position;
              const ds = 1.5;
              addLineSegment(color, { x: x - ds, y }, { x: x + ds, y }, entity);
              addLineSegment(color, { x, y: y - ds }, { x, y: y + ds }, entity);
            }
          }
          break;

        // DIMENSION — draw a small marker at the anchor point
        case "DIMENSION":
          if (entity.anchorPoint) {
            const { x, y } = entity.anchorPoint;
            const ds = 3;
            addLineSegment(color, { x: x - ds, y }, { x: x + ds, y }, entity);
            addLineSegment(color, { x, y: y - ds }, { x, y: y + ds }, entity);
          }
          break;

        default:
          // Unhandled types — silently skip but could log for debugging
          break;
      }
    });

    // Create Batched LineSegments
    Object.keys(colorGroups).forEach(hexColor => {
      const cg = colorGroups[hexColor];
      if (cg.positions.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(cg.positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: hexColor, transparent: true, opacity: hexColor === "#ffffff" ? 1 : 0.8 });
      const lineSegments = new THREE.LineSegments(geo, mat);
      
      lineSegments.userData.entityMap = cg.entityMap;
      group.add(lineSegments);
    });
  }, [parsedData, visibleLayers, bgColor, showLabels, selectedEntity]);

  // Separate effect for background color based on orthomosaic mode
  useEffect(() => {
    if (!sceneRef.current) return;
    if (orthomosaic?.url) {
      sceneRef.current.background = null;
    } else {
      sceneRef.current.background = new THREE.Color(bgColor === "light" ? 0xf5f5f5 : 0x0a0a0f);
    }
  }, [orthomosaic?.url, bgColor]);

  // Handle External Zoom Prop
  useEffect(() => {
    const cam = cameraRef.current;
    if (cam && externalZoom !== undefined) {
      const newZoom = externalZoom / 100;
      if (Math.abs(cam.zoom - newZoom) > 0.01) {
        cam.zoom = newZoom;
        cam.updateProjectionMatrix();
        setInternalZoom(externalZoom);
      }
    }
  }, [externalZoom]);

  // Handle Orthomosaic Background - LOAD texture
  useEffect(() => {
    if (!sceneRef.current) return;

    // If no orthomosaic URL, remove existing mesh
    if (!orthomosaic?.url) {
      if (orthomosaicMeshRef.current) {
        sceneRef.current.remove(orthomosaicMeshRef.current);
        orthomosaicMeshRef.current.geometry.dispose();
        if (orthomosaicMeshRef.current.material.map) orthomosaicMeshRef.current.material.map.dispose();
        orthomosaicMeshRef.current.material.dispose();
        orthomosaicMeshRef.current = null;
      }
      return;
    }

    // Only load if URL actually changed
    if (orthomosaicMeshRef.current?.userData?.loadedUrl === orthomosaic.url) {
      return; // Already loaded this URL
    }

    // Clean up old mesh before loading new one
    if (orthomosaicMeshRef.current) {
      sceneRef.current.remove(orthomosaicMeshRef.current);
      orthomosaicMeshRef.current.geometry.dispose();
      if (orthomosaicMeshRef.current.material.map) orthomosaicMeshRef.current.material.map.dispose();
      orthomosaicMeshRef.current.material.dispose();
      orthomosaicMeshRef.current = null;
    }

    let cancelled = false;

    // Fetch image as blob to completely bypass CORS issues with Three.js textures
    const loadImage = async () => {
      try {
        console.log("[Orthomosaic] Fetching image from:", orthomosaic.url);
        const response = await fetch(orthomosaic.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        
        // Use a plain Image element to get dimensions and create texture
        const img = new Image();
        img.onload = () => {
          if (cancelled || !sceneRef.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          console.log(`[Orthomosaic] Image loaded: ${img.width}x${img.height}`);

          const texture = new THREE.Texture(img);
          texture.needsUpdate = true;
          texture.colorSpace = THREE.SRGBColorSpace;

          const geometry = new THREE.PlaneGeometry(img.width, img.height);
          const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
          });

          // Calculate drawing center and auto-scale so the image covers the drawing area
          const bounds = parsedData?.bounds;
          const drawingCenterX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
          const drawingCenterY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;
          const drawingWidth = bounds ? Math.abs(bounds.maxX - bounds.minX) || 100 : 100;
          const drawingHeight = bounds ? Math.abs(bounds.maxY - bounds.minY) || 100 : 100;

          // Auto-scale: fit image to cover drawing bounds
          const scaleX = drawingWidth / img.width;
          const scaleY = drawingHeight / img.height;
          const baseScale = Math.max(scaleX, scaleY) * 1.1; // 10% padding to ensure full coverage

          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = -1;

          // Position at drawing center + user offset
          const userScale = orthomosaic.scale || 1;
          mesh.position.set(
            drawingCenterX + (orthomosaic.offsetX || 0),
            drawingCenterY + (orthomosaic.offsetY || 0),
            -500
          );
          mesh.scale.set(baseScale * userScale, baseScale * userScale, 1);
          mesh.rotation.z = -(orthomosaic.rotation || 0) * (Math.PI / 180);
          mesh.userData.loadedUrl = orthomosaic.url;
          mesh.userData.baseScale = baseScale;
          mesh.userData.drawingCenterX = drawingCenterX;
          mesh.userData.drawingCenterY = drawingCenterY;

          console.log(`[Orthomosaic] Mesh positioned at drawing center (${drawingCenterX.toFixed(1)}, ${drawingCenterY.toFixed(1)}), baseScale=${baseScale.toFixed(4)}, imgSize=${img.width}x${img.height}, drawingSize=${drawingWidth.toFixed(1)}x${drawingHeight.toFixed(1)}`);

          sceneRef.current.add(mesh);
          orthomosaicMeshRef.current = mesh;

          URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => {
          console.error("[Orthomosaic] Failed to decode image blob");
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
      } catch (err) {
        console.error("[Orthomosaic] Fetch failed:", err);
      }
    };

    loadImage();

    return () => { cancelled = true; };
  }, [orthomosaic?.url]); // ONLY re-run when URL changes

  // Handle Orthomosaic Background - UPDATE transforms (separate from loading)
  useEffect(() => {
    if (!orthomosaicMeshRef.current || !orthomosaic) return;
    const mesh = orthomosaicMeshRef.current;
    const baseScale = mesh.userData.baseScale || 1;
    const centerX = mesh.userData.drawingCenterX || 0;
    const centerY = mesh.userData.drawingCenterY || 0;
    const userScale = orthomosaic.scale || 1;
    mesh.scale.set(baseScale * userScale, baseScale * userScale, 1);
    mesh.rotation.z = -(orthomosaic.rotation || 0) * (Math.PI / 180);
    mesh.position.x = centerX + (orthomosaic.offsetX || 0);
    mesh.position.y = centerY + (orthomosaic.offsetY || 0);
  }, [orthomosaic?.scale, orthomosaic?.rotation, orthomosaic?.offsetX, orthomosaic?.offsetY]);

  // Interaction logic
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e) => {
      e.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      cam.zoom *= factor;
      cam.updateProjectionMatrix();
      
      const newZoom = Math.round(cam.zoom * 100);
      setInternalZoom(newZoom);
      if (onZoomChange) onZoomChange(newZoom);
    };

    const onMouseDown = (e) => {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isPanningRef.current) {
        const cam = cameraRef.current;
        if (!cam) return;
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        
        // Convert screen pixels to camera world units
        const unitsPerPixel = (cam.right - cam.left) / (cam.zoom * container.clientWidth);
        cam.position.x -= dx * unitsPerPixel;
        cam.position.y += dy * unitsPerPixel;
        
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = (e) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
      } else if (e.button === 0) {
        const cam = cameraRef.current;
        if (!cam || !entityGroupRef.current) return;
        raycasterRef.current.setFromCamera(mouseRef.current, cam);
        raycasterRef.current.params.Line.threshold = 5 / cam.zoom;
        const hits = raycasterRef.current.intersectObjects(entityGroupRef.current.children, true);
        if (hits.length > 0) {
          const hit = hits[0];
          let entity = null;
          if (hit.object.userData && hit.object.userData.entityMap && hit.index !== undefined) {
             entity = hit.object.userData.entityMap[hit.index];
          } else {
             entity = objectToEntityMap.current.get(hit.object);
          }
          if (onSelectEntity) onSelectEntity(entity);
        } else {
          if (onSelectEntity) onSelectEntity(null);
        }
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onZoomChange, onSelectEntity]);

  return <div ref={containerRef} className="drawing-canvas-container" style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }} />;
}
