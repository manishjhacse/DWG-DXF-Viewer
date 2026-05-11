"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import dynamic from "next/dynamic";
import LayerPanel from "../../components/LayerPanel";
import Toolbar from "../../components/Toolbar";
import EntityInspector from "../../components/EntityInspector";
import MapPlacementControls from "../../components/MapPlacementControls";
import OrthomosaicControls from "../../components/OrthomosaicControls";

// Dynamic imports to avoid SSR issues
const DrawingCanvas = dynamic(() => import("../../components/DrawingCanvas"), { ssr: false });
const LeafletMapViewer = dynamic(() => import("../../components/LeafletMapViewer"), { ssr: false });

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

  // Map placement state
  const [viewMode, setViewMode] = useState("2d"); // "2d" | "map" | "orthomosaic"
  const [anchorLat, setAnchorLat] = useState(null);
  const [anchorLng, setAnchorLng] = useState(null);
  const [mapRotation, setMapRotation] = useState(0);
  const [mapScale, setMapScale] = useState(1);
  const [mapKey, setMapKey] = useState(0); // Force re-render on mode switch

  // Orthomosaic state
  const [orthomosaicState, setOrthomosaicState] = useState(null);
  const [isUploadingOrthomosaic, setIsUploadingOrthomosaic] = useState(false);

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

        // Initialize map placement if geolocation metadata exists
        if (d.metadata?.geolocation) {
          setAnchorLat(d.metadata.geolocation.latitude);
          setAnchorLng(d.metadata.geolocation.longitude);
        }

        if (d.orthomosaic) {
          setOrthomosaicState(d.orthomosaic);
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

  // Map controls
  const handleToggleMapView = useCallback(() => {
    setViewMode(prev => {
      // Toggle logic: 2d -> orthomosaic -> map -> 2d
      if (prev === "2d") return "orthomosaic";
      if (prev === "orthomosaic") {
        setMapKey(k => k + 1);
        return "map";
      }
      return "2d";
    });
  }, []);

  const handleUploadOrthomosaic = async (filesToUpload) => {
    setIsUploadingOrthomosaic(true);
    const formData = new FormData();
    if (Array.isArray(filesToUpload)) {
      filesToUpload.forEach(f => formData.append("files", f));
    } else {
      formData.append("files", filesToUpload);
    }
    try {
      const res = await axios.post(`${API}/api/files/${drawing._id}/orthomosaic`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setOrthomosaicState(res.data.orthomosaic);
    } catch (err) {
      console.error("Upload failed", err);
      alert(err.response?.data?.error || "Failed to upload orthomosaic.");
    } finally {
      setIsUploadingOrthomosaic(false);
    }
  };

  const handleUpdateOrthomosaicAlignment = async (updates) => {
    const newState = { ...orthomosaicState, ...updates };
    setOrthomosaicState(newState); // Optimistic update
    
    try {
      await axios.put(`${API}/api/files/${drawing._id}/orthomosaic/align`, updates);
    } catch (err) {
      console.error("Failed to save alignment", err);
    }
  };

  const handleAnchorChange = useCallback((lat, lng) => {
    setAnchorLat(lat);
    setAnchorLng(lng);
  }, []);

  const handleResetPosition = useCallback(() => {
    setAnchorLat(null);
    setAnchorLng(null);
    setMapRotation(0);
    setMapScale(1);
  }, []);

  const handleBackTo2D = useCallback(() => {
    setViewMode("2d");
  }, []);

  const handleSearchPlace = useCallback((lat, lng) => {
    setAnchorLat(lat);
    setAnchorLng(lng);
  }, []);

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

          {/* View Mode Indicator */}
          {viewMode === "map" && (
            <div className="viewer-sidebar-section">
              <h3>View Mode</h3>
              <div className="view-mode-indicator map-mode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                Satellite Map Mode
              </div>
            </div>
          )}
          {viewMode === "orthomosaic" && (
            <div className="viewer-sidebar-section">
              <h3>View Mode</h3>
              <div className="view-mode-indicator map-mode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Orthomosaic Mode
              </div>
            </div>
          )}

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

      {/* Canvas / Map Area */}
      {viewMode === "2d" || viewMode === "orthomosaic" ? (
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
            orthomosaic={viewMode === "orthomosaic" ? orthomosaicState : null}
          />
          
          {selectedEntity && (
            <EntityInspector 
              entity={selectedEntity} 
              onClose={() => setSelectedEntity(null)} 
            />
          )}

          {viewMode === "orthomosaic" && (
            <OrthomosaicControls
              orthomosaic={orthomosaicState}
              onUpload={handleUploadOrthomosaic}
              onUpdateAlignment={handleUpdateOrthomosaicAlignment}
              isUploading={isUploadingOrthomosaic}
              onToggleView={() => setViewMode("2d")}
            />
          )}
        </div>
      ) : (
        <div className="viewer-canvas map-view">
          <LeafletMapViewer
            key={mapKey}
            parsedData={parsedData}
            visibleLayers={visibleLayers}
            showLabels={showLabels}
            anchorLat={anchorLat}
            anchorLng={anchorLng}
            rotation={mapRotation}
            scale={mapScale}
            onAnchorChange={handleAnchorChange}
          />
          
          <MapPlacementControls
            anchorLat={anchorLat}
            anchorLng={anchorLng}
            rotation={mapRotation}
            scale={mapScale}
            onRotationChange={setMapRotation}
            onScaleChange={setMapScale}
            onResetPosition={handleResetPosition}
            onBackTo2D={handleBackTo2D}
            onSearchPlace={handleSearchPlace}
            onAnchorChange={handleAnchorChange}
          />
        </div>
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
        viewMode={viewMode}
        onToggleMapView={handleToggleMapView}
      />
    </div>
  );
}
