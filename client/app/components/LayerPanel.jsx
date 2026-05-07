"use client";
import { useState, useMemo } from 'react';

export default function LayerPanel({ layers, visibleLayers, onToggleLayer }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredLayers = useMemo(() => {
    if (!layers) return [];
    return layers.filter(l => l.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [layers, searchTerm]);

  const handleIsolate = (layerName, e) => {
    e.stopPropagation();
    onToggleLayer("__HIDE_ALL__");
    onToggleLayer(layerName);
  };

  // ACI color mapping
  const aciToHex = (c) => {
    const colors = ["#000","#F00","#FF0","#0F0","#0FF","#00F","#F0F","#CCC","#888","#C0C0C0"];
    return colors[c] || "#CCC";
  };

  return (
    <div className="viewer-sidebar-section animate-fade-in" style={{ padding: 0 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)' }}>
        <h3 style={{ margin: 0 }}>Layers ({layers?.length || 0})</h3>
      </div>
      
      <div className="layer-search-container">
        <div className="search-input-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            className="search-input" 
            placeholder="Search layers..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div style={{ padding: '12px 20px' }}>
        <div className="layer-actions">
          <button className="layer-action-btn" onClick={() => onToggleLayer("__SHOW_ALL__")}>Show All</button>
          <button className="layer-action-btn" onClick={() => onToggleLayer("__HIDE_ALL__")}>Hide All</button>
        </div>

        <ul className="layer-list">
          {filteredLayers.map((layer) => {
            const isVisible = visibleLayers.has(layer.name);
            const color = aciToHex(layer.color || 7);

            return (
              <li 
                key={layer.name} 
                className={`layer-item ${!isVisible ? "hidden" : ""}`}
                onClick={() => onToggleLayer(layer.name)}
              >
                <div className="layer-toggle">
                  {isVisible ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <div style={{ width: 14, height: 14 }} />
                  )}
                </div>
                <div 
                  className="layer-color-dot" 
                  style={{ backgroundColor: color }} 
                />
                <span 
                  className="layer-name" 
                  title={layer.name}
                >
                  {layer.name}
                </span>
                <button 
                  className="layer-action-btn isolate-btn" 
                  style={{ padding: '2px 6px', fontSize: '9px', opacity: 0.6 }}
                  onClick={(e) => handleIsolate(layer.name, e)}
                >
                  Isolate
                </button>
              </li>
            );
          })}
          {filteredLayers.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              No layers found
            </div>
          )}
        </ul>
      </div>
    </div>
  );
}
