/**
 * Express app factory for testing
 * Creates isolated Express app instances without starting HTTP server
 */

import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { doubleCsrf } from 'csrf-csrf';
import { createTestDb, resetDb, closeDb } from './db.js';

// Must be created before importing server modules
let dbInitialized = false;

/**
 * Initialize test database (only once)
 */
function ensureDbInitialized() {
  if (!dbInitialized) {
    createTestDb();
    dbInitialized = true;
  }
}

/**
 * Creates fresh rate limiters for each test app
 * This prevents rate limit state from persisting across tests
 */
function createRateLimiters() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
  const maxAuth = parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10);
  const maxGeneral = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

  const authRateLimiter = rateLimit({
    windowMs,
    max: maxAuth,
    message: { error: 'Too many authentication attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown'
  });

  const generalRateLimiter = rateLimit({
    windowMs,
    max: maxGeneral,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown'
  });

  return { authRateLimiter, generalRateLimiter };
}

/**
 * Creates a fresh Express app instance configured for testing
 * Each call creates new rate limiter instances to avoid state sharing
 */
export async function createTestApp(): Promise<Express> {
  ensureDbInitialized();

  // Dynamic imports to ensure test database is set up first
  const { default: authRoutes } = await import('../../server/routes/auth.js');
  const { default: settingsRoutes } = await import('../../server/routes/settings.js');
  const { authenticateToken } = await import('../../server/middleware/auth.js');
  const { errorSanitizer } = await import('../../server/middleware/security.js');

  // Create fresh rate limiters for this app instance
  const { authRateLimiter, generalRateLimiter } = createRateLimiters();

  const app = express();

  // CORS (permissive for tests)
  app.use(cors());

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check (not rate limited)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // General rate limiting for API routes
  app.use('/api', generalRateLimiter);

  // Auth routes (public, with auth rate limiter)
  app.use('/api/auth', authRateLimiter, authRoutes);

  // Settings routes (protected)
  app.use('/api/settings', authenticateToken, settingsRoutes);

  // Error handler
  app.use(errorSanitizer);

  return app;
}

/**
 * Creates a test app with a fresh database (for isolated tests)
 */
export async function createIsolatedTestApp(): Promise<Express> {
  resetDb();
  return createTestApp();
}

/**
 * Creates a test app with CSRF protection enabled
 * This mirrors the production configuration more closely
 */
export async function createTestAppWithCsrf(): Promise<Express> {
  ensureDbInitialized();

  // Dynamic imports to ensure test database is set up first
  const { default: authRoutes } = await import('../../server/routes/auth.js');
  const { default: settingsRoutes } = await import('../../server/routes/settings.js');
  const { default: userRoutes } = await import('../../server/routes/user.js');
  const { authenticateToken } = await import('../../server/middleware/auth.js');
  const { errorSanitizer } = await import('../../server/middleware/security.js');

  // Create fresh rate limiters for this app instance
  const { authRateLimiter, generalRateLimiter } = createRateLimiters();

  const app = express();

  // CORS (permissive for tests)
  app.use(cors());

  // Cookie parser (REQUIRED for CSRF)
  app.use(cookieParser());

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check (not rate limited)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // General rate limiting for API routes
  app.use('/api', generalRateLimiter);

  // CSRF protection setup
  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => 'test-csrf-secret',
    cookieName: 'csrf',
    cookieOptions: {
      httpOnly: false,
      sameSite: 'strict',
      secure: false,
      path: '/'
    },
    size: 64,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
    getSessionIdentifier: (req) => req.ip || 'anonymous'
  });

  // CSRF token endpoint
  app.get('/api/csrf-token', (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });

  // Auth routes (public, with auth rate limiter)
  app.use('/api/auth', authRateLimiter, authRoutes);

  // Protected routes with CSRF
  app.use('/api/settings', authenticateToken, doubleCsrfProtection, settingsRoutes);
  app.use('/api/user', authenticateToken, doubleCsrfProtection, userRoutes);

  // Error handler
  app.use(errorSanitizer);

  return app;
}

/**
 * Cleanup function to call after all tests
 */
export function cleanupTestApp(): void {
  closeDb();
  dbInitialized = false;
}

// Re-export database helpers
export { resetDb, closeDb };
