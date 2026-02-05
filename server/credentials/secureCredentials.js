/**
 * SEC-011: Secure credentials service layer
 * Coordinates credential storage between SQLite (metadata) and system keychain (values)
 * Falls back to plaintext DB storage when keychain is unavailable
 */

import { credentialProvider } from './index.js';
import { db } from '../database/db.js';

const KEYCHAIN_PLACEHOLDER = '[KEYCHAIN]';

/**
 * Generate a unique keychain key for a credential
 * @param {number} userId - The user ID
 * @param {number} credentialId - The credential ID
 * @returns {string} The keychain key
 */
function keychainKey(userId, credentialId) {
  return `${userId}_${credentialId}`;
}

export const secureCredentialsService = {
  /**
   * Check if the keychain provider is available
   * @returns {Promise<boolean>}
   */
  async isKeychainAvailable() {
    try {
      return await credentialProvider.isAvailable?.() ?? false;
    } catch {
      return false;
    }
  },

  /**
   * Create a new credential with secure storage
   * SEC-004: Hard-fail when keychain unavailable - no plaintext fallback
   * @param {number} userId - The user ID
   * @param {string} name - The credential name
   * @param {string} type - The credential type (e.g., 'github_token')
   * @param {string} value - The credential value (will be stored in keychain)
   * @param {string|null} description - Optional description
   * @returns {Promise<{id: number, credentialName: string, credentialType: string, storageType: 'keychain'}>}
   * @throws {Error} If keychain is unavailable or write fails (no plaintext fallback)
   */
  async createCredential(userId, name, type, value, description = null) {
    const keychainAvailable = await this.isKeychainAvailable();

    // SEC-004: Hard-fail when keychain is not available - no plaintext storage allowed
    if (!keychainAvailable) {
      throw new Error(
        'Keychain not available. Cannot store credentials in plaintext. ' +
        'Please install keytar and ensure keychain access is configured. ' +
        'On macOS, ensure Keychain Access is available. ' +
        'On Linux, install libsecret. ' +
        'On Windows, ensure Credential Manager is accessible.'
      );
    }

    const storedValue = KEYCHAIN_PLACEHOLDER;

    const result = db.prepare(
      'INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, name, type, storedValue, description);

    const credentialId = result.lastInsertRowid;

    if (keychainAvailable) {
      try {
        await credentialProvider.set(keychainKey(userId, credentialId), value);
      } catch (error) {
        // FAIL FAST: Keychain was available but write failed - this is a real error, not a fallback scenario
        // Roll back the DB insert to maintain consistency
        db.prepare('DELETE FROM user_credentials WHERE id = ?').run(credentialId);
        throw new Error(`Keychain write failed for credential "${name}": ${error.message}. Credential was NOT stored.`);
      }
    }

    return {
      id: credentialId,
      credentialName: name,
      credentialType: type,
      storageType: keychainAvailable ? 'keychain' : 'database'
    };
  },

  /**
   * Get the actual credential value (from keychain or DB)
   * @param {number} userId - The user ID
   * @param {number} credentialId - The credential ID
   * @returns {Promise<string|null>} The credential value or null if not found
   */
  async getCredentialValue(userId, credentialId) {
    const row = db.prepare(
      'SELECT credential_value FROM user_credentials WHERE id = ? AND user_id = ? AND is_active = 1'
    ).get(credentialId, userId);

    if (!row) return null;

    if (row.credential_value === KEYCHAIN_PLACEHOLDER) {
      try {
        return await credentialProvider.get(keychainKey(userId, credentialId));
      } catch (error) {
        console.error(`[ERROR] Failed to retrieve credential from keychain:`, error.message);
        return null;
      }
    }

    return row.credential_value;
  },

  /**
   * Delete a credential from both keychain and database
   * @param {number} userId - The user ID
   * @param {number} credentialId - The credential ID
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async deleteCredential(userId, credentialId) {
    const row = db.prepare('SELECT credential_value FROM user_credentials WHERE id = ? AND user_id = ?')
      .get(credentialId, userId);

    if (!row) return false;

    // Delete from keychain if stored there
    if (row.credential_value === KEYCHAIN_PLACEHOLDER) {
      try {
        await credentialProvider.delete(keychainKey(userId, credentialId));
      } catch (error) {
        console.warn(`[WARN] Failed to delete credential from keychain:`, error.message);
        // Continue with DB deletion even if keychain deletion fails
      }
    }

    return db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?')
      .run(credentialId, userId).changes > 0;
  },

  /**
   * Get credential metadata (without the actual values) for a user
   * @param {number} userId - The user ID
   * @param {string|null} credentialType - Optional filter by type
   * @returns {Array<{id: number, credential_name: string, credential_type: string, description: string|null, created_at: string, is_active: number}>}
   */
  getCredentialsMetadata(userId, credentialType = null) {
    let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
    const params = [userId];

    if (credentialType) {
      query += ' AND credential_type = ?';
      params.push(credentialType);
    }

    return db.prepare(query + ' ORDER BY created_at DESC').all(...params);
  },

  /**
   * Toggle a credential's active status
   * @param {number} userId - The user ID
   * @param {number} credentialId - The credential ID
   * @param {boolean} isActive - New active status
   * @returns {boolean} True if updated successfully
   */
  toggleCredential(userId, credentialId, isActive) {
    return db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?')
      .run(isActive ? 1 : 0, credentialId, userId).changes > 0;
  },

  /**
   * Get the most recent active credential value for a user by type
   * @param {number} userId - The user ID
   * @param {string} credentialType - The credential type
   * @returns {Promise<string|null>} The credential value or null
   */
  async getActiveCredentialValue(userId, credentialType) {
    const row = db.prepare(
      'SELECT id, credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1'
    ).get(userId, credentialType);

    if (!row) return null;

    if (row.credential_value === KEYCHAIN_PLACEHOLDER) {
      try {
        return await credentialProvider.get(keychainKey(userId, row.id));
      } catch (error) {
        console.error(`[ERROR] Failed to retrieve active credential from keychain:`, error.message);
        return null;
      }
    }

    return row.credential_value;
  }
};

/**
 * Migrate existing plaintext credentials to keychain
 * Called during database initialization
 * @returns {Promise<{migrated: number, skipped: number}>}
 * @throws {Error} If keychain is available but migration fails (fail-fast)
 */
export async function migrateCredentialsToKeychain() {
  const keychainAvailable = await secureCredentialsService.isKeychainAvailable();

  if (!keychainAvailable) {
    const count = db.prepare(
      "SELECT COUNT(*) as count FROM user_credentials WHERE credential_value != ? AND credential_value IS NOT NULL"
    ).get(KEYCHAIN_PLACEHOLDER);

    if (count.count > 0) {
      console.warn(`[SECURITY WARNING] Keychain not available. ${count.count} credential(s) remain in plaintext database storage.`);
    }
    return { migrated: 0, skipped: count.count };
  }

  const credentials = db.prepare(
    "SELECT id, user_id, credential_value FROM user_credentials WHERE credential_value != ? AND credential_value IS NOT NULL"
  ).all(KEYCHAIN_PLACEHOLDER);

  if (credentials.length === 0) {
    console.log('[INFO] All credentials already in keychain');
    return { migrated: 0, skipped: 0 };
  }

  console.log(`[INFO] Migrating ${credentials.length} credential(s) from plaintext DB to keychain...`);

  let migrated = 0;

  for (const cred of credentials) {
    try {
      await credentialProvider.set(keychainKey(cred.user_id, cred.id), cred.credential_value);
      db.prepare("UPDATE user_credentials SET credential_value = ? WHERE id = ?").run(KEYCHAIN_PLACEHOLDER, cred.id);
      migrated++;
    } catch (error) {
      // FAIL FAST: Don't continue with partial migration
      throw new Error(
        `Credential migration failed at credential ${cred.id} (${migrated}/${credentials.length} completed): ${error.message}. ` +
        `Remaining credentials are still in plaintext. Fix keychain access and restart.`
      );
    }
  }

  console.log(`[INFO] Credential migration complete: ${migrated} credential(s) moved to keychain`);
  return { migrated, skipped: 0 };
}
