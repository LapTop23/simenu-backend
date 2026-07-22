const express = require('express');
const tenantResolver = require('../middleware/tenantResolver');
const { requireAuth, requireOwnerMatchesTenant } = require('../middleware/requireAuth');
const {
  getMenuForTenant,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  updateAvailability,
  deleteMenuItem,
} = require('../controllers/menu.controller');

const router = express.Router();

/**
 * Every route in this file is mounted behind `tenantResolver`, meaning no
 * controller here ever runs without a verified `req.tenant` already attached.
 *
 * The write routes (POST/PUT/PATCH/DELETE) additionally sit behind
 * `requireAuth` (must be logged in) AND `requireOwnerMatchesTenant` (must be
 * logged in as THIS SPECIFIC restaurant's owner) — this is what actually
 * closes the gap the earlier "PRODUCTION NOTE" comments flagged: it is no
 * longer enough to just know a restaurant's slug to edit its menu.
 */
router.use(tenantResolver);

// GET /api/menu?res=savory-foods                   → full available menu, grouped by category
// GET /api/menu?res=savory-foods&category=Burgers  → filtered to a single category
// GET /api/menu?res=savory-foods&includeUnavailable=true → admin view, includes sold-out items
router.get('/', getMenuForTenant);

// GET /api/menu/:itemId?res=savory-foods           → single item, still tenant-scoped
router.get('/:itemId', getMenuItemById);

// POST /api/menu?res=savory-foods                  → create a new menu item (owner only)
router.post('/', requireAuth, requireOwnerMatchesTenant, createMenuItem);

// PUT /api/menu/:itemId?res=savory-foods           → update any subset of a menu item's fields (owner only)
router.put('/:itemId', requireAuth, requireOwnerMatchesTenant, updateMenuItem);

// PATCH /api/menu/:itemId/availability?res=savory-foods → toggle isAvailable only (owner only)
router.patch('/:itemId/availability', requireAuth, requireOwnerMatchesTenant, updateAvailability);

// DELETE /api/menu/:itemId?res=savory-foods        → permanently remove a menu item (owner only)
router.delete('/:itemId', requireAuth, requireOwnerMatchesTenant, deleteMenuItem);

module.exports = router;
