"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import dynamic from "next/dynamic";
import LayerPanel from "../../components/LayerPanel";
import Toolbar from "../../components/Toolbar";
import EntityInspector from "../../components/EntityInspector";

// Dynamic import to avoid SSR issues with Three.js
const DrawingCanvas = dynamic(() => import("../../components/DrawingCanvas"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ViewerPage() {
  const params = useParams();
  const [drawing, setDrawing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState(new Set());
  const [bgColor, setBgColor] = useState("dark");
  const [zoom, setZoom] = useState(100);
  const [showLabels, setShowLabels] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const canvasKeyRef = useRef(0);

  useEffect(() => {
    const fetchDrawing = async () => {
      try {
        const res = await axios.get(`${API}/api/files/${params.id}`);
        const d = res.data.drawing;
        setDrawing(d);

        // Initialize all layers as visible
        if (d.parsedData?.layers) {
          setVisibleLayers(new Set(d.parsedData.layers.map(l => l.name)));
        }
      } catch (err) {
        setError(err.response?.data?.error || "Failed to load drawing");
      } finally {
        setLoading(false);
      }
    };

    if (params.id) fetchDrawing();
  }, [params.id]);

  const handleToggleLayer = useCallback((layerName) => {
    setVisibleLayers(prev => {
      const next = new Set(prev);
      if (layerName === "__SHOW_ALL__") {
        drawing?.parsedData?.layers?.forEach(l => next.add(l.name));
      } else if (layerName === "__HIDE_ALL__") {
        next.clear();
      } else if (next.has(layerName)) {
        next.delete(layerName);
      } else {
        next.add(layerName);
      }
      return next;
    });
    canvasKeyRef.current++;
  }, [drawing]);

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(z * 1.2, 1000)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(z / 1.2, 10)), []);
  const handleFitView = useCallback(() => {
    setZoom(100);
    canvasKeyRef.current++;
  }, []);
  const handleToggleBg = useCallback(() => setBgColor(c => c === "dark" ? "light" : "dark"), []);
  const handleToggleLabels = useCallback(() => setShowLabels(s => !s), []);
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed(s => !s), []);

  if (loading) {
    return (
      <div className="viewer-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">Loading drawing...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="viewer-container">
        <div className="error-container">
          <div className="error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <h3>Error Loading Drawing</h3>
          <p className="error-message">{error}</p>
          <a href="/" className="btn-primary">← Back to Home</a>
        </div>
      </div>
    );
  }

  if (!drawing?.parsedData) {
    return (
      <div className="viewer-container">
        <div className="error-container">
          <div className="loading-spinner" />
          <h3>Drawing is still processing...</h3>
          <p className="error-message">Please wait or refresh the page.</p>
          <a href="/" className="btn-secondary">← Back to Home</a>
        </div>
      </div>
    );
  }

  const { parsedData, metadata } = drawing;
  const bounds = parsedData.bounds || metadata?.bounds || {};

  return (
    <div className="viewer-container">
      {/* Sidebar */}
      <div className={`viewer-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <button className="sidebar-toggle" onClick={handleToggleSidebar} title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none' }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        
        <div className="viewer-sidebar-content">
          <div className="viewer-sidebar-header">
            <h2>{drawing.originalName}</h2>
            <p>{drawing.fileType?.toUpperCase()} · {metadata?.entityCount || 0} entities</p>
          </div>

          {/* Drawing Info */}
          <div className="viewer-sidebar-section">
            <h3>Drawing Info</h3>
            <div className="info-grid">
              <div className="info-item">
                <div className="info-item-label">Entities</div>
                <div className="info-item-value">{metadata?.entityCount || 0}</div>
              </div>
              <div className="info-item">
                <div className="info-item-label">Layers</div>
                <div className="info-item-value">{metadata?.layers?.length || 0}</div>
              </div>
              <div className="info-item">
                <div className="info-item-label">Width</div>
                <div className="info-item-value">{((bounds.maxX || 0) - (bounds.minX || 0)).toFixed(1)}</div>
              </div>
              <div className="info-item">
                <div className="info-item-label">Height</div>
                <div className="info-item-value">{((bounds.maxY || 0) - (bounds.minY || 0)).toFixed(1)}</div>
              </div>
            </div>
          </div>

          {/* Layers */}
          <LayerPanel
            layers={parsedData.layers}
            visibleLayers={visibleLayers}
            onToggleLayer={handleToggleLayer}
          />

          {/* Actions */}
          <div className="viewer-sidebar-section">
            <h3>Actions</h3>
            <a href="/" className="btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
              ← Upload New File
            </a>
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div className={`viewer-canvas ${bgColor === "light" ? "light-bg" : "dark-bg"}`}>
        <DrawingCanvas
          key={canvasKeyRef.current}
          parsedData={parsedData}
          visibleLayers={visibleLayers}
          bgColor={bgColor}
          showLabels={showLabels}
          onSelectEntity={setSelectedEntity}
          selectedEntity={selectedEntity}
          zoom={zoom}
          onZoomChange={setZoom}
        />
        
        {selectedEntity && (
          <EntityInspector 
            entity={selectedEntity} 
            onClose={() => setSelectedEntity(null)} 
          />
        )}

        <Toolbar
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
          bgColor={bgColor}
          onToggleBg={handleToggleBg}
          showLabels={showLabels}
          onToggleLabels={handleToggleLabels}
          onToggleSidebar={handleToggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </div>
  );
}
