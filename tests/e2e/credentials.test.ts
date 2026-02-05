/**
 * SEC-011: Credential Storage Tests
 * Tests for keychain integration, fallback to database, and credential CRUD
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, resetDb, cleanupTestApp } from '../helpers/app.js';
import { getAuthToken, authenticatedGet, authenticatedPost, authenticatedDelete, authenticatedPatch } from '../helpers/auth.js';
import { setKeychainAvailable, setKeychainShouldFail, resetKeychainMock } from '../setup.js';

describe('SEC-011: Credential Storage', () => {
  let app: Express;

  // Create fresh app for each test to avoid rate limit state sharing
  beforeEach(async () => {
    resetDb();
    resetKeychainMock();
    app = await createTestApp();
  });

  afterAll(() => {
    cleanupTestApp();
  });

  describe('GET /api/settings/credentials/security-status', () => {
    it('should return keychainAvailable: true when keychain is available', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      const res = await authenticatedGet(app, '/api/settings/credentials/security-status', token);

      expect(res.status).toBe(200);
      expect(res.body.keychainAvailable).toBe(true);
      expect(res.body.storageBackend).toBe('keychain');
      expect(res.body.warning).toBeNull();
    });

    // Note: In the test environment, keytar is always "available" because we mock it.
    // The isAvailable() check only verifies keytar can be imported, not that operations succeed.
    // This test verifies the expected structure when keychain IS available.
    it('should return proper security status structure', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedGet(app, '/api/settings/credentials/security-status', token);

      expect(res.status).toBe(200);
      expect(typeof res.body.keychainAvailable).toBe('boolean');
      expect(typeof res.body.storageBackend).toBe('string');
      // Warning is null when keychain is available, string when not
      expect(res.body.warning === null || typeof res.body.warning === 'string').toBe(true);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/settings/credentials/security-status');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/settings/credentials', () => {
    it('should store credential in keychain when available', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My GitHub Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_test123456789',
        description: 'Test token'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.credential).toBeDefined();
      expect(res.body.credential.credentialName).toBe('My GitHub Token');
      expect(res.body.storageType).toBe('keychain');
      expect(res.body.warning).toBeNull();
    });

    // Note: In production, if keytar cannot be imported at all (not installed),
    // isKeychainAvailable() returns false and credentials fall back to database.
    // In our test environment, keytar is mocked so it's always "available".
    // When we set keychainAvailable=false, operations throw, which is treated as a real error.
    // This test verifies that keychain operation errors are properly surfaced.
    it('should return error when keychain operations fail', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(false); // This makes keychain operations throw

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My GitHub Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_test123456789',
        description: 'Test token'
      });

      // The implementation surfaces keychain errors (fail-fast design)
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Keychain');
    });

    it('should return 500 when keychain write fails', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);
      setKeychainShouldFail(true);

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My GitHub Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_test123456789'
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Keychain write failed');
    });

    it('should return 400 for missing credential name', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialType: 'github_token',
        credentialValue: 'ghp_test123456789'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name');
    });

    it('should return 400 for missing credential type', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My Token',
        credentialValue: 'ghp_test123456789'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('type');
    });

    it('should return 400 for missing credential value', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My Token',
        credentialType: 'github_token'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('value');
    });
  });

  describe('GET /api/settings/credentials', () => {
    it('should return metadata only (no credential values)', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      // Create a credential first
      await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My GitHub Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_secret123',
        description: 'Test token'
      });

      // Get credentials
      const res = await authenticatedGet(app, '/api/settings/credentials', token);

      expect(res.status).toBe(200);
      expect(res.body.credentials).toBeDefined();
      expect(Array.isArray(res.body.credentials)).toBe(true);
      expect(res.body.credentials.length).toBe(1);

      const credential = res.body.credentials[0];
      expect(credential.credential_name).toBe('My GitHub Token');
      expect(credential.credential_type).toBe('github_token');
      expect(credential.description).toBe('Test token');
      expect(credential.is_active).toBe(1);
      // IMPORTANT: Should NOT include the actual credential value
      expect(credential.credential_value).toBeUndefined();
    });

    it('should filter credentials by type', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      // Create multiple credentials
      await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'GitHub',
        credentialType: 'github_token',
        credentialValue: 'ghp_123'
      });
      await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'GitLab',
        credentialType: 'gitlab_token',
        credentialValue: 'glpat_123'
      });

      // Filter by type
      const res = await authenticatedGet(app, '/api/settings/credentials?type=github_token', token);

      expect(res.status).toBe(200);
      expect(res.body.credentials.length).toBe(1);
      expect(res.body.credentials[0].credential_type).toBe('github_token');
    });
  });

  describe('DELETE /api/settings/credentials/:credentialId', () => {
    it('should delete credential from both keychain and database', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      // Create a credential
      const createRes = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_secret'
      });

      const credentialId = createRes.body.credential.id;

      // Delete it
      const deleteRes = await authenticatedDelete(
        app,
        `/api/settings/credentials/${credentialId}`,
        token
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify it's gone
      const listRes = await authenticatedGet(app, '/api/settings/credentials', token);
      expect(listRes.body.credentials.length).toBe(0);
    });

    it('should return 404 for non-existent credential', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedDelete(app, '/api/settings/credentials/99999', token);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/settings/credentials/:credentialId/toggle', () => {
    it('should toggle credential active status', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      // Create a credential (defaults to active)
      const createRes = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_secret'
      });

      const credentialId = createRes.body.credential.id;

      // Deactivate it
      const toggleRes = await authenticatedPatch(
        app,
        `/api/settings/credentials/${credentialId}/toggle`,
        token,
        { isActive: false }
      );

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.success).toBe(true);

      // Verify it's inactive
      const listRes = await authenticatedGet(app, '/api/settings/credentials', token);
      expect(listRes.body.credentials[0].is_active).toBe(0);

      // Reactivate it
      const reactivateRes = await authenticatedPatch(
        app,
        `/api/settings/credentials/${credentialId}/toggle`,
        token,
        { isActive: true }
      );

      expect(reactivateRes.status).toBe(200);

      // Verify it's active again
      const finalListRes = await authenticatedGet(app, '/api/settings/credentials', token);
      expect(finalListRes.body.credentials[0].is_active).toBe(1);
    });

    it('should return 400 if isActive is not boolean', async () => {
      const token = await getAuthToken(app);
      setKeychainAvailable(true);

      // Create a credential
      const createRes = await authenticatedPost(app, '/api/settings/credentials', token, {
        credentialName: 'My Token',
        credentialType: 'github_token',
        credentialValue: 'ghp_secret'
      });

      const credentialId = createRes.body.credential.id;

      const res = await authenticatedPatch(
        app,
        `/api/settings/credentials/${credentialId}/toggle`,
        token,
        { isActive: 'true' } // String instead of boolean
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('boolean');
    });

    it('should return 404 for non-existent credential', async () => {
      const token = await getAuthToken(app);

      const res = await authenticatedPatch(
        app,
        '/api/settings/credentials/99999/toggle',
        token,
        { isActive: false }
      );

      expect(res.status).toBe(404);
    });
  });
});
