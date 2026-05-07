const multer = require('multer');

// Configure memory storage - files will be kept in RAM during processing
const storage = multer.memoryStorage();

// File filter — only allow .dwg and .dxf
const fileFilter = (req, file, cb) => {
  const ext = (file.originalname || '').split('.').pop().toLowerCase();
  if (ext === 'dwg' || ext === 'dxf') {
    cb(null, true);
  } else {
    cb(new Error('Only .dwg and .dxf files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

module.exports = upload;
