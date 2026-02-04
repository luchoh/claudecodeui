/**
 * SEC-011: macOS Keychain credential provider using keytar
 * Provides secure credential storage via the system keychain
 */

const SERVICE_NAME = 'cloudcli';

// Lazy load keytar to handle cases where it's not installed
let keytar = null;
let keytarError = null;

async function getKeytar() {
  if (keytarError) throw keytarError;
  if (keytar) return keytar;

  try {
    const keytarModule = await import('keytar');
    // Handle ES module default export
    keytar = keytarModule.default || keytarModule;
    return keytar;
  } catch (error) {
    keytarError = new Error(
      'keytar module not available. Install with: npm install keytar\n' +
      'Note: keytar requires native compilation and may need additional system dependencies.'
    );
    throw keytarError;
  }
}

export class KeychainProvider {
  constructor(serviceName = SERVICE_NAME) {
    this.serviceName = serviceName;
  }

  /**
   * Get a credential from the keychain
   * @param {string} key - The credential key/account name
   * @returns {Promise<string|null>} The credential value or null if not found
   */
  async get(key) {
    try {
      const kt = await getKeytar();
      const value = await kt.getPassword(this.serviceName, key);
      return value;
    } catch (error) {
      console.error(`[WARN] Failed to get credential '${key}' from keychain:`, error.message);
      return null;
    }
  }

  /**
   * Store a credential in the keychain
   * @param {string} key - The credential key/account name
   * @param {string} value - The credential value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    const kt = await getKeytar();
    await kt.setPassword(this.serviceName, key, value);
  }

  /**
   * Delete a credential from the keychain
   * @param {string} key - The credential key/account name
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async delete(key) {
    try {
      const kt = await getKeytar();
      const deleted = await kt.deletePassword(this.serviceName, key);
      return deleted;
    } catch (error) {
      console.error(`[WARN] Failed to delete credential '${key}' from keychain:`, error.message);
      return false;
    }
  }

  /**
   * List all credentials for this service
   * @returns {Promise<Array<{account: string, password: string}>>}
   */
  async list() {
    try {
      const kt = await getKeytar();
      const credentials = await kt.findCredentials(this.serviceName);
      return credentials;
    } catch (error) {
      console.error('[WARN] Failed to list keychain credentials:', error.message);
      return [];
    }
  }

  /**
   * Check if keytar is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await getKeytar();
      return true;
    } catch {
      return false;
    }
  }
}
