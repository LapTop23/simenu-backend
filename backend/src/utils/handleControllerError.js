const ApiError = require('./ApiError');

/**
 * handleControllerError — a single place that turns any thrown error into the
 * right HTTP status + message, for controllers that catch locally instead of
 * forwarding to the centralized error middleware via `next(err)`.
 *
 * Existing controllers (menu/order/restaurant) each re-implemented a version
 * of this instanceof/name-checking block inline; new CRUD handlers use this
 * shared helper instead so the mapping (ValidationError → 400, CastError →
 * 400, duplicate key → 409, ApiError → its own statusCode, anything else →
 * 500) only has to be correct in one place.
 *
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} logContext - short label for the server-side log line, e.g. "MenuController.createMenuItem"
 * @param {string} fallbackMessage - client-safe message used for unexpected (500) errors
 */
function handleControllerError(res, error, logContext, fallbackMessage) {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors).map((e) => e.message).join(' ');
    return res.status(400).json({ success: false, message });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid value provided for field "${error.path}".` });
  }

  if (error.code === 11000) {
    const duplicatedField = Object.keys(error.keyValue || {}).join(', ');
    return res.status(409).json({ success: false, message: `A record with the same ${duplicatedField} already exists.` });
  }

  console.error(`[${logContext}]`, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

module.exports = handleControllerError;
