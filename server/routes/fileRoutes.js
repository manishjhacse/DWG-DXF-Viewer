const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  uploadFile,
  getFile,
  listFiles,
  deleteFile,
} = require('../controllers/fileController');

// Upload a file
router.post('/upload', upload.single('file'), uploadFile);

// List all drawings
router.get('/', listFiles);

// Get a specific drawing
router.get('/:id', getFile);

// Delete a drawing
router.delete('/:id', deleteFile);

module.exports = router;
