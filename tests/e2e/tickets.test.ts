/**
 * SEC-005: Single-Use Auth Tickets Tests
 * Tests for ticket generation, consumption, expiry, and purpose validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDb, cleanupTestApp } from '../helpers/app.js';
import { registerUser, getAuthTokens, authenticatedPost } from '../helpers/auth.js';

describe('SEC-005: Single-Use Auth Tickets', () => {
  let app: Express;

  // Create fresh app for each test to avoid rate limit state sharing
  beforeEach(async () => {
    resetDb();
    vi.useRealTimers();
    app = await createTestApp();
  });

  afterAll(() => {
    cleanupTestApp();
  });

  describe('POST /api/auth/ticket', () => {
    it('should generate ticket for valid purpose', async () => {
      const tokens = await getAuthTokens(app);

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'websocket'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
      expect(typeof res.body.ticket).toBe('string');
      expect(res.body.expiresIn).toBe(30); // 30 seconds TTL
    });

    it('should generate ticket for shell purpose', async () => {
      const tokens = await getAuthTokens(app);

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'shell'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
    });

    it('should generate ticket for sse-clone purpose', async () => {
      const tokens = await getAuthTokens(app);

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'sse-clone'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
    });

    it('should return 400 for invalid purpose', async () => {
      const tokens = await getAuthTokens(app);

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'invalid-purpose'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid purpose');
      expect(res.body.validPurposes).toBeDefined();
      expect(res.body.validPurposes).toContain('websocket');
      expect(res.body.validPurposes).toContain('shell');
      expect(res.body.validPurposes).toContain('sse-clone');
    });

    it('should return 400 when purpose is missing', async () => {
      const tokens = await getAuthTokens(app);

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid purpose');
    });

    it('should return 401 without authentication', async () => {
      // Need to register first so the route exists
      await registerUser(app);

      const res = await request(app)
        .post('/api/auth/ticket')
        .send({ purpose: 'websocket' });

      expect(res.status).toBe(401);
    });

    it('should include context in ticket if provided', async () => {
      const tokens = await getAuthTokens(app);
      const context = { projectId: '123', sessionId: 'abc' };

      const res = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'websocket',
        context
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
      // Context is stored but not returned in response (verified via consumption)
    });
  });

  describe('Ticket Consumption', () => {
    it('tickets should be consumed on first use', async () => {
      const tokens = await getAuthTokens(app);

      // Generate a ticket
      const ticketRes = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'websocket'
      });
      const ticket = ticketRes.body.ticket;

      // Import the ticket validation function to test consumption
      const authModule = await import('../../server/middleware/auth.js');

      // First use - should succeed
      const firstResult = authModule.validateAuthTicket(ticket, 'websocket');
      expect(firstResult).not.toBeNull();
      expect(firstResult!.userId).toBeDefined();

      // Second use - should fail (ticket consumed)
      const secondResult = authModule.validateAuthTicket(ticket, 'websocket');
      expect(secondResult).toBeNull();
    });

    it('ticket should be rejected for mismatched purpose', async () => {
      const tokens = await getAuthTokens(app);

      // Generate a ticket for websocket
      const ticketRes = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'websocket'
      });
      const ticket = ticketRes.body.ticket;

      // Import the ticket validation function
      const authModule = await import('../../server/middleware/auth.js');

      // Try to use it for shell purpose - should fail
      const result = authModule.validateAuthTicket(ticket, 'shell');
      expect(result).toBeNull();
    });

    it('ticket should expire after TTL', async () => {
      const tokens = await getAuthTokens(app);

      // Generate a ticket
      const ticketRes = await authenticatedPost(app, '/api/auth/ticket', tokens.accessToken, {
        purpose: 'websocket'
      });
      const ticket = ticketRes.body.ticket;

      // Import the ticket validation function
      const authModule = await import('../../server/middleware/auth.js');

      // Mock time to be 31 seconds in the future
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 31000);

      // Attempt to use expired ticket - should fail
      const result = authModule.validateAuthTicket(ticket, 'websocket');
      expect(result).toBeNull();
    });
  });
});
