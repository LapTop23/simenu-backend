const Restaurant = require('../models/Restaurant.model');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const handleControllerError = require('../utils/handleControllerError');
const { generateTableKey } = require('../utils/tableSecurity');
const { createSession } = require('../services/tableSession.service');

/**
 * POST /api/restaurants
 *
 * Onboards a new SaaS tenant. In production this route should sit behind
 * platform-admin authentication (not included here — out of scope for the
 * backend-foundation deliverable, but flagged clearly so it isn't mistaken
 * for a public endpoint).
 */
const createRestaurant = async (req, res) => {
  try {
    const { slug, name, branding, config, contact } = req.body;

    if (!slug || !name) {
      throw ApiError.badRequest('Both "slug" and "name" are required to create a restaurant.');
    }

    const restaurant = await Restaurant.create({
      slug: slug.trim().toLowerCase(),
      name: name.trim(),
      branding,
      config,
      contact,
    });

    return new ApiResponse(201, 'Restaurant created successfully.', restaurant).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: `The slug "${req.body.slug}" is already in use.` });
    }
    if (error.name === 'ValidationError') {
      const message = Object.values(error.errors).map((e) => e.message).join(' ');
      return res.status(400).json({ success: false, message });
    }
    console.error('[RestaurantController] Failed to create restaurant:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while creating the restaurant.',
    });
  }
};

/**
 * GET /api/restaurants/:slug/public-profile
 *
 * Lightweight, public tenant profile lookup (branding + basic info only) — used
 * by the frontend to render a landing page before the full menu loads. Note this
 * intentionally duplicates a small slice of tenantResolver's lookup rather than
 * depending on it, since this route's job IS resolving a tenant profile, not
 * consuming one.
 */
const getPublicProfile = async (req, res) => {
  try {
    const { slug } = req.params;

    const restaurant = await Restaurant.findOne({ slug: slug.trim().toLowerCase(), 'config.isActive': true })
      .select('slug name branding config.currency config.acceptsOnlineOrders contact.phone contact.address')
      .lean();

    if (!restaurant) {
      throw ApiError.notFound(`No active restaurant was found for identifier "${slug}".`);
    }

    return new ApiResponse(200, 'Restaurant profile retrieved successfully.', restaurant).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('[RestaurantController] Failed to fetch public profile:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while retrieving the restaurant profile.',
    });
  }
};

/**
 * POST /api/restaurants/verify-table?res=savory-foods
 * body: { table, key }
 *
 * Called the moment a customer's menu page loads with a `key` in the URL —
 * i.e. from an actual physical QR code scan, never from a manually typed
 * table number. Confirms the key genuinely matches this table (derived from
 * the restaurant's private qrSecret, fetched here explicitly since it's
 * excluded by default everywhere else — see Restaurant.model.js), and if so,
 * mints a temporary session so the customer isn't asked to re-prove this on
 * every single order placed during their visit.
 *
 * Sits behind `verifyTableScanLimiter` (see routes/restaurant.routes.js) —
 * this is a required control, not optional, since this endpoint's entire job
 * is checking a secret value against client input.
 */
const verifyTableScan = async (req, res) => {
  try {
    const { table, key } = req.body;
    if (!table || !key) {
      throw ApiError.badRequest('Both "table" and "key" are required.');
    }

    const restaurantWithSecret = await Restaurant.findById(req.tenant.id).select('+qrSecret');
    if (!restaurantWithSecret) {
      throw ApiError.notFound('Restaurant not found.');
    }

    const expectedKey = generateTableKey(restaurantWithSecret.qrSecret, table);

    // Deliberately vague error message — never reveals WHY it failed (wrong
    // table vs wrong key vs expired), which would help someone narrow down a
    // guessing attempt.
    if (expectedKey !== key) {
      throw ApiError.forbidden('This QR code is not valid for this table. Please scan the code on your table again.');
    }

    const session = createSession(req.tenant.id, table);
    return new ApiResponse(200, 'Table verified.', session).send(res);
  } catch (error) {
    return handleControllerError(res, error, 'RestaurantController.verifyTableScan', 'Could not verify this table.');
  }
};

/**
 * GET /api/restaurants/table-keys?res=savory-foods&count=12
 *
 * Owner-only (see routes/restaurant.routes.js) — returns each table's real
 * secret key so the dashboard's QR generator can embed it in that table's
 * printed QR code. This is the ONE place these keys are ever sent to a
 * browser at all, and only to the authenticated owner of this specific
 * restaurant.
 */
const getTableKeys = async (req, res) => {
  try {
    const count = Math.max(1, Math.min(200, parseInt(req.query.count, 10) || 12));

    const restaurantWithSecret = await Restaurant.findById(req.tenant.id).select('+qrSecret');
    if (!restaurantWithSecret) {
      throw ApiError.notFound('Restaurant not found.');
    }

    const keys = Array.from({ length: count }, (_, i) => {
      const tableNumber = i + 1;
      return { table: tableNumber, key: generateTableKey(restaurantWithSecret.qrSecret, tableNumber) };
    });

    return new ApiResponse(200, 'Table keys generated.', { keys }).send(res);
  } catch (error) {
    return handleControllerError(res, error, 'RestaurantController.getTableKeys', 'Could not generate table keys.');
  }
};

module.exports = { createRestaurant, getPublicProfile, verifyTableScan, getTableKeys };
