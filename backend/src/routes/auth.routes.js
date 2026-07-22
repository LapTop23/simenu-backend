const express = require('express');
const { register, login, logout, me } = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// POST /api/auth/register → create a restaurant + its owner account together
router.post('/register', register);

// POST /api/auth/login    → verify credentials, set the httpOnly login cookie
router.post('/login', login);

// POST /api/auth/logout   → clear the login cookie
router.post('/logout', logout);

// GET  /api/auth/me       → who's currently logged in, if anyone (requires a valid cookie)
router.get('/me', requireAuth, me);

module.exports = router;
