"use client";
import { useState, useCallback, useRef } from "react";

export default function MapPlacementControls({
  anchorLat,
  anchorLng,
  rotation,
  scale,
  onRotationChange,
  onScaleChange,
  onResetPosition,
  onBackTo2D,
  onSearchPlace,
  onAnchorChange,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  const hasPlacement = anchorLat != null && anchorLng != null;

  // Search using Photon API (Komoot) and support direct coordinates
  const handleSearch = useCallback(async (query) => {
    setSearchQuery(query);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (query.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        // Direct Coordinate parsing
        const cleanedQuery = query.replace(/[^\d., -]/g, '').trim();
        const parts = cleanedQuery.split(/[, ]+/).filter(Boolean);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          setSearchResults([{
            name: `Coordinates: ${parts[0]}, ${parts[1]}`,
            lat: parseFloat(parts[0]),
            lng: parseFloat(parts[1])
          }]);
          return;
        }

        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
        const data = await res.json();
        
        if (data && data.features && Array.isArray(data.features)) {
          const results = [];
          
          for (let i = 0; i < data.features.length; i++) {
            try {
              const f = data.features[i];
              if (!f.geometry || !f.geometry.coordinates) continue;
              
              const props = f.properties || {};
              const nameParts = [props.name, props.city, props.state, props.country].filter(Boolean);
              
              // Simple deduplication without Set just in case
              const uniqueNameParts = [];
              nameParts.forEach(part => {
                if (!uniqueNameParts.includes(part)) uniqueNameParts.push(part);
              });
              
              results.push({
                name: uniqueNameParts.join(", ") || "Unknown Location",
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0],
              });
            } catch (err) {
              console.error("Error parsing feature", err);
            }
          }
          
          if (results.length > 0) {
            setSearchResults(results);
          } else {
            setSearchResults([{ name: "No locations found", lat: 0, lng: 0, isError: true }]);
          }
        } else {
          setSearchResults([{ name: "Invalid response format", lat: 0, lng: 0, isError: true }]);
        }
      } catch (e) {
        console.error("Search failed:", e);
        setSearchResults([{ name: "Search Error: " + e.message, lat: 0, lng: 0, isError: true }]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const handleSelectPlace = useCallback((result) => {
    setSearchQuery(result.name.split(",")[0]); // Show short name
    setSearchResults([]);
    if (onSearchPlace) onSearchPlace(result.lat, result.lng);
  }, [onSearchPlace]);

  return (
    <div className={`map-controls-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="map-controls-header">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="10" r="3"/>
            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
          </svg>
          Map Placement
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
          {/* Location Search */}
          <div className="map-controls-section">
            <div className="map-controls-label">Search Location</div>
            <div className="map-search-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="map-search-icon">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                className="map-search-input"
                placeholder="Search city, address, landmark..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {searching && <div className="map-search-spinner" />}
              
              {/* Absolute Positioned Search Results */}
              {searchResults.length > 0 && (
                <div className="map-search-results" style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  background: 'var(--bg-glass-hover)',
                  backdropFilter: 'blur(16px)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  border: '1px solid var(--border-primary)',
                  marginTop: '8px'
                }}>
                  {searchResults.map((result, i) => (
                    <button
                      key={i}
                      className="map-search-result-item"
                      onClick={() => {
                        if (!result.isError) handleSelectPlace(result);
                      }}
                      style={{ 
                        cursor: result.isError ? "default" : "pointer", 
                        color: result.isError ? "#ef4444" : "var(--text-primary)",
                        padding: "10px",
                        borderBottom: i < searchResults.length - 1 ? "1px solid var(--border-primary)" : "none"
                      }}
                    >
                      {!result.isError && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <circle cx="12" cy="10" r="3"/>
                          <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                        </svg>
                      )}
                      {result.isError && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                      )}
                      <span>{result.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Placement hint */}
          {!hasPlacement && (
            <div className="map-controls-hint">
              <div className="hint-icon pulse">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                </svg>
              </div>
              <p>Search for a location or click on the map to place your drawing</p>
            </div>
          )}

          {/* Coordinates */}
          {hasPlacement && (
            <div className="map-controls-section">
              <div className="map-controls-label">Anchor Point</div>
              <div className="map-controls-coords">
                <div className="coord-item">
                  <span className="coord-label">Lat</span>
                  <input
                    type="number"
                    step="0.000001"
                    className="coord-input"
                    value={anchorLat === null ? "" : anchorLat}
                    onChange={(e) => onAnchorChange && onAnchorChange(parseFloat(e.target.value) || 0, anchorLng)}
                  />
                </div>
                <div className="coord-item">
                  <span className="coord-label">Lng</span>
                  <input
                    type="number"
                    step="0.000001"
                    className="coord-input"
                    value={anchorLng === null ? "" : anchorLng}
                    onChange={(e) => onAnchorChange && onAnchorChange(anchorLat, parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Rotation */}
          {hasPlacement && (
            <div className="map-controls-section">
              <div className="map-controls-label">
                Rotation
                <span className="map-controls-value">{rotation}°</span>
              </div>
              <input
                type="range"
                className="map-slider"
                min="0"
                max="360"
                step="1"
                value={rotation}
                onChange={(e) => onRotationChange(Number(e.target.value))}
              />
            </div>
          )}

          {/* Scale */}
          {hasPlacement && (
            <div className="map-controls-section">
              <div className="map-controls-label">
                Scale
                <span className="map-controls-value">{scale.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                className="map-slider"
                min="0.1"
                max="10"
                step="0.1"
                value={scale}
                onChange={(e) => onScaleChange(Number(e.target.value))}
              />
            </div>
          )}

          {/* Drag hint */}
          {hasPlacement && (
            <div className="map-controls-tip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
              </svg>
              Drag the marker to reposition the drawing
            </div>
          )}

          {/* Actions */}
          <div className="map-controls-actions">
            {hasPlacement && (
              <button className="map-btn map-btn-secondary" onClick={onResetPosition}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                Reset Position
              </button>
            )}
            <button className="map-btn map-btn-primary" onClick={onBackTo2D}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              Back to 2D View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
