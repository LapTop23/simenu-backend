const Owner = require('../models/Owner.model');
const Restaurant = require('../models/Restaurant.model');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const handleControllerError = require('../utils/handleControllerError');
const { hashPassword, verifyPassword } = require('../utils/passwordHash');
const { signOwnerToken } = require('../utils/jwt');

const COOKIE_NAME = 'simenu_token';

/**
 * Sets the login token as an httpOnly cookie — never returned in the JSON
 * response body, and never touched by frontend JavaScript at all. The
 * browser stores and re-sends it automatically on every request.
 *
 * `secure: true` in production means the cookie is only ever sent over
 * HTTPS — appropriate once this is deployed with a real domain; disabled for
 * local development, where the site runs over plain http://localhost.
 *
 * Omitting `maxAge` makes it a "session cookie" — the browser deletes it the
 * moment it's fully closed, which is exactly the intended "don't remember
 * me" behavior.
 */
function setAuthCookie(res, token, maxAgeMs) {
     const isProduction = process.env.NODE_ENV === 'production';
     res.cookie(COOKIE_NAME, token, {
       httpOnly: true,
       secure: isProduction,
       // 'none' is required for the cookie to survive a request between two
       // different domains (your Vercel frontend calling your Render
       // backend) — browsers require 'secure: true' whenever 'none' is used,
       // which is already guaranteed above since both are only true in
       // production. Locally, both frontend and backend share "localhost",
       // so 'lax' remains correct there.
       sameSite: isProduction ? 'none' : 'lax',
       ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
     });
   }

/**
 * POST /api/auth/register
 * body: { slug, restaurantName, email, password, currency? }
 *
 * Creates a new restaurant and its owner account together. Deliberately NOT
 * wrapped in a database transaction — transactions require MongoDB to be
 * running as a replica set (true for MongoDB Atlas, not always true for a
 * plain locally-installed MongoDB), and this codebase should work reliably
 * either way. Instead, if the owner account creation fails after the
 * restaurant was already created, the restaurant is explicitly cleaned up
 * (a "compensating action") so no orphaned, login-less restaurant is left
 * behind.
 */
const register = async (req, res) => {
  let createdRestaurant = null;

  try {
    const { slug, restaurantName, email, password, currency } = req.body;

    if (!slug || !restaurantName || !email || !password) {
      throw ApiError.badRequest('slug, restaurantName, email, and password are all required.');
    }
    if (password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters long.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingOwner = await Owner.findOne({ email: normalizedEmail });
    if (existingOwner) {
      throw ApiError.forbidden('An account with this email already exists. Try logging in instead.');
    }

    createdRestaurant = await Restaurant.create({
      slug: slug.trim().toLowerCase(),
      name: restaurantName.trim(),
      ...(currency ? { config: { currency } } : {}),
    });

    const passwordHash = await hashPassword(password);
    const owner = await Owner.create({
      email: normalizedEmail,
      passwordHash,
      restaurantId: createdRestaurant._id,
    });

    const { token, maxAgeMs } = signOwnerToken({ ownerId: owner._id, restaurantId: createdRestaurant._id }, false);
    setAuthCookie(res, token, maxAgeMs);

    return new ApiResponse(201, 'Account created successfully.', {
      restaurant: { slug: createdRestaurant.slug, name: createdRestaurant.name },
      owner: { email: owner.email },
    }).send(res);
  } catch (error) {
    if (createdRestaurant) {
      // Roll back the restaurant if the owner half of registration failed,
      // so we never leave behind a restaurant nobody can ever log into.
      await Restaurant.findByIdAndDelete(createdRestaurant._id).catch(() => {});
    }
    return handleControllerError(
      res,
      error,
      'AuthController.register',
      'An unexpected error occurred while creating your account.'
    );
  }
};

/**
 * POST /api/auth/login
 * body: { email, password, rememberMe? }
 *
 * On success, sets the httpOnly login cookie and returns basic profile info
 * (never the password hash, never the token itself — the cookie carries it
 * invisibly to JavaScript).
 */
const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const owner = await Owner.findOne({ email: normalizedEmail }).select('+passwordHash');

    // Deliberately the SAME error message whether the email doesn't exist at
    // all or the password is wrong — telling the two apart would let an
    // attacker discover which emails have accounts on this system.
    if (!owner) {
      throw ApiError.unauthorized('Incorrect email or password.');
    }

    const isMatch = await verifyPassword(password, owner.passwordHash);
    if (!isMatch) {
      throw ApiError.unauthorized('Incorrect email or password.');
    }

    const { token, maxAgeMs } = signOwnerToken(
      { ownerId: owner._id, restaurantId: owner.restaurantId },
      Boolean(rememberMe)
    );
    setAuthCookie(res, token, maxAgeMs);

    const restaurant = await Restaurant.findById(owner.restaurantId).select('slug name').lean();

    return new ApiResponse(200, 'Logged in successfully.', {
      owner: { email: owner.email },
      restaurant,
    }).send(res);
  } catch (error) {
    return handleControllerError(res, error, 'AuthController.login', 'An unexpected error occurred while logging in.');
  }
};

/**
 * POST /api/auth/logout
 *
 * Clears the login cookie. No request body needed — the cookie itself
 * identifies the session being ended.
 */
const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME);
  return new ApiResponse(200, 'Logged out successfully.', null).send(res);
};

/**
 * GET /api/auth/me
 *
 * Returns the currently logged-in owner's basic info, if any — used by the
 * frontend on page load to decide "show the dashboard" vs "show the login
 * screen" without the owner needing to re-enter credentials. Sits behind
 * `requireAuth`, so `req.owner` is already verified by the time this runs.
 */
const me = async (req, res) => {
  try {
    const owner = await Owner.findById(req.owner.ownerId).select('email restaurantId');
    if (!owner) {
      throw ApiError.unauthorized('Your session is no longer valid. Please log in again.');
    }

    const restaurant = await Restaurant.findById(owner.restaurantId).select('slug name').lean();

    return new ApiResponse(200, 'Current session retrieved.', {
      owner: { email: owner.email },
      restaurant,
    }).send(res);
  } catch (error) {
    return handleControllerError(res, error, 'AuthController.me', 'Could not verify your current session.');
  }
};

module.exports = { register, login, logout, me };
