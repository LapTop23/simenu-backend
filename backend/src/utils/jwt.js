const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  // Fail loudly at startup rather than silently signing tokens with
  // `undefined` — a missing secret is a configuration bug, not something to
  // paper over with a fallback default (a hardcoded fallback secret would be
  // a serious, silent security hole).
  console.error('[Auth] FATAL: JWT_SECRET is not set in your .env file. Add a long, random JWT_SECRET before starting the server.');
  process.exit(1);
}

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day — a normal, un-"remembered" login.
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days.

/**
 * Signs a new login token for an owner. `rememberMe` controls how long it
 * stays valid — this value is embedded in the token itself (`exp` claim),
 * not just in how long the cookie is kept, so the token becomes genuinely
 * unusable after expiry even if a copy of the cookie somehow persisted
 * longer than intended.
 */
function signOwnerToken({ ownerId, restaurantId }, rememberMe = false) {
  const maxAgeMs = rememberMe ? REMEMBER_ME_MAX_AGE_MS : SESSION_MAX_AGE_MS;
  const token = jwt.sign({ ownerId, restaurantId }, JWT_SECRET, { expiresIn: Math.floor(maxAgeMs / 1000) });
  return { token, maxAgeMs };
}

/**
 * Verifies a token and returns its payload, or throws if invalid/expired.
 */
function verifyOwnerToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signOwnerToken, verifyOwnerToken, SESSION_MAX_AGE_MS, REMEMBER_ME_MAX_AGE_MS };
