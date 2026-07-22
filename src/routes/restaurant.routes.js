const express = require('express');
const { getPublicProfile, verifyTableScan, getTableKeys } = require('../controllers/restaurant.controller');
const tenantResolver = require('../middleware/tenantResolver');
const { requireAuth, requireOwnerMatchesTenant } = require('../middleware/requireAuth');
const { verifyTableScanLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * NOTE: restaurant + owner-account creation now happens together through
 * POST /api/auth/register (see routes/auth.routes.js) — that's the real,
 * production-safe signup path (it creates a password-protected owner
 * account in the same step, rather than leaving a brand-new restaurant with
 * no login at all). The old, fully-open `POST /` here has been removed
 * rather than left reachable.
 */

// GET /api/restaurants/:slug/public-profile → lightweight public branding/info lookup (no auth — customer-facing)
router.get('/:slug/public-profile', getPublicProfile);

// POST /api/restaurants/verify-table?res=savory-foods → confirm a real QR scan, mint a session.
// Public (customer-facing) but rate-limited — this endpoint's entire job is
// checking a secret value against client input, so limiting attempts is a
// required control, not optional.
router.post('/verify-table', tenantResolver, verifyTableScanLimiter, verifyTableScan);

// GET /api/restaurants/table-keys?res=savory-foods&count=12 → owner dashboard only, generates real per-table keys
router.get('/table-keys', tenantResolver, requireAuth, requireOwnerMatchesTenant, getTableKeys);

module.exports = router;
