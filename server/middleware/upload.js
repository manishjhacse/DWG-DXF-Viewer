const multer = require('multer');

// Configure memory storage - files will be kept in RAM during processing
const storage = multer.memoryStorage();

// File filter — only allow .dwg and .dxf
const fileFilter = (req, file, cb) => {
  const ext = (file.originalname || '').split('.').pop().toLowerCase();
  if (ext === 'dwg' || ext === 'dxf' || ext === 'prj') {
    cb(null, true);
  } else {
    cb(new Error('Only .dwg, .dxf, and .prj files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

module.exports = upload;
