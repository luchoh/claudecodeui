import express from 'express';
import bcrypt from 'bcrypt';
import { userDb, db } from '../database/db.js';
import {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeUserRefreshTokens,
  generateAuthTicket,
  authenticateToken
} from '../middleware/auth.js';

const router = express.Router();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }
    
    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }
      
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      // Create user
      const user = userDb.createUser(username, passwordHash);
      
      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id);

      // Update last login
      userDb.updateLastLogin(user.id);

      db.prepare('COMMIT').run();

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token: accessToken,
        accessToken,
        refreshToken
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id);

    // Update last login
    userDb.updateLastLogin(user.id);

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token: accessToken,
      accessToken,
      refreshToken
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// SEC-002: Token refresh endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    // Validate and consume refresh token
    const userId = validateRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Get user
    const user = userDb.getUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await generateRefreshToken(user.id);

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: newAccessToken // Legacy alias
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SEC-002: Logout - revoke refresh tokens
router.post('/logout', authenticateToken, (req, res) => {
  try {
    // Revoke all refresh tokens for this user
    revokeUserRefreshTokens(req.user.id);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SEC-005: Generate auth ticket for WebSocket/SSE connections
router.post('/ticket', authenticateToken, (req, res) => {
  try {
    const { purpose, context } = req.body;

    // Validate purpose
    const validPurposes = ['websocket', 'shell', 'sse-clone'];
    if (!purpose || !validPurposes.includes(purpose)) {
      return res.status(400).json({
        error: 'Invalid purpose',
        validPurposes
      });
    }

    // Generate ticket
    const { ticket, expiresIn } = generateAuthTicket(req.user.id, purpose, context || {});

    res.json({
      success: true,
      ticket,
      expiresIn
    });

  } catch (error) {
    console.error('Ticket generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;