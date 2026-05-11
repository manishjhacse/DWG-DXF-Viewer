const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Use disk storage for large images (up to 400MB) to prevent RAM exhaustion
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(os.tmpdir(), 'dwg-viewer-uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

// File filter — allow images (png, jpg, jpeg, tif, tiff, webp) and ECW files
const fileFilter = (req, file, cb) => {
  const ext = (file.originalname || '').split('.').pop().toLowerCase();
  const allowed = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'ecw', 'eww', 'prj'];
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (png, jpg, tif, webp, ecw) are allowed for orthomosaics'), false);
  }
};

const uploadImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 450 * 1024 * 1024, // 450MB max to allow a bit of buffer for 400MB requirement
  },
});

module.exports = uploadImage;
