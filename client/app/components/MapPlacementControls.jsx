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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  const hasPlacement = anchorLat != null && anchorLng != null;

  // Search using Nominatim (OpenStreetMap geocoding - free, no API key)
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
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
        );
        const data = await res.json();
        setSearchResults(
          data.map((item) => ({
            name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          }))
        );
      } catch (e) {
        console.error("Search failed:", e);
        setSearchResults([]);
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
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="map-search-results">
                {searchResults.map((result, i) => (
                  <button
                    key={i}
                    className="map-search-result-item"
                    onClick={() => handleSelectPlace(result)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <circle cx="12" cy="10" r="3"/>
                      <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/>
                    </svg>
                    <span>{result.name}</span>
                  </button>
                ))}
              </div>
            )}
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
                  <span className="coord-value">{anchorLat.toFixed(6)}°</span>
                </div>
                <div className="coord-item">
                  <span className="coord-label">Lng</span>
                  <span className="coord-value">{anchorLng.toFixed(6)}°</span>
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
