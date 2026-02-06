/**
 * SEC-006: CSRF Protection Tests
 * Tests for CSRF token generation and validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestAppWithCsrf, resetDb, cleanupTestApp } from '../helpers/app.js';
import { registerUser, getAuthTokens } from '../helpers/auth.js';

describe('SEC-006: CSRF Protection', () => {
  let app: Express;

  beforeEach(async () => {
    resetDb();
    app = await createTestAppWithCsrf();
  });

  afterAll(() => {
    cleanupTestApp();
  });

  describe('GET /api/csrf-token', () => {
    it('should return a CSRF token', async () => {
      const res = await request(app)
        .get('/api/csrf-token');

      expect(res.status).toBe(200);
      expect(res.body.csrfToken).toBeDefined();
      expect(typeof res.body.csrfToken).toBe('string');
      expect(res.body.csrfToken.length).toBeGreaterThan(0);
    });

    it('should set CSRF cookie', async () => {
      const res = await request(app)
        .get('/api/csrf-token');

      expect(res.status).toBe(200);
      // Check that a csrf cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const csrfCookie = cookies?.find((c: string) => c.startsWith('csrf='));
      expect(csrfCookie).toBeDefined();
    });
  });

  describe('CSRF-protected routes', () => {
    let tokens: { accessToken: string; refreshToken: string };
    let csrfToken: string;
    let csrfCookie: string;

    beforeEach(async () => {
      // Get auth tokens
      tokens = await getAuthTokens(app);

      // Get CSRF token
      const csrfRes = await request(app)
        .get('/api/csrf-token');

      csrfToken = csrfRes.body.csrfToken;
      const cookies = csrfRes.headers['set-cookie'];
      csrfCookie = cookies?.find((c: string) => c.startsWith('csrf='))?.split(';')[0] || '';
    });

    it('should reject POST without CSRF token', async () => {
      const res = await request(app)
        .post('/api/user/complete-onboarding')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', csrfCookie);

      // Should be 403 Forbidden due to missing CSRF token
      expect(res.status).toBe(403);
    });

    it('should reject POST with invalid CSRF token', async () => {
      const res = await request(app)
        .post('/api/user/complete-onboarding')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', 'invalid-token');

      expect(res.status).toBe(403);
    });

    it('should accept POST with valid CSRF token', async () => {
      const res = await request(app)
        .post('/api/user/complete-onboarding')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken);

      // Should succeed (200) or fail for business logic reasons, but NOT 403
      expect(res.status).not.toBe(403);
    });

    it('should allow GET requests without CSRF token', async () => {
      const res = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('CSRF cookie attributes', () => {
    it('should set appropriate cookie attributes in development', async () => {
      const res = await request(app)
        .get('/api/csrf-token');

      const cookies = res.headers['set-cookie'];
      const csrfCookie = cookies?.find((c: string) => c.startsWith('csrf='));

      expect(csrfCookie).toBeDefined();
      // In dev mode, should NOT have Secure flag
      // Should have SameSite=Strict
      expect(csrfCookie).toContain('SameSite=Strict');
    });
  });
});
