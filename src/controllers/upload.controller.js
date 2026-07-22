const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const handleControllerError = require('../utils/handleControllerError');

/**
 * POST /api/uploads/image?res=savory-foods
 *
 * Accepts a single `image` multipart field (validated/stored by
 * upload.middleware.js), and returns the public URL the frontend should
 * store on a MenuItem's `images` array. Decoupling upload from menu
 * create/update means a form can upload an image the moment the owner picks
 * a file (showing a preview immediately) without waiting for the rest of
 * the form to be filled in and submitted.
 */
const uploadImage = (req, res) => {
  try {
    if (!req.file) {
      throw ApiError.badRequest('No image file was provided. Attach a file under the "image" field.');
    }

    // Served statically by server.js (`app.use('/uploads', express.static(...))`),
    // namespaced by tenant slug so two restaurants' filenames can never collide
    // or be confused for one another.
    // Cloudinary already hands back a complete, ready-to-use https:// address —
// unlike the old local-disk version, there's no path-building needed here.
const publicUrl = req.file.path;

    return new ApiResponse(201, 'Image uploaded successfully.', {
      url: publicUrl,
      filename: req.file.filename,
      sizeBytes: req.file.size,
    }).send(res);
  } catch (error) {
    return handleControllerError(res, error, 'UploadController.uploadImage', 'An unexpected error occurred while uploading the image.');
  }
};

module.exports = { uploadImage };
