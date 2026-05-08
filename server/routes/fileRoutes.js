const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');
const {
  uploadFile,
  getFile,
  listFiles,
  deleteFile,
} = require('../controllers/fileController');

// Upload a file
router.post('/upload', upload.single('file'), asyncHandler(uploadFile));

// List all drawings
router.get('/', asyncHandler(listFiles));

// Get a specific drawing
router.get('/:id', asyncHandler(getFile));

// Delete a drawing
router.delete('/:id', asyncHandler(deleteFile));

module.exports = router;
