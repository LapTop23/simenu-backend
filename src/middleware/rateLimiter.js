const rateLimit = require('express-rate-limit');

/**
 * verifyTableScanLimiter — deliberately strict, applied only to
 * POST /api/restaurants/verify-table.
 *
 * Even though a table key is long enough that brute-forcing it is
 * computationally infeasible on its own (see utils/tableSecurity.js), rate
 * limiting is a required second layer, not an optional extra: it's what
 * actually stops an automated script from making thousands of rapid guesses
 * per second against this one endpoint in the first place, and it's the
 * standard, expected control on any endpoint that checks a secret value.
 *
 * 20 attempts per 10 minutes, per IP address, is generous for any real
 * customer (who scans once and is done) while making sustained guessing
 * attempts impractical.
 */
const verifyTableScanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
});

module.exports = { verifyTableScanLimiter };
