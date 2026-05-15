// Process-level error handlers to prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message, err.stack);
  // Give some time for logs to be written then exit
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (err) => {
  console.error('🔥 UNHANDLED REJECTION! Shutting down...');
  console.error(err.name, err.message, err.stack);
  // In production, we might want to exit and let a process manager (PM2/K8s) restart
  // For now, we'll log it clearly
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const fileRoutes = require('./routes/fileRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: '*', // Allow all origins — needed for Three.js TextureLoader and browser image requests
  credentials: false,
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (for uploaded files)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/files', fileRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Not Found - ${req.originalUrl}` });
});

// Enhanced Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  // Log the error for developers
  console.error('❌ Server Error Details:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    path: req.path,
    method: req.method,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      error: 'Validation Error', 
      details: Object.values(err.errors).map(e => e.message) 
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ 
      error: `Invalid ${err.path}: ${err.value}` 
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ 
      error: 'File too large. Maximum size is 100MB.' 
    });
  }

  if (err.message?.includes('Only .dwg and .dxf')) {
    return res.status(400).json({ error: err.message });
  }

  // Generic internal server error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload endpoint: POST http://localhost:${PORT}/api/files/upload`);
});
