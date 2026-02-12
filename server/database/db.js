import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(`Failed to create database directory ${dbDir}:`, error.message);
    throw error;
  }
}

// Create database connection
const db = new Database(DB_PATH);

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0');
    }

    // SEC-002: Create refresh_tokens table for token refresh functionality
    const refreshTokensTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='refresh_tokens'").all();
    if (refreshTokensTable.length === 0) {
      console.log('Running migration: Creating refresh_tokens table');
      db.exec(`
        CREATE TABLE refresh_tokens (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
        CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      `);
    }

    // SEC-005: Create auth_tickets table for WebSocket/SSE ticket-based auth
    const ticketsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_tickets'").all();
    if (ticketsTable.length === 0) {
      console.log('Running migration: Creating auth_tickets table');
      db.exec(`
        CREATE TABLE auth_tickets (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          purpose TEXT NOT NULL,
          context TEXT,
          expires_at INTEGER NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          consumed INTEGER DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_tickets_expires ON auth_tickets(expires_at);
      `);
    }

    // Add api_key_prefix column and hash existing plaintext API keys
    const apiKeysTableInfo = db.prepare("PRAGMA table_info(api_keys)").all();
    const apiKeysColumns = apiKeysTableInfo.map(col => col.name);
    if (!apiKeysColumns.includes('api_key_prefix')) {
      console.log('Running migration: Adding api_key_prefix column to api_keys');
      db.exec('ALTER TABLE api_keys ADD COLUMN api_key_prefix TEXT');
      // Backfill existing keys: store first 7 chars as prefix, then hash the key
      const existingKeys = db.prepare('SELECT id, api_key FROM api_keys WHERE api_key_prefix IS NULL').all();
      for (const key of existingKeys) {
        const prefix = key.api_key.substring(0, 7);
        const hash = crypto.createHash('sha256').update(key.api_key).digest('hex');
        db.prepare('UPDATE api_keys SET api_key_prefix = ?, api_key = ? WHERE id = ?').run(prefix, hash, key.id);
      }
    }

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Cleanup expired tickets and tokens periodically (every 60 seconds)
const dbCleanupInterval = setInterval(() => {
  try {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('DELETE FROM auth_tickets WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
  } catch (error) {
    // Silently ignore cleanup errors (table might not exist yet during startup)
  }
}, 60000);

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
    runMigrations();

    // SEC-011: Migrate existing credentials to keychain (async, non-blocking)
    migrateCredentialsToKeychainAsync();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

/**
 * SEC-011: Async migration of plaintext credentials to keychain
 * Runs after database initialization without blocking startup
 */
async function migrateCredentialsToKeychainAsync() {
  try {
    const { migrateCredentialsToKeychain } = await import('../credentials/secureCredentials.js');
    await migrateCredentialsToKeychain();
  } catch (error) {
    console.warn('[WARN] Credential migration failed:', error.message);
    // Non-fatal - credentials will still work from DB fallback
  }
}

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1').get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  }
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key (stores hash, returns plaintext once)
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const keyPrefix = apiKey.substring(0, 7); // e.g., "ck_abc1"
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key, api_key_prefix) VALUES (?, ?, ?, ?)');
      const result = stmt.run(userId, keyName, keyHash, keyPrefix);
      return { id: result.lastInsertRowid, keyName, apiKey, keyPrefix };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user (returns prefix, not full key or hash)
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key_prefix, api_key_prefix as api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user (compares hashes)
  validateApiKey: (apiKey) => {
    try {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(keyHash);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// SEC-002: Refresh tokens database operations
const refreshTokensDb = {
  // Create a new refresh token
  create: (id, userId, tokenHash, expiresAt) => {
    try {
      const stmt = db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)');
      stmt.run(id, userId, tokenHash, expiresAt);
      return id;
    } catch (err) {
      throw err;
    }
  },

  // Validate and consume a refresh token (returns userId or null)
  validateAndConsume: (tokenId, tokenHash) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const token = db.prepare(
        'SELECT * FROM refresh_tokens WHERE id = ? AND token_hash = ? AND expires_at > ?'
      ).get(tokenId, tokenHash, now);

      if (!token) return null;

      // Delete the used token (single-use)
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenId);

      return token.user_id;
    } catch (err) {
      throw err;
    }
  },

  // Delete all refresh tokens for a user (used on logout)
  deleteAllForUser: (userId) => {
    try {
      db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  },

  // Delete a specific refresh token
  delete: (tokenId) => {
    try {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenId);
    } catch (err) {
      throw err;
    }
  }
};

// SEC-005: Auth tickets database operations
const ticketsDb = {
  // Create a new auth ticket
  create: (id, userId, purpose, context, expiresAt) => {
    try {
      const stmt = db.prepare('INSERT INTO auth_tickets (id, user_id, purpose, context, expires_at) VALUES (?, ?, ?, ?, ?)');
      stmt.run(id, userId, purpose, JSON.stringify(context || {}), expiresAt);
      return id;
    } catch (err) {
      throw err;
    }
  },

  // Validate and consume a single-use ticket
  validateAndConsume: (ticketId, expectedPurpose) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const ticket = db.prepare(
        'SELECT * FROM auth_tickets WHERE id = ? AND purpose = ? AND expires_at > ? AND consumed = 0'
      ).get(ticketId, expectedPurpose, now);

      if (!ticket) return null;

      // Mark as consumed (single-use)
      db.prepare('UPDATE auth_tickets SET consumed = 1 WHERE id = ?').run(ticketId);

      return {
        userId: ticket.user_id,
        purpose: ticket.purpose,
        context: JSON.parse(ticket.context || '{}')
      };
    } catch (err) {
      throw err;
    }
  },

  // Delete expired tickets (called by cleanup interval)
  deleteExpired: () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      db.prepare('DELETE FROM auth_tickets WHERE expires_at < ?').run(now);
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

// Graceful shutdown: stop cleanup interval and close database connection
function closeDatabase() {
  if (dbCleanupInterval) {
    clearInterval(dbCleanupInterval);
  }
  try {
    db.close();
    console.log('[SHUTDOWN] Database closed');
  } catch (e) {
    // Ignore close errors during shutdown
  }
}

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  githubTokensDb, // Backward compatibility
  refreshTokensDb,
  ticketsDb,
  closeDatabase
};