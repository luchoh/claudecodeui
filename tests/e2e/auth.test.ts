/**
 * SEC-002: Authentication & Token Refresh Tests
 * Tests for register, login, logout, token refresh, and protected routes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDb, cleanupTestApp } from '../helpers/app.js';
import {
  registerUser,
  loginUser,
  getAuthTokens,
  authenticatedGet,
  authenticatedPost,
  generateExpiredToken
} from '../helpers/auth.js';

describe('SEC-002: Authentication & Token Refresh', () => {
  let app: Express;

  // Create fresh app for each test to avoid rate limit state sharing
  beforeEach(async () => {
    resetDb();
    app = await createTestApp();
  });

  afterAll(() => {
    cleanupTestApp();
  });

  describe('POST /api/auth/register', () => {
    it('should register first user successfully', async () => {
      const res = await registerUser(app);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('testuser');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // Ensure token is returned (legacy alias)
      expect(res.body.token).toBeDefined();
    });

    it('should return 403 when user already exists (single-user system)', async () => {
      // First registration
      await registerUser(app);

      // Second registration attempt
      const res = await registerUser(app, 'anotheruser', 'password123');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('already exists');
    });

    it('should return 400 for missing username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'testpass123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should return 400 for missing password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should return 400 for short username', async () => {
      const res = await registerUser(app, 'ab', 'testpass123');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('at least 3 characters');
    });

    it('should return 400 for short password', async () => {
      const res = await registerUser(app, 'testuser', '12345');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('at least 6 characters');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a user first
      await registerUser(app);
    });

    it('should login with correct credentials', async () => {
      const res = await loginUser(app);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('testuser');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('should return 401 with generic error for wrong password', async () => {
      const res = await loginUser(app, 'testuser', 'wrongpassword');

      expect(res.status).toBe(401);
      // Should NOT reveal which field was wrong (security best practice)
      expect(res.body.error).toBe('Invalid username or password');
    });

    it('should return 401 with generic error for wrong username', async () => {
      const res = await loginUser(app, 'nonexistent', 'testpass123');

      expect(res.status).toBe(401);
      // Should NOT reveal that username doesn't exist (security best practice)
      expect(res.body.error).toBe('Invalid username or password');
    });

    it('should return 400 for missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/user (protected)', () => {
    it('should return user info with valid token', async () => {
      const tokens = await getAuthTokens(app);
      const res = await authenticatedGet(app, '/api/auth/user', tokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('testuser');
    });

    it('should return 401 without token', async () => {
      // Register user first (so route exists)
      await registerUser(app);

      const res = await request(app)
        .get('/api/auth/user');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Access denied');
    });

    it('should return 401 with expired token', async () => {
      // Register user first
      await registerUser(app);

      const expiredToken = generateExpiredToken();
      const res = await authenticatedGet(app, '/api/auth/user', expiredToken);

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid token');
    });

    it('should return 401 with invalid token', async () => {
      await registerUser(app);

      const res = await authenticatedGet(app, '/api/auth/user', 'invalid.token.here');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const tokens = await getAuthTokens(app);

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // New refresh token should be different from original (single-use)
      expect(res.body.refreshToken).not.toBe(tokens.refreshToken);
    });

    it('should return 400 without refresh token', async () => {
      await registerUser(app);

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should return 401 with invalid refresh token', async () => {
      await registerUser(app);

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired');
    });

    it('should return 401 when reusing consumed refresh token', async () => {
      const tokens = await getAuthTokens(app);

      // First refresh - should succeed
      const firstRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(firstRefresh.status).toBe(200);

      // Second refresh with same token - should fail (token is consumed)
      const secondRefresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(secondRefresh.status).toBe(401);
      expect(secondRefresh.body.error).toContain('Invalid or expired');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and revoke all refresh tokens', async () => {
      const tokens = await getAuthTokens(app);

      // Logout
      const logoutRes = await authenticatedPost(app, '/api/auth/logout', tokens.accessToken);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Attempt to use refresh token after logout - should fail
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });

      expect(refreshRes.status).toBe(401);
    });

    it('should return 401 when logging out without token', async () => {
      await registerUser(app);

      const res = await request(app)
        .post('/api/auth/logout')
        .send({});

      expect(res.status).toBe(401);
    });
  });
});
