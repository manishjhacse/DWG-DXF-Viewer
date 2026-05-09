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
  onZoomChange
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const labelRendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const entityGroupRef = useRef(null);
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
    scene.background = new THREE.Color(bgColor === "light" ? 0xf5f5f5 : 0x0a0a0f);

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
        case "POLYLINE":
          if (entity.vertices?.length) {
            for (let i = 0; i < entity.vertices.length - 1; i++) {
              addLineSegment(color, entity.vertices[i], entity.vertices[i + 1], entity);
            }
            if (entity.closed && entity.vertices.length > 0) {
              addLineSegment(color, entity.vertices[entity.vertices.length - 1], entity.vertices[0], entity);
            }
          }
          break;
        case "CIRCLE":
          if (entity.center) {
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, 0, Math.PI * 2);
            const pts = curve.getPoints(64);
            for (let i = 0; i < pts.length - 1; i++) {
              addLineSegment(color, pts[i], pts[i + 1], entity);
            }
          }
          break;
        case "ARC":
          if (entity.center) {
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, (entity.startAngle || 0) * Math.PI/180, (entity.endAngle || 360) * Math.PI/180);
            const pts = curve.getPoints(64);
            for (let i = 0; i < pts.length - 1; i++) {
              addLineSegment(color, pts[i], pts[i + 1], entity);
            }
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
            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
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
                const hMesh = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, side: THREE.DoubleSide }));
                group.add(hMesh);
                objectToEntityMap.current.set(hMesh, entity);
              }
            }));
          }
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
