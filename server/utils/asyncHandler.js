/**
 * Async Handler utility to wrap asynchronous Express route handlers.
 * It ensures that any error occurring in the async function is caught
 * and passed to the next() middleware, preventing server crashes.
 * 
 * @param {Function} fn - The asynchronous function to wrap
 * @returns {Function} - A middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
