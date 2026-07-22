const MenuItem = require('../models/MenuItem.model');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const handleControllerError = require('../utils/handleControllerError');
const { menuRoomName } = require('../sockets');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// Whitelist of client-writable fields — deliberately excludes `restaurantId`
// (always forced from `req.tenant.id`, never from the request body) and
// `_id`/`createdAt`/`updatedAt` (managed by Mongo). This is what prevents a
// mass-assignment bug from ever letting a request reassign a menu item to a
// different tenant or spoof its timestamps.
const WRITABLE_FIELDS = [
  'name',
  'description',
  'category',
  'price',
  'images',
  'tags',
  'modifiers',
  'isAvailable',
  'isFeatured',
  'displayOrder',
];

function pickWritableFields(body = {}) {
  const picked = {};
  WRITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) picked[field] = body[field];
  });
  return picked;
}

/**
 * GET /api/menu?res=savory-foods
 *
 * Fetches the full, available menu for exactly one tenant — the one resolved by
 * `tenantResolver` and attached to `req.tenant`. This is the core, public-facing
 * data-fetching endpoint of SI-Menu (customers scan a QR code, land here).
 *
 * SECURITY GUARANTEE: this handler NEVER reads a restaurantId from req.query,
 * req.body, or req.params. The only source of tenant identity is `req.tenant.id`,
 * which was independently verified by the tenantResolver middleware against the
 * Restaurant collection. This is what makes cross-tenant data leakage structurally
 * impossible from this endpoint, rather than merely "unlikely".
 *
 * Optional query params (all scoped WITHIN the already-resolved tenant):
 *   - category: filter to a single menu category (e.g. &category=Beverages)
 *   - includeUnavailable: 'true' to also return currently unavailable items
 *     (useful for an admin preview; defaults to false for the public menu view)
 */
