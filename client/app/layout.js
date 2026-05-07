import "./globals.css";

export const metadata = {
  title: "DWG/DXF Viewer — CAD Drawing Viewer",
  description: "Upload and view DWG/DXF CAD drawings in your browser. Supports 2D drawings with layer management, zoom, and pan controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav className="navbar">
          <a href="/" className="navbar-brand">
            <div className="navbar-logo">DV</div>
            <div className="navbar-title">
              DWG<span>Viewer</span>
            </div>
          </a>
          <div className="navbar-actions">
            <a href="/" className="navbar-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Home
            </a>
          </div>
        </nav>
        <main className="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}
