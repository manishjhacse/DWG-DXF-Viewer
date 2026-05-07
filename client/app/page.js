"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import FileUploader from "./components/FileUploader";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function HomePage() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchFiles = async () => {
    try {
      const res = await axios.get(`${API}/api/files`);
      setFiles(res.data.drawings || []);
    } catch (err) {
      console.error("Failed to fetch files:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFiles(); }, []);

  const handleUploadComplete = (drawing) => {
    fetchFiles();
    if (drawing?.id && drawing?.status === "ready") {
      router.push(`/viewer/${drawing.id}`);
    }
  };

  const handleDelete = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this drawing?")) return;
    try {
      await axios.delete(`${API}/api/files/${id}`);
      setFiles(f => f.filter(d => d._id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (d) => {
    if (!d) return "";
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="home-container">
      <div className="home-hero animate-fade-in">
        <h1>View Your CAD Drawings</h1>
        <p>Upload DWG or DXF files to instantly view 2D drawings with layer management, zoom, and pan controls.</p>
      </div>

      <FileUploader onUploadComplete={handleUploadComplete} />

      <div className="files-section">
        <h2>Recent Drawings</h2>
        {loading ? (
          <div className="loading-container" style={{ height: 200 }}>
            <div className="loading-spinner" />
            <div className="loading-text">Loading drawings...</div>
          </div>
        ) : files.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <h3>No drawings yet</h3>
            <p>Upload your first DWG or DXF file to get started</p>
          </div>
        ) : (
          <div className="files-grid">
            {files.map((file, i) => (
              <a
                key={file._id}
                href={file.status === "ready" ? `/viewer/${file._id}` : "#"}
                className="file-card animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="file-card-actions">
                  <button className="btn-icon" onClick={(e) => handleDelete(e, file._id)} title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
                <div className="file-card-header">
                  <div className={`file-card-icon ${file.fileType}`}>{file.fileType?.toUpperCase()}</div>
                  <div className="file-card-title">
                    <div className="file-card-name">{file.originalName}</div>
                    <div className="file-card-date">{formatDate(file.createdAt)}</div>
                  </div>
                </div>
                <div className="file-card-meta">
                  <div className="file-card-meta-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {formatSize(file.fileSize)}
                  </div>
                  {file.metadata?.entityCount > 0 && (
                    <div className="file-card-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                      </svg>
                      {file.metadata.entityCount} entities
                    </div>
                  )}
                  {file.metadata?.layers?.length > 0 && (
                    <div className="file-card-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                        <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
                      </svg>
                      {file.metadata.layers.length} layers
                    </div>
                  )}
                  <span className={`status-badge ${file.status}`}>
                    <span className="status-dot"/>{file.status}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
