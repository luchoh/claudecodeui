/**
 * Test database helper
 * Creates and manages isolated test databases for each test run
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

let testDbPath: string;
let testDb: Database.Database;

/**
 * Creates a fresh test database with the schema initialized
 * @returns The database path for setting DATABASE_PATH env var
 */
export function createTestDb(): string {
  testDbPath = path.join(os.tmpdir(), `claudecodeui-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`);
  process.env.DATABASE_PATH = testDbPath;

  // Create database and initialize schema
  testDb = new Database(testDbPath);
  testDb.pragma('foreign_keys = ON');

  // Create tables (matching init.sql schema)
  testDb.exec(`
    -- Users table (single user system)
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1,
        git_name TEXT,
        git_email TEXT,
        has_completed_onboarding BOOLEAN DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

    -- API Keys table
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

    -- User credentials table
    CREATE TABLE IF NOT EXISTS user_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        credential_name TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        credential_value TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);

    -- Refresh tokens table (SEC-002)
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

    -- Auth tickets table (SEC-005)
    CREATE TABLE IF NOT EXISTS auth_tickets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        context TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        consumed INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_expires ON auth_tickets(expires_at);
  `);

  return testDbPath;
}

/**
 * Resets the database by clearing all tables
 */
export function resetDb(): void {
  if (!testDb) return;

  testDb.exec('DELETE FROM auth_tickets');
  testDb.exec('DELETE FROM refresh_tokens');
  testDb.exec('DELETE FROM user_credentials');
  testDb.exec('DELETE FROM api_keys');
  testDb.exec('DELETE FROM users');
}

/**
 * Closes and deletes the test database
 */
export function closeDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null as any;
  }

  if (testDbPath && fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
    } catch (e) {
      // Ignore deletion errors (file may be locked on Windows)
    }
  }
}

/**
 * Gets the raw database connection for direct queries in tests
 */
export function getTestDb(): Database.Database {
  return testDb;
}
