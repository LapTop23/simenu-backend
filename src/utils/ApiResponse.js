/**
 * ApiResponse — a normalized success-response envelope.
 *
 * Every successful endpoint in SI-Menu returns the same shape:
 *   { success: true, message, data, meta }
 * This lets frontend clients (admin dashboard, customer PWA) write one generic
 * response-parsing layer instead of handling bespoke shapes per endpoint.
 */
class ApiResponse {
  /**
   * @param {number} statusCode - HTTP status code.
   * @param {string} message - Human-readable success message.
   * @param {*} data - Payload returned to the client.
   * @param {object} [meta] - Optional metadata (pagination, counts, tenant context, etc).
   */
  constructor(statusCode, message, data = null, meta = {}) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    this.meta = meta;
  }

  send(res) {
    return res.status(this.statusCode).json({
      success: this.success,
      message: this.message,
      data: this.data,
      meta: this.meta,
    });
  }
}

module.exports = ApiResponse;
