const fs = require('fs');
const file = 'client/app/components/DrawingCanvas.jsx';
let content = fs.readFileSync(file, 'utf8');

// The replacement logic:
const newLoop = `
    const processEntity = (entity, transform = null, isRootSelected = false) => {
      // Only check layer visibility for root entities (transform is null)
      if (!transform && visibleLayers && !visibleLayers.has(entity.layer)) return;
      
      const hexColor = getColorForEntity(entity, layerMap);
      const isSelected = isRootSelected || (selectedEntity && 
                        selectedEntity.type === entity.type && 
                        selectedEntity.layer === entity.layer && 
                        JSON.stringify(entity.position || entity.startPoint) === JSON.stringify(selectedEntity.position || selectedEntity.startPoint));

      const color = isSelected ? "#ffffff" : hexColor;
      
      // Coordinate transformer (identity function for root entities)
      const tx = transform || ((x, y) => ({ x, y }));

      switch (entity.type) {
        case "LINE":
          if (entity.startPoint && entity.endPoint) {
            addLineSegment(color, tx(entity.startPoint.x, entity.startPoint.y), tx(entity.endPoint.x, entity.endPoint.y), entity);
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
                addLineSegment(color, tx(v0.x, v0.y), tx(v1.x, v1.y), entity);
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
                const curve = new THREE.EllipseCurve(cx, cy, r, r, startAng, endAng, bulge < 0);
                const bPts = curve.getPoints(Math.max(8, Math.ceil(a / (Math.PI / 16))));
                for (let j = 0; j < bPts.length - 1; j++) {
                  addLineSegment(color, tx(bPts[j].x, bPts[j].y), tx(bPts[j + 1].x, bPts[j + 1].y), entity);
                }
              }
            }
            if (entity.closed && verts.length > 1) {
              addLineSegment(color, tx(verts[verts.length - 1].x, verts[verts.length - 1].y), tx(verts[0].x, verts[0].y), entity);
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
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, tx(pts[i].x, pts[i].y), tx(pts[i + 1].x, pts[i + 1].y), entity);
            addLineSegment(color, tx(pts[pts.length - 1].x, pts[pts.length - 1].y), tx(pts[0].x, pts[0].y), entity);
          }
          break;

        case "ARC":
          if (entity.center) {
            let sA = (entity.startAngle || 0) * Math.PI / 180;
            let eA = (entity.endAngle || 360) * Math.PI / 180;
            const curve = new THREE.EllipseCurve(
              entity.center.x, entity.center.y,
              entity.radius, entity.radius,
              sA, eA, false
            );
            const pts = curve.getPoints(72);
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, tx(pts[i].x, pts[i].y), tx(pts[i + 1].x, pts[i + 1].y), entity);
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
            for (let i = 0; i < pts.length - 1; i++) addLineSegment(color, tx(pts[i].x, pts[i].y), tx(pts[i + 1].x, pts[i + 1].y), entity);
          }
          break;

        case "SPLINE":
          {
            const pts = entity.controlPoints?.length ? entity.controlPoints : entity.fitPoints || [];
            if (pts.length >= 2) {
              if (pts.length === 2) {
                addLineSegment(color, tx(pts[0].x, pts[0].y), tx(pts[1].x, pts[1].y), entity);
              } else {
                const vecs = pts.map(p => new THREE.Vector2(p.x, p.y));
                const curve = new THREE.SplineCurve(vecs);
                const splinePts = curve.getPoints(Math.max(pts.length * 8, 64));
                for (let i = 0; i < splinePts.length - 1; i++) {
                  addLineSegment(color, tx(splinePts[i].x, splinePts[i].y), tx(splinePts[i + 1].x, splinePts[i + 1].y), entity);
                }
              }
            }
          }
          break;

        case "POINT":
          if (entity.position) {
            const pp = tx(entity.position.x, entity.position.y);
            const s = 2; // cross size
            addLineSegment(color, { x: pp.x - s, y: pp.y }, { x: pp.x + s, y: pp.y }, entity);
            addLineSegment(color, { x: pp.x, y: pp.y - s }, { x: pp.x, y: pp.y + s }, entity);
          }
          break;

        case "TEXT":
        case "MTEXT":
          if (entity.position && showLabels) {
            const div = document.createElement("div");
            div.className = \`drawing-label \${bgColor === "light" ? "light" : "dark"} \${isSelected ? "selected" : ""}\`;
            div.textContent = (entity.text || "").replace(/\\\\P/g, "\\n").replace(/\\{[^}]+\\}/g, "");
            div.style.color = color;
            const label = new CSS2DObject(div);
            const pp = tx(entity.position.x, entity.position.y);
            label.position.set(pp.x, pp.y, 0);
            group.add(label);
          }
          break;

        case "SOLID":
        case "3DFACE":
          if (entity.points?.length >= 3) {
            const shape = new THREE.Shape();
            const p0 = tx(entity.points[0].x, entity.points[0].y);
            shape.moveTo(p0.x, p0.y);
            entity.points.slice(1).forEach(p => {
              const pp = tx(p.x, p.y);
              shape.lineTo(pp.x, pp.y);
            });
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
                const p0 = tx(path[0].x, path[0].y);
                s.moveTo(p0.x, p0.y);
                path.slice(1).forEach(p => {
                  const pp = tx(p.x, p.y);
                  s.lineTo(pp.x, pp.y);
                });
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

        case "INSERT":
          if (entity.position) {
            const blockDef = parsedData.blocks?.[entity.blockName];
            if (blockDef && blockDef.entities?.length > 0) {
              const ix = entity.position.x;
              const iy = entity.position.y;
              const sx = entity.scale?.x || 1;
              const sy = entity.scale?.y || 1;
              const rot = (entity.rotation || 0) * Math.PI / 180;
              const cosR = Math.cos(rot);
              const sinR = Math.sin(rot);
              const bx = blockDef.basePoint?.x || 0;
              const by = blockDef.basePoint?.y || 0;

              const blockTx = (px, py) => {
                const lx = (px - bx) * sx;
                const ly = (py - by) * sy;
                const wx = lx * cosR - ly * sinR + ix;
                const wy = lx * sinR + ly * cosR + iy;
                return tx(wx, wy);
              };

              blockDef.entities.forEach(bEnt => processEntity(bEnt, blockTx, isSelected));
            } else {
              const pp = tx(entity.position.x, entity.position.y);
              const ds = 1.5;
              addLineSegment(color, { x: pp.x - ds, y: pp.y }, { x: pp.x + ds, y: pp.y }, entity);
              addLineSegment(color, { x: pp.x, y: pp.y - ds }, { x: pp.x, y: pp.y + ds }, entity);
            }
          }
          break;

        case "DIMENSION":
          if (entity.anchorPoint) {
            const pp = tx(entity.anchorPoint.x, entity.anchorPoint.y);
            const ds = 3;
            addLineSegment(color, { x: pp.x - ds, y: pp.y }, { x: pp.x + ds, y: pp.y }, entity);
            addLineSegment(color, { x: pp.x, y: pp.y - ds }, { x: pp.x, y: pp.y + ds }, entity);
          }
          break;
      }
    };

    // Kick off rendering for all root entities
    (parsedData.entities || []).forEach(entity => processEntity(entity));
`;

const startIndex = content.indexOf('(parsedData.entities || []).forEach((entity) => {');
const endIndex = content.indexOf('    });', startIndex) + 7;

if (startIndex > -1 && endIndex > -1) {
  content = content.substring(0, startIndex) + newLoop.trim() + content.substring(endIndex);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully refactored rendering loop');
} else {
  console.log('Failed to find target bounds');
}
