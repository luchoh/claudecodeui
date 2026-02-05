/**
 * Authentication helper functions for tests
 */

import type { Express } from 'express';
import request from 'supertest';

/**
 * Register a new user via the API
 */
export async function registerUser(
  app: Express,
  username = 'testuser',
  password = 'testpass123'
) {
  return request(app)
    .post('/api/auth/register')
    .send({ username, password });
}

/**
 * Login a user via the API
 */
export async function loginUser(
  app: Express,
  username = 'testuser',
  password = 'testpass123'
) {
  return request(app)
    .post('/api/auth/login')
    .send({ username, password });
}

/**
 * Get an auth token by registering and logging in a test user
 * Returns both accessToken and refreshToken
 */
export async function getAuthTokens(app: Express) {
  // First, try to register
  const registerRes = await registerUser(app);

  if (registerRes.status === 200) {
    return {
      accessToken: registerRes.body.accessToken,
      refreshToken: registerRes.body.refreshToken
    };
  }

  // If user already exists, log in
  const loginRes = await loginUser(app);
  if (loginRes.status === 200) {
    return {
      accessToken: loginRes.body.accessToken,
      refreshToken: loginRes.body.refreshToken
    };
  }

  throw new Error(`Failed to get auth tokens: ${loginRes.body.error || 'unknown error'}`);
}

/**
 * Get just the access token (shorthand)
 */
export async function getAuthToken(app: Express): Promise<string> {
  const tokens = await getAuthTokens(app);
  return tokens.accessToken;
}

/**
 * Make an authenticated GET request
 */
export async function authenticatedGet(app: Express, path: string, token: string) {
  return request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Make an authenticated POST request
 */
export async function authenticatedPost(
  app: Express,
  path: string,
  token: string,
  body?: object
) {
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body || {});
}

/**
 * Make an authenticated DELETE request
 */
export async function authenticatedDelete(app: Express, path: string, token: string) {
  return request(app)
    .delete(path)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Make an authenticated PATCH request
 */
export async function authenticatedPatch(
  app: Express,
  path: string,
  token: string,
  body?: object
) {
  return request(app)
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body || {});
}

/**
 * Generate an expired JWT token for testing
 */
export function generateExpiredToken(): string {
  // This is a JWT that expired in the past (hardcoded for testing)
  // Header: {"alg":"HS256","typ":"JWT"}
  // Payload: {"userId":1,"username":"testuser","type":"access","iat":1000000000,"exp":1000000001}
  // Signed with 'test-secret-minimum-32-characters-long'
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxMDAwMDAwMDAwLCJleHAiOjEwMDAwMDAwMDF9.DLwYZCqt_cF3IHqDg8F0JmCQF_DJvPV_iKZ2xP3EgU8';
}
