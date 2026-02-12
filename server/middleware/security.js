/**
 * Security middleware for rate limiting and error sanitization
 * SEC-009, SEC-010
 */
import rateLimit from 'express-rate-limit';

// Configuration from environment
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10); // 1 minute default
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10); // 100 requests per window
const RATE_LIMIT_AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10); // 10 auth attempts per window

/**
 * SEC-009: Rate limiter for authentication endpoints
 * More restrictive to prevent brute force attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_AUTH_MAX,
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use req.ip which respects app.set('trust proxy') configuration.
    // Do NOT use x-forwarded-for directly as it can be spoofed to bypass rate limits.
    // Configure app.set('trust proxy', ...) when behind a reverse proxy.
    return req.ip || req.socket.remoteAddress;
  }
});

/**
 * SEC-009: General rate limiter for API endpoints
 */
export const generalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_MAX,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use req.ip which respects app.set('trust proxy') configuration.
    // Do NOT use x-forwarded-for directly as it can be spoofed to bypass rate limits.
    // Configure app.set('trust proxy', ...) when behind a reverse proxy.
    return req.ip || req.socket.remoteAddress;
  }
});

/**
 * SEC-010: Error sanitization middleware
 * Prevents stack trace leakage in production
 */
export const errorSanitizer = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Log the full error server-side
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (!isProduction) {
    console.error(err.stack);
  }

  // Determine status code
  const status = err.status || err.statusCode || 500;

  // Send sanitized response
  res.status(status).json({
    error: isProduction && status === 500
      ? 'Internal server error'
      : err.message || 'An error occurred',
    ...(isProduction ? {} : { stack: err.stack })
  });
};

/**
 * Middleware to mark 404s for API routes
 */
export const notFoundHandler = (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Endpoint not found' });
  } else {
    next();
  }
};
