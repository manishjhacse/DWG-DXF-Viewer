const mongoose = require('mongoose');

const drawingSchema = new mongoose.Schema({
  originalName: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    enum: ['dwg', 'dxf'],
    required: true,
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  s3Key: {
    type: String,
    default: null,
  },
  dxfS3Key: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['uploaded', 'converting', 'ready', 'error'],
    default: 'uploaded',
  },
  errorMessage: {
    type: String,
    default: null,
  },
  // Parsed DXF data stored as JSON
  parsedData: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  metadata: {
    layers: [String],
    entityCount: { type: Number, default: 0 },
    bounds: {
      minX: Number,
      minY: Number,
      maxX: Number,
      maxY: Number,
    },
    geolocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      northDirection: { type: Number },
      coordinateSystem: { type: String, default: null },
      projectionDetails: { type: mongoose.Schema.Types.Mixed, default: null },
      designPoint: {
        x: { type: Number },
        y: { type: Number },
      },
      referencePoint: {
        x: { type: Number },
        y: { type: Number },
      },
      source: { type: String, default: null }, // 'GEODATA' | 'HEADER_VARS' | 'DXF_GEODATA'
    },
  },
  orthomosaic: {
    s3Key: { type: String, default: null },
    url: { type: String, default: null },
    scale: { type: Number, default: 1 },
    rotation: { type: Number, default: 0 },
    offsetX: { type: Number, default: 0 },
    offsetY: { type: Number, default: 0 },
  },
  // User-saved map placement (persists anchor lat/lng for future sessions)
  mapPlacement: {
    anchorLat: { type: Number, default: null },
    anchorLng: { type: Number, default: null },
    rotation: { type: Number, default: 0 },
    scale: { type: Number, default: 1 },
    proj4String: { type: String, default: null },
    epsg: { type: String, default: null },
  },
}, {
  timestamps: true,
});

// Index for quick lookups
drawingSchema.index({ status: 1 });
drawingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Drawing', drawingSchema);
