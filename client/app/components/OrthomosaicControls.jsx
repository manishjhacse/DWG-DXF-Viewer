"use client";
import { useState } from "react";

export default function OrthomosaicControls({
  orthomosaic,
  onUpload,
  onUpdateAlignment,
  isUploading,
  onToggleView
}) {
  const [collapsed, setCollapsed] = useState(false);

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onUpload(Array.from(files));
    e.target.value = null;
  };

  const hasImage = !!(orthomosaic && orthomosaic.url);

  return (
    <div className={`map-controls-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="map-controls-header">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          Orthomosaic Background
        </h3>
        <button
          className="map-controls-collapse"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
            style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="map-controls-body">
          {!hasImage ? (
            <div className="map-controls-section" style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '15px', fontSize: '13px' }}>
                Upload a high-resolution orthomosaic image (JPG, PNG) to use as a background map.
              </p>
              <label className="btn-primary" style={{ cursor: isUploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: isUploading ? 0.7 : 1 }}>
                {isUploading ? "Converting & Uploading..." : "Upload Image"}
                <input
                  type="file"
                  accept=".png,.jpeg,.jpg,.webp,.ecw,.eww,.prj"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                  disabled={isUploading}
                  multiple
                />
              </label>
            </div>
          ) : (
            <>
              {/* Offset X */}
              <div className="map-controls-section">
                <div className="map-controls-label">
                  Offset X
                  <span className="map-controls-value">{Math.round(orthomosaic.offsetX || 0)}</span>
                </div>
                <input
                  type="range"
                  className="map-slider"
                  min="-5000"
                  max="5000"
                  step="10"
                  value={orthomosaic.offsetX || 0}
                  onChange={(e) => onUpdateAlignment({ offsetX: Number(e.target.value) })}
                />
              </div>

              {/* Offset Y */}
              <div className="map-controls-section">
                <div className="map-controls-label">
                  Offset Y
                  <span className="map-controls-value">{Math.round(orthomosaic.offsetY || 0)}</span>
                </div>
                <input
                  type="range"
                  className="map-slider"
                  min="-5000"
                  max="5000"
                  step="10"
                  value={orthomosaic.offsetY || 0}
                  onChange={(e) => onUpdateAlignment({ offsetY: Number(e.target.value) })}
                />
              </div>

              {/* Scale */}
              <div className="map-controls-section">
                <div className="map-controls-label">
                  Scale
                  <span className="map-controls-value">{(orthomosaic.scale || 1).toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  className="map-slider"
                  min="0.01"
                  max="10"
                  step="0.01"
                  value={orthomosaic.scale || 1}
                  onChange={(e) => onUpdateAlignment({ scale: Number(e.target.value) })}
                />
              </div>

              {/* Rotation */}
              <div className="map-controls-section">
                <div className="map-controls-label">
                  Rotation
                  <span className="map-controls-value">{orthomosaic.rotation || 0}°</span>
                </div>
                <input
                  type="range"
                  className="map-slider"
                  min="-180"
                  max="180"
                  step="1"
                  value={orthomosaic.rotation || 0}
                  onChange={(e) => onUpdateAlignment({ rotation: Number(e.target.value) })}
                />
              </div>

              {/* Actions */}
              <div className="map-controls-actions" style={{ marginTop: '15px' }}>
                <label className="map-btn map-btn-secondary" style={{ cursor: 'pointer', textAlign: 'center' }}>
                  Replace Image
                  <input
                    type="file"
                    accept=".png,.jpeg,.jpg,.webp,.ecw,.eww,.prj"
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                    disabled={isUploading}
                    multiple
                  />
                </label>
                <button className="map-btn map-btn-primary" onClick={onToggleView}>
                  Close Controls
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
