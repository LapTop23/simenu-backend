const crypto = require('crypto');

const SESSION_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours — a normal dining visit.
const sessions = new Map();

/**
 * Creates a temporary session after a real QR scan is verified (see
 * restaurant.controller.js `verifyTableScan`). The customer's browser stores
 * the returned sessionId and sends it with every order placed during this
 * visit, instead of re-proving the table key on each individual order.
 *
 * Tied to one specific restaurant AND one specific table — a session minted
 * for table 5 can never be used to place an order claiming to be table 12,
 * even by someone who has a valid (but different) session.
 */
function createSession(restaurantId, tableNumber) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  sessions.set(sessionId, { restaurantId: String(restaurantId), tableNumber: String(tableNumber), expiresAt });
  return { sessionId, expiresAt };
}

/**
 * Validates a session at order-placement time. The expiry check is against
 * the SERVER's own clock and the SERVER's own stored value — the customer's
 * browser is never trusted to self-report whether its session is still
 * valid. Returns false (never throws) for anything missing, expired, or
 * mismatched; the caller decides how to respond.
 */
function validateSession(sessionId, restaurantId, tableNumber) {
  if (!sessionId) return false;

  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId); // Expired — clean it up immediately rather than waiting for the sweep.
    return false;
  }

  return session.restaurantId === String(restaurantId) && session.tableNumber === String(tableNumber);
}

// Periodic cleanup so this Map doesn't grow forever on a long-running server.
// `.unref()` means this timer alone never keeps the Node process alive —
// it won't prevent a clean shutdown.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}, 15 * 60 * 1000).unref();

module.exports = { createSession, validateSession };
