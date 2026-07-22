const express = require('express');
const { getPublicProfile } = require('../controllers/restaurant.controller');

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

module.exports = router;
