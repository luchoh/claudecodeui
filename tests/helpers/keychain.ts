/**
 * Mock keychain helper for testing SEC-011 credential storage
 * Re-exports mock control functions from setup.ts
 */

export {
  setKeychainAvailable,
  setKeychainShouldFail,
  resetKeychainMock
} from '../setup.js';

/**
 * Mock keychain object with controllable behavior
 * Uses the mock functions from setup.ts
 */
export const mockKeychain = {
  get available() {
    // This is managed by setKeychainAvailable()
    return true;
  },
  set available(value: boolean) {
    const { setKeychainAvailable } = require('../setup.js');
    setKeychainAvailable(value);
  },
  get shouldFail() {
    return false;
  },
  set shouldFail(value: boolean) {
    const { setKeychainShouldFail } = require('../setup.js');
    setKeychainShouldFail(value);
  },
  reset() {
    const { resetKeychainMock } = require('../setup.js');
    resetKeychainMock();
  }
};

// For backwards compatibility
export function setupKeytarMock(): void {
  // Mock is set up in setup.ts
}

export function resetKeytarMock(): void {
  const { resetKeychainMock } = require('../setup.js');
  resetKeychainMock();
}
