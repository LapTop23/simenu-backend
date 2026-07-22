/**
 * ApiError — a normalized, HTTP-status-aware error type.
 *
 * Using a dedicated error class (instead of throwing plain strings or generic Errors)
 * lets the centralized error-handling middleware distinguish "expected" operational
 * errors (bad tenant, item not found, validation failure) — which should return a clean
 * status code and message — from truly unexpected programming errors, which should be
 * logged with a stack trace and returned as a generic 500 to avoid leaking internals.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code to send to the client.
   * @param {string} message - Human-readable, client-safe error message.
   * @param {boolean} isOperational - True for expected/handled errors (default true).
   */
  constructor(statusCode, message, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = 'ApiError';

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'The request could not be understood or was missing required parameters.') {
    return new ApiError(400, message);
  }

  static unauthorized(message = 'Authentication is required to access this resource.') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have permission to access this resource.') {
    return new ApiError(403, message);
  }

  static notFound(message = 'The requested resource could not be found.') {
    return new ApiError(404, message);
  }

  static internal(message = 'An unexpected error occurred while processing the request.') {
    return new ApiError(500, message, false);
  }
}

module.exports = ApiError;
