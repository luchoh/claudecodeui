import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { userDb, refreshTokensDb, ticketsDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';

// JWT secret - MUST be set via environment variable (no fallback for security)
const JWT_SECRET = process.env.JWT_SECRET;

// Token expiry configuration
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10);

/**
 * Validate security configuration at startup
 * Called from server/index.js before starting the server
 */
function validateSecurityConfig() {
  const errors = [];

  // SEC-001: Require JWT_SECRET with minimum length
  if (!JWT_SECRET) {
    errors.push(
      'JWT_SECRET environment variable is required.',
      'Generate one with: openssl rand -base64 32'
    );
  } else if (JWT_SECRET.length < 32) {
    errors.push(
      `JWT_SECRET must be at least 32 characters (current: ${JWT_SECRET.length}).`,
      'Generate a secure secret with: openssl rand -base64 32'
    );
  }

  // SEC-017: Platform mode requires explicit acknowledgment
  if (IS_PLATFORM && process.env.ALLOW_PLATFORM_MODE !== 'true') {
    errors.push(
      'VITE_IS_PLATFORM=true but ALLOW_PLATFORM_MODE is not set.',
      'Platform mode bypasses ALL authentication!',
      'If intentional, set ALLOW_PLATFORM_MODE=true',
      'For self-hosted/VPN use, set VITE_IS_PLATFORM=false'
    );
  }

  if (errors.length > 0) {
    console.error('');
    console.error('═'.repeat(70));
    console.error('SECURITY ERROR: Configuration validation failed');
    console.error('═'.repeat(70));
    errors.forEach(err => console.error(`  • ${err}`));
    console.error('═'.repeat(70));
    console.error('');
    process.exit(1);
  }

  // Warn about platform mode even when properly configured
  if (IS_PLATFORM) {
    console.warn('');
    console.warn('═'.repeat(70));
    console.warn('WARNING: Running in PLATFORM MODE - Authentication BYPASSED');
    console.warn('All requests auto-authenticated as first database user');
    console.warn('═'.repeat(70));
    console.warn('');
  }
}

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // SEC-005: Query param tokens no longer supported for security
  // Use ticket-based auth for WebSocket/SSE connections instead

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate short-lived access token
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

// Generate long-lived refresh token (stored in database)
const generateRefreshToken = async (userId) => {
  const tokenId = crypto.randomUUID();
  const tokenValue = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + (REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

  refreshTokensDb.create(tokenId, userId, tokenHash, expiresAt);
  return `${tokenId}.${tokenValue}`;
};

// Validate and consume refresh token (returns userId or null)
const validateRefreshToken = (refreshToken) => {
  if (!refreshToken || typeof refreshToken !== 'string') return null;

  const parts = refreshToken.split('.');
  if (parts.length !== 2) return null;

  const [tokenId, tokenValue] = parts;
  const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex');

  return refreshTokensDb.validateAndConsume(tokenId, tokenHash);
};

// Revoke all refresh tokens for a user (used on logout)
const revokeUserRefreshTokens = (userId) => {
  refreshTokensDb.deleteAllForUser(userId);
};

// Legacy alias for backwards compatibility
const generateToken = generateAccessToken;

// WebSocket authentication function (legacy - kept for backward compatibility during migration)
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

// SEC-005: Ticket-based authentication for WebSocket/SSE
// Tickets are single-use, short-lived tokens for connection establishment

/**
 * Generate a single-use ticket for WebSocket/SSE authentication
 * @param {number} userId - The user ID
 * @param {string} purpose - The ticket purpose ('websocket' | 'sse-clone' | etc.)
 * @param {object} context - Optional context data to include with the ticket
 * @returns {{ticket: string, expiresIn: number}} The ticket ID and expiry in seconds
 */
const generateAuthTicket = (userId, purpose, context = {}) => {
  const ticketId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 30; // 30 seconds

  ticketsDb.create(ticketId, userId, purpose, context, expiresAt);

  return { ticket: ticketId, expiresIn: 30 };
};

/**
 * Validate and consume a single-use ticket
 * @param {string} ticketId - The ticket ID
 * @param {string} expectedPurpose - The expected purpose
 * @returns {{userId: number, purpose: string, context: object} | null} Ticket info or null if invalid
 */
const validateAuthTicket = (ticketId, expectedPurpose) => {
  if (!ticketId || typeof ticketId !== 'string') return null;
  return ticketsDb.validateAndConsume(ticketId, expectedPurpose);
};

/**
 * Authenticate WebSocket connection using ticket-based auth
 * @param {string} ticket - The ticket ID
 * @param {string} purpose - The expected purpose ('websocket' | 'shell')
 * @returns {{userId: number, username: string, context: object} | null}
 */
const authenticateWebSocketWithTicket = (ticket, purpose = 'websocket') => {
  // Platform mode: bypass ticket validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { userId: user.id, username: user.username, context: {} };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Validate ticket
  const ticketData = validateAuthTicket(ticket, purpose);
  if (!ticketData) {
    return null;
  }

  // Get user info
  const user = userDb.getUserById(ticketData.userId);
  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username,
    context: ticketData.context
  };
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeUserRefreshTokens,
  generateAuthTicket,
  validateAuthTicket,
  authenticateWebSocket,
  authenticateWebSocketWithTicket,
  validateSecurityConfig,
  JWT_SECRET
};