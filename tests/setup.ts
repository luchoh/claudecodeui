/**
 * Global test setup for Vitest
 * Configures environment variables and mocks before test execution
 */

import { vi, beforeEach } from 'vitest';

// Environment variables for tests - must be set BEFORE importing any server modules
process.env.JWT_SECRET = 'test-secret-minimum-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.VITE_IS_PLATFORM = 'false';
process.env.RATE_LIMIT_WINDOW = '60000';
process.env.RATE_LIMIT_AUTH_MAX = '10';
process.env.RATE_LIMIT_MAX = '100';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY_DAYS = '7';

// Keychain mock state (exported so tests can access it)
export const keychainMockState = {
  store: new Map<string, string>(),
  available: true,
  shouldFail: false
};

// Export functions to control mock behavior
export function setKeychainAvailable(available: boolean) {
  keychainMockState.available = available;
}

export function setKeychainShouldFail(shouldFail: boolean) {
  keychainMockState.shouldFail = shouldFail;
}

export function resetKeychainMock() {
  keychainMockState.store.clear();
  keychainMockState.available = true;
  keychainMockState.shouldFail = false;
}

// Mock keytar module - references the exported state object
// Using an object reference ensures the mock sees state changes
vi.mock('keytar', async () => {
  // Import the state from setup - this creates a reference to the live state
  const { keychainMockState } = await vi.importActual<typeof import('./setup.js')>('./setup.js');

  return {
    default: {
      getPassword: async (service: string, account: string) => {
        if (!keychainMockState.available) {
          throw new Error('Keychain not available');
        }
        return keychainMockState.store.get(`${service}:${account}`) || null;
      },
      setPassword: async (service: string, account: string, password: string) => {
        if (!keychainMockState.available) {
          throw new Error('Keychain not available');
        }
        if (keychainMockState.shouldFail) {
          throw new Error('Keychain write failed');
        }
        keychainMockState.store.set(`${service}:${account}`, password);
      },
      deletePassword: async (service: string, account: string) => {
        if (!keychainMockState.available) {
          throw new Error('Keychain not available');
        }
        return keychainMockState.store.delete(`${service}:${account}`);
      },
      findCredentials: async () => []
    }
  };
});

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

// Reset keychain mock before each test
beforeEach(() => {
  resetKeychainMock();
});
