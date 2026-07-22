/**
 * asyncHandler — wraps an async Express route/middleware handler so that any rejected
 * promise (thrown error, failed await) is automatically forwarded to `next(err)`
 * instead of crashing the process or requiring a manual try/catch in every controller.
 *
 * Controllers in this codebase still use explicit try/catch blocks where they need to
 * translate specific failure modes into specific status codes (per the task
 * requirement for "proper try-catch error handling with meaningful HTTP status
 * codes"). This wrapper is the safety net underneath that — it guarantees that even an
 * unanticipated thrown error inside a controller reaches the centralized error handler
 * rather than hanging the request or leaking a raw stack trace.
 *
 * @param {Function} fn - An async (req, res, next) => {} Express handler.
 * @returns {Function} A wrapped handler safe to pass directly to `router.get/post/...`.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
