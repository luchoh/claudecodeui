/**
 * SEC-009: Rate Limiting Tests
 * Tests for auth rate limiter (10/min) and general rate limiter (100/min)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDb, cleanupTestApp } from '../helpers/app.js';
import { registerUser, getAuthToken, authenticatedGet } from '../helpers/auth.js';

describe('SEC-009: Rate Limiting', () => {
  let app: Express;

  // Create fresh app for each test to get fresh rate limiter state
  beforeEach(async () => {
    resetDb();
    app = await createTestApp();
  });

  afterAll(() => {
    cleanupTestApp();
  });

  describe('Auth Rate Limiter (10 requests/minute)', () => {
    it('should allow 10 auth requests without rate limiting', async () => {
      // Create user first
      await registerUser(app);

      // Make 10 login requests (all should succeed or fail auth, not rate limit)
      for (let i = 0; i < 9; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ username: 'testuser', password: 'wrongpass' });

        // Should return 401 (auth failure), not 429 (rate limit)
        expect(res.status).toBe(401);
      }
    });

    it('should return 429 on 11th auth request', async () => {
      // Create user first
      await registerUser(app);

      // Make 10 login requests to exhaust the limit
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ username: 'testuser', password: 'wrongpass' });
      }

      // 11th request should be rate limited
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpass' });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain('Too many');
    });

    it('should rate limit register endpoint', async () => {
      // Make 10 register requests (first succeeds, rest fail with 403)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/register')
          .send({ username: `user${i}`, password: 'testpass123' });
      }

      // 11th request should be rate limited
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'user10', password: 'testpass123' });

      expect(res.status).toBe(429);
    });

    it('should include rate limit headers', async () => {
      await registerUser(app);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpass' });

      // Check for standard rate limit headers
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBeDefined();
    });
  });

  describe('General Rate Limiter (100 requests/minute)', () => {
    it('should allow 100 general API requests without rate limiting', async () => {
      // This test verifies the general rate limiter
      // We'll hit the /health endpoint which doesn't require auth
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(request(app).get('/health'));
      }

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach((res) => {
        expect(res.status).toBe(200);
      });
    });

    it('should allow many protected route requests with valid token', async () => {
      const token = await getAuthToken(app);

      // Note: /api/auth/* routes use the AUTH rate limiter (10/min),
      // not the general rate limiter (100/min).
      // getAuthToken() already uses 1 register request.
      // We can make up to 9 more requests to /api/auth/user
      const requests = [];
      for (let i = 0; i < 8; i++) {
        requests.push(authenticatedGet(app, '/api/auth/user', token));
      }

      const responses = await Promise.all(requests);

      // All 8 should return 200 (within auth rate limit)
      responses.forEach((res) => {
        expect(res.status).toBe(200);
      });
    });
  });

  describe('Rate Limiter Reset', () => {
    it('should track rate limit via headers', async () => {
      await registerUser(app);

      // Make a request
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'testpass123' });

      // Check remaining decreases
      const remaining = parseInt(res.headers['ratelimit-remaining']);
      expect(remaining).toBeLessThan(10);
    });
  });
});
