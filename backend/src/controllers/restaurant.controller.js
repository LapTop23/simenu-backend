const Restaurant = require('../models/Restaurant.model');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

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

module.exports = { createRestaurant, getPublicProfile };
