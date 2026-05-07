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
  },
}, {
  timestamps: true,
});

// Index for quick lookups
drawingSchema.index({ status: 1 });
drawingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Drawing', drawingSchema);
