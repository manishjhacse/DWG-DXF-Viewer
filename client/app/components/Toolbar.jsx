"use client";

export default function Toolbar({ 
  zoom, 
  onZoomIn, 
  onZoomOut, 
  onFitView, 
  bgColor, 
  onToggleBg,
  showLabels,
  onToggleLabels,
  onToggleSidebar,
  sidebarCollapsed
}) {
  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="toolbar-container animate-fade-in">
      <div className="toolbar-island">
        {/* Sidebar Toggle */}
        <button 
          className={`toolbar-btn ${!sidebarCollapsed ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>

        <div className="toolbar-divider" />

        {/* Zoom Controls */}
        <div className="toolbar-group">
          <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          
          <div className="zoom-display">
            {Math.round(zoom)}%
          </div>

          <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* View Controls */}
        <button className="toolbar-btn" onClick={onFitView} title="Fit View">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6"/>
          </svg>
        </button>

        <button className="toolbar-btn" onClick={handleFullscreen} title="Toggle Fullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>

        <div className="toolbar-divider" />

        {/* Layer/Label Controls */}
        <button 
          className={`toolbar-btn ${showLabels ? 'active' : ''}`} 
          onClick={onToggleLabels}
          title={showLabels ? "Hide Labels" : "Show Labels"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        <button 
          className="toolbar-btn" 
          onClick={onToggleBg}
          title={bgColor === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {bgColor === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
