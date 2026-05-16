"use client";
import { useState, useRef, useCallback } from "react";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function FileUploader({ onUploadComplete }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleFiles = async (filesArray) => {
    let cadFile = null;
    let prjFile = null;

    filesArray.forEach((f) => {
      const ext = f.name.split(".").pop().toLowerCase();
      if (ext === "dwg" || ext === "dxf") cadFile = f;
    });

    if (!cadFile) { alert("Please include a .dwg or .dxf file."); return; }

    setUploadState({ file: cadFile, progress: 0, status: "uploading" });
    const formData = new FormData();
    formData.append("file", cadFile);

    try {
      const res = await axios.post(`${API}/api/files/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          setUploadState((p) => ({ ...p, progress: Math.round((e.loaded * 100) / e.total) }));
        },
      });
      setUploadState((p) => ({ ...p, progress: 100, status: "complete" }));
      onUploadComplete?.(res.data.drawing);
      setTimeout(() => setUploadState(null), 2000);
    } catch (err) {
      setUploadState((p) => ({ ...p, status: "error", error: err.response?.data?.error || "Upload failed" }));
    }
  };

  return (
    <div className="upload-section">
      <div className={`upload-zone ${isDragging ? "dragging" : ""}`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}>
        <div className="upload-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg>
        </div>
        <h3>Drop your DWG/DXF file here</h3>
        <p>or <span className="browse-link">browse</span> to upload · Max 100MB</p>
        <input ref={fileInputRef} type="file" multiple accept=".dwg,.dxf" className="upload-input" onChange={(e) => e.target.files.length > 0 && handleFiles(Array.from(e.target.files))}/>
      </div>
      {uploadState && (
        <div className="upload-progress animate-fade-in">
          <div className="upload-progress-card">
            <div className={`upload-file-icon ${uploadState.file.name.endsWith(".dwg") ? "dwg" : "dxf"}`}>
              {uploadState.file.name.endsWith(".dwg") ? "DWG" : "DXF"}
            </div>
            <div className="upload-file-info">
              <div className="upload-file-name">
                {uploadState.file.name}
              </div>
              <div className="upload-file-status">
                {uploadState.status === "uploading" && `Uploading... ${uploadState.progress}%`}
                {uploadState.status === "complete" && "✓ Processing complete"}
                {uploadState.status === "error" && `✕ ${uploadState.error}`}
              </div>
              {uploadState.status === "uploading" && (
                <div className="upload-progress-bar">
                  <div className="upload-progress-bar-fill" style={{ width: `${uploadState.progress}%` }}/>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
