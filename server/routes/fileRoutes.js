const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const uploadImage = require('../middleware/uploadImage');
const asyncHandler = require('../utils/asyncHandler');
const {
  uploadFile,
  getFile,
  listFiles,
  deleteFile,
  uploadOrthomosaic,
  updateOrthomosaicAlignment
} = require('../controllers/fileController');

// Upload a file
router.post('/upload', upload.single('file'), asyncHandler(uploadFile));

// List all drawings
router.get('/', asyncHandler(listFiles));

// Get a specific drawing
router.get('/:id', asyncHandler(getFile));

// Delete a drawing
router.delete('/:id', asyncHandler(deleteFile));

// Upload an orthomosaic image for a drawing (allows multiple files for ECW + EWW + PRJ)
router.post('/:id/orthomosaic', uploadImage.array('files', 5), asyncHandler(uploadOrthomosaic));

// Update orthomosaic alignment
router.put('/:id/orthomosaic/align', express.json(), asyncHandler(updateOrthomosaicAlignment));

module.exports = router;
