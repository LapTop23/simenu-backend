const express = require('express');
const tenantResolver = require('../middleware/tenantResolver');
const { requireAuth, requireOwnerMatchesTenant } = require('../middleware/requireAuth');
const { uploadMenuImage } = require('../middleware/upload.middleware');
const { uploadImage } = require('../controllers/upload.controller');

const router = express.Router();

router.use(tenantResolver);

/**
 * POST /api/uploads/image?res=savory-foods
 * multipart/form-data, field name: "image"
 *
 * Owner-only: sits behind requireAuth + requireOwnerMatchesTenant, so only
 * the logged-in owner of THIS specific restaurant can upload into its folder.
 */
router.post('/image', requireAuth, requireOwnerMatchesTenant, uploadMenuImage.single('image'), uploadImage);

module.exports = router;
