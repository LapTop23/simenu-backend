const crypto = require('crypto');

/**
 * Derives a table's secret QR key from the restaurant's private qrSecret.
 *
 * Deterministic (same restaurant + same table number always produces the
 * same key), so individual keys never need to be generated ahead of time or
 * stored anywhere — they're recomputed on demand and compared. Uses HMAC-SHA256
 * (a keyed, one-way function): knowing table 5's key gives no mathematical
 * shortcut toward guessing table 6's key, since each key depends on the
 * secret in a way that isn't reversible or predictable between inputs.
 *
 * The result is truncated to 16 hex characters (64 bits of entropy) — short
 * enough to fit comfortably in a QR code and URL, long enough that guessing
 * it by brute force is computationally infeasible even before rate-limiting
 * is factored in.
 */
function generateTableKey(qrSecret, tableNumber) {
  return crypto.createHmac('sha256', qrSecret).update(String(tableNumber)).digest('hex').slice(0, 16);
}

module.exports = { generateTableKey };
