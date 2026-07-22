const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const ApiError = require('../utils/ApiError');

// Reads the three values you just added to .env — nothing else needed here.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/**
 * Storage strategy: Cloudinary, namespaced per tenant (a folder per
 * restaurant slug, same idea as the old local-disk version — just pointed
 * at Cloudinary's storage instead of this server's own hard drive).
 */
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder: `simenu/${req.tenant.slug}`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
  }),
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(ApiError.badRequest('Only JPEG, PNG, WEBP, or AVIF images are accepted.'));
  }
  cb(null, true);
};

const uploadMenuImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
});

module.exports = { uploadMenuImage };