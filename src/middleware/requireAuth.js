const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyOwnerToken } = require('../utils/jwt');

/**
 * requireAuth — verifies the httpOnly login cookie set at login time.
 *
 * Deliberately reads from `req.cookies` (an httpOnly cookie), never from an
 * Authorization header holding a token the frontend manages itself. Storing
 * the token in an httpOnly cookie means client-side JavaScript — including
 * any malicious script that ever got injected into the page — is physically
 * unable to read it. The browser attaches it to requests automatically;
 * nothing in the frontend ever touches the token's actual value.
 *
 * On success, attaches `req.owner = { ownerId, restaurantId }` — a
 * DB-signed, tamper-proof identity (the token is cryptographically signed;
 * altering it invalidates it) that downstream code can trust.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.simenu_token;

  if (!token) {
    throw ApiError.unauthorized('You must be logged in to do this.');
  }

  let payload;
  try {
    payload = verifyOwnerToken(token);
  } catch (error) {
    throw ApiError.unauthorized('Your session has expired or is invalid. Please log in again.');
  }

  req.owner = { ownerId: payload.ownerId, restaurantId: payload.restaurantId };
  next();
});

/**
 * requireOwnerMatchesTenant — MUST be used after both `tenantResolver` (which
 * sets `req.tenant` from the DB-verified `?res=` slug) and `requireAuth`
 * (which sets `req.owner` from the verified login cookie).
 *
 * This is the actual authorization check: being logged in only proves WHO
 * you are; this confirms you're allowed to act on THIS SPECIFIC restaurant.
 * Without this check, any logged-in owner could edit any restaurant's menu
 * just by changing the `?res=` slug in the URL — this is what stops that.
 */
const requireOwnerMatchesTenant = (req, res, next) => {
  if (!req.owner || !req.tenant) {
    // Programming error if this fires — means the middleware order was
    // wrong somewhere in a route file. Fail closed, not open.
    throw ApiError.forbidden('You do not have permission to access this restaurant.');
  }

  if (String(req.owner.restaurantId) !== String(req.tenant.id)) {
    throw ApiError.forbidden('You do not have permission to access this restaurant.');
  }

  next();
};

module.exports = { requireAuth, requireOwnerMatchesTenant };