const getMenuForTenant = async (req, res) => {
  try {
    // Defensive guard: this should be unreachable if tenantResolver is correctly
    // mounted ahead of this route, but we never assume upstream middleware ran.
    if (!req.tenant || !req.tenant.id) {
      throw ApiError.internal('Tenant context is missing. This route must be mounted behind tenantResolver.');
    }

    const { category, includeUnavailable } = req.query;

    // Base filter is ALWAYS scoped by the resolved tenant — every other condition
    // is additive, never a replacement for this line.
    const filter = { restaurantId: req.tenant.id };

    if (includeUnavailable !== 'true') {
      filter.isAvailable = true;
    }

    if (category && typeof category === 'string' && category.trim()) {
      // Case-insensitive exact match on category name.
      filter.category = new RegExp(`^${category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }

    const items = await MenuItem.find(filter)
      .sort({ category: 1, displayOrder: 1, name: 1 })
      .lean();

    // Group flat results into { category: [items] } — the shape a menu UI actually
    // wants to render directly, rather than making the frontend re-group them.
    const groupedByCategory = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    return new ApiResponse(200, 'Menu retrieved successfully.', {
      restaurant: {
        slug: req.tenant.slug,
        name: req.tenant.name,
        branding: req.tenant.branding,
        currency: req.tenant.currency,
      },
      categories: Object.keys(groupedByCategory).sort(),
      menu: groupedByCategory,
      totalItems: items.length,
    }).send(res);
  } catch (error) {
    // Re-throw known ApiErrors as-is so their intended status code is preserved;
    // wrap anything unexpected as a 500 rather than letting it crash the process.
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    console.error(`[MenuController] Failed to fetch menu for tenant "${req.tenant?.slug}":`, error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while retrieving the menu. Please try again shortly.',
    });
  }
};

/**
 * GET /api/menu/:itemId?res=savory-foods
 *
 * Fetches a single menu item — still tenant-scoped, so a client cannot fetch a
 * different restaurant's item merely by guessing its Mongo _id. The query
 * combines BOTH the item's _id AND the resolved restaurantId; if the item exists
 * but belongs to a different tenant, this deliberately returns 404 (not 403), to
 * avoid confirming to an attacker that the ID exists at all.
 */
const getMenuItemById = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId || !itemId.match(/^[0-9a-fA-F]{24}$/)) {
      throw ApiError.badRequest('A valid menu item id must be provided.');
    }

    const item = await MenuItem.findOne({
      _id: itemId,
      restaurantId: req.tenant.id, // The tenant-isolation guard for single-document lookups.
    }).lean();

    if (!item) {
      throw ApiError.notFound('Menu item not found for this restaurant.');
    }

    return new ApiResponse(200, 'Menu item retrieved successfully.', item).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    console.error('[MenuController] Failed to fetch single menu item:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while retrieving the menu item.',
    });
  }
};

/**
 * POST /api/menu?res=savory-foods
 *
 * Creates a new menu item for the resolved tenant. Broadcasts
 * 'menu-item-created' to every customer currently browsing this tenant's
 * digital menu (see the 'join-menu-room' socket handler), so a newly added
 * dish appears on an already-open customer tab without a refresh.
 */
const createMenuItem = async (req, res) => {
  try {
    const payload = pickWritableFields(req.body);

    if (!payload.name || !payload.category || payload.price === undefined) {
      throw ApiError.badRequest('name, category, and price are required to create a menu item.');
    }

    const item = await MenuItem.create({ ...payload, restaurantId: req.tenant.id });

    req.app.get('io')?.to(menuRoomName(req.tenant.id)).emit('menu-item-created', item);

    return new ApiResponse(201, 'Menu item created successfully.', item).send(res);
  } catch (error) {
    return handleControllerError(
      res,
      error,
      'MenuController.createMenuItem',
      'An unexpected error occurred while creating the menu item.'
    );
  }
};

/**
 * PUT /api/menu/:itemId?res=savory-foods
 *
 * Updates any subset of a menu item's writable fields. Tenant-scoped via the
 * same `{ _id, restaurantId }` filter pattern used everywhere else in this
 * codebase — a request can never edit another restaurant's item, even with a
 * guessed/valid ObjectId. Broadcasts 'menu-item-updated' to the live customer
 * menu room so edits (price changes, new description, etc.) show up instantly.
 */
const updateMenuItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId || !OBJECT_ID_PATTERN.test(itemId)) {
      throw ApiError.badRequest('A valid menu item id must be provided.');
    }

    const payload = pickWritableFields(req.body);
    if (Object.keys(payload).length === 0) {
      throw ApiError.badRequest('At least one updatable field must be provided.');
    }

    const item = await MenuItem.findOneAndUpdate(
      { _id: itemId, restaurantId: req.tenant.id },
      payload,
      { new: true, runValidators: true }
    );

    if (!item) {
      throw ApiError.notFound('Menu item not found for this restaurant.');
    }

    req.app.get('io')?.to(menuRoomName(req.tenant.id)).emit('menu-item-updated', item);

    return new ApiResponse(200, 'Menu item updated successfully.', item).send(res);
  } catch (error) {
    return handleControllerError(
      res,
      error,
      'MenuController.updateMenuItem',
      'An unexpected error occurred while updating the menu item.'
    );
  }
};

/**
 * PATCH /api/menu/:itemId/availability?res=savory-foods
 *
 * A dedicated, lightweight endpoint for the one thing the admin dashboard's
 * toggle switch needs to do — flip `isAvailable` — without shipping the
 * item's entire editable payload over the wire for a single boolean flip.
 * This is the endpoint behind "instantly updates the item's availability on
 * the customer-facing menu without needing a page refresh": the moment this
 * resolves, every open customer tab for this tenant receives
 * 'menu-item-updated' and re-renders that item as available/sold out.
 */
const updateAvailability = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { isAvailable } = req.body;

    if (!itemId || !OBJECT_ID_PATTERN.test(itemId)) {
      throw ApiError.badRequest('A valid menu item id must be provided.');
    }
    if (typeof isAvailable !== 'boolean') {
      throw ApiError.badRequest('isAvailable must be a boolean value.');
    }

    const item = await MenuItem.findOneAndUpdate(
      { _id: itemId, restaurantId: req.tenant.id },
      { isAvailable },
      { new: true, runValidators: true }
    );

    if (!item) {
      throw ApiError.notFound('Menu item not found for this restaurant.');
    }

    req.app.get('io')?.to(menuRoomName(req.tenant.id)).emit('menu-item-updated', item);

    return new ApiResponse(200, `Item marked as ${isAvailable ? 'available' : 'unavailable'}.`, item).send(res);
  } catch (error) {
    return handleControllerError(
      res,
      error,
      'MenuController.updateAvailability',
      'An unexpected error occurred while updating availability.'
    );
  }
};

/**
 * DELETE /api/menu/:itemId?res=savory-foods
 *
 * Permanently removes a menu item. Note this does NOT cascade-delete past
 * Order documents referencing it — Order line items are snapshotted (name,
 * unitPrice) precisely so historical orders remain intact even after the
 * source menu item is later edited or removed (see Order.model.js). Broadcasts
 * 'menu-item-deleted' so any open customer tab removes it from view instantly.
 */
const deleteMenuItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId || !OBJECT_ID_PATTERN.test(itemId)) {
      throw ApiError.badRequest('A valid menu item id must be provided.');
    }

    const item = await MenuItem.findOneAndDelete({ _id: itemId, restaurantId: req.tenant.id });

    if (!item) {
      throw ApiError.notFound('Menu item not found for this restaurant.');
    }

    req.app.get('io')?.to(menuRoomName(req.tenant.id)).emit('menu-item-deleted', { itemId: item._id });

    return new ApiResponse(200, 'Menu item deleted successfully.', { itemId: item._id }).send(res);
  } catch (error) {
    return handleControllerError(
      res,
      error,
      'MenuController.deleteMenuItem',
      'An unexpected error occurred while deleting the menu item.'
    );
  }
};

module.exports = {
  getMenuForTenant,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  updateAvailability,
  deleteMenuItem,
};
