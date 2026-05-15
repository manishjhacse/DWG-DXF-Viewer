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
  updateOrthomosaicAlignment,
  proxyOrthomosaicImage,
  saveMapPlacement
} = require('../controllers/fileController');

// Upload a file (along with an optional .prj sidecar file)
router.post('/upload', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'prj', maxCount: 1 }
]), asyncHandler(uploadFile));

// List all drawings
router.get('/', asyncHandler(listFiles));

// Get a specific drawing
router.get('/:id', asyncHandler(getFile));

// Delete a drawing
router.delete('/:id', asyncHandler(deleteFile));

// Upload an orthomosaic image for a drawing (allows multiple files for ECW + EWW + PRJ)
router.post('/:id/orthomosaic', uploadImage.array('files', 5), asyncHandler(uploadOrthomosaic));

// Proxy the orthomosaic image through the backend (avoids CORS issues with S3)
router.get('/:id/orthomosaic/image', asyncHandler(proxyOrthomosaicImage));

// Update orthomosaic alignment
router.put('/:id/orthomosaic/align', express.json(), asyncHandler(updateOrthomosaicAlignment));

// Save map placement (anchor lat/lng, rotation, scale)
router.put('/:id/map-placement', express.json(), asyncHandler(saveMapPlacement));

module.exports = router;

