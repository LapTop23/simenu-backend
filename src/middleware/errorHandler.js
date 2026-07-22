const ApiError = require('../utils/ApiError');

/**
 * notFoundHandler — catches any request that didn't match a defined route at all
 * (as opposed to a route that matched but couldn't find tenant/resource data).
 * Mounted LAST, after all route definitions.
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * globalErrorHandler — the single place that converts any thrown/forwarded error
 * into a client-facing HTTP response. Must be registered LAST in the middleware
 * chain (Express identifies error middleware by its 4-argument signature).
 *
 * Behavior:
 *  - Known, operational errors (ApiError instances, Mongoose validation/cast errors)
 *    are translated into clean, specific status codes and messages.
 *  - Unexpected errors are logged in full server-side, but the client only ever
 *    receives a generic 500 message — never a raw stack trace or internal detail,
 *    which would otherwise be an information-disclosure risk.
 */
// eslint-disable-next-line no-unused-vars
const globalErrorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'An unexpected server error occurred.';

  // Mongoose validation errors (schema `required`/`min`/`match` violations) → 400.
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(' ');
  }

  // Mongoose cast errors (e.g. an invalid ObjectId passed in a route param) → 400.
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value provided for field "${err.path}".`;
  }

  // MongoDB duplicate-key errors (e.g. a restaurant slug collision) → 409 Conflict.
  if (err.code === 11000) {
    statusCode = 409;
    const duplicatedField = Object.keys(err.keyValue || {}).join(', ');
    message = `A record with the same ${duplicatedField} already exists.`;
  }

  // Multer upload errors (oversized file, unexpected field, etc.) → 400.
  if (err.name === 'MulterError') {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'The image exceeds the maximum allowed size of 5MB.' : err.message;
  }

  // Always log server-side with full detail, regardless of what the client sees.
  if (statusCode >= 500) {
    console.error(`[UNHANDLED ERROR] ${req.method} ${req.originalUrl} →`, err);
  } else {
    console.warn(`[HANDLED ERROR] ${req.method} ${req.originalUrl} → ${statusCode}: ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    // Stack traces are only ever exposed in non-production environments.
    ...(process.env.NODE_ENV !== 'production' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
};

module.exports = { notFoundHandler, globalErrorHandler };
