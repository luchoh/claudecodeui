# PRD: CloudCLI Security Hardening (v2)

## Document Information

- **Project**: CloudCLI Security Hardening
- **Version**: 2.0
- **Date**: 2026-02-03
- **Author**: Security Audit Team
- **Status**: Ready for Implementation
- **Changes from v1**: Refined implementation decisions based on architecture review

---

## Executive Summary

CloudCLI (Claude Code UI) is a web-based interface for Claude Code, Cursor CLI, and Codex that enables remote access from mobile devices. A comprehensive security audit identified **2 critical**, **6 high**, **4 medium**, and **2 low** severity vulnerabilities that must be addressed before production deployment.

This PRD defines the security hardening work required to make CloudCLI safe for use over a VPN connection from iOS devices.

### Goals

1. Eliminate all critical and high severity vulnerabilities
2. Implement defense-in-depth security controls
3. Enable secure remote access via VPN + HTTPS
4. Maintain full functionality while hardening security
5. Zero third-party service dependencies (except optional credential providers)

### Non-Goals

1. Adding new features beyond security fixes
2. Redesigning the UI/UX
3. Supporting multi-user/multi-tenant deployments
4. Cloud hosting or SaaS deployment

---

## Background

### Security Audit Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 2 | Must fix before any use |
| High | 6 | Must fix before production |
| Medium | 4 | Recommended |
| Low | 2 | Nice to have |

### Threat Model

**Deployment Context:**
- Single-user deployment on Mac Studio
- Access via VPN from iOS devices
- Potential future AWS deployment
- No public internet exposure
- Sensitive data: source code, API keys, shell access

**Threat Actors:**
- Network attackers on compromised VPN
- Malicious websites attempting CSRF
- Token theft via log exposure
- Insider threats (unlikely but considered)

**Assets to Protect:**
- Shell access to development machine
- Source code and project files
- API credentials (GitHub, Anthropic, OpenAI)
- Session tokens and authentication

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

**Problem:**
Anyone who knows this default secret (it's in the public GitHub repo) can forge valid authentication tokens and gain full system access.

**Requirements:**
1. Remove the hardcoded fallback secret entirely
2. Require JWT_SECRET to be set via environment variable
3. Enforce minimum secret length of 32 characters
4. Fail fast with clear error message if not configured
5. Add startup validation before server listens

**Acceptance Criteria:**
- [ ] Server refuses to start without JWT_SECRET env var
- [ ] Server refuses to start if JWT_SECRET < 32 characters
- [ ] Clear error message indicates how to generate a secure secret
- [ ] No hardcoded secrets remain in codebase
- [ ] Existing tests updated to provide test secret

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

**Problem:**
Tokens never expire. If a token is compromised (via logs, browser history, XSS), the attacker has permanent access.

**v2 Decision: Implement refresh token pattern**

**Requirements:**
1. Access tokens expire in 15 minutes
2. Refresh tokens expire in 7 days, stored server-side
3. `POST /api/auth/refresh` endpoint to exchange refresh token for new access token
4. Logout invalidates refresh token in database
5. Support REFRESH_TOKEN_EXPIRY and ACCESS_TOKEN_EXPIRY env vars

**Implementation:**
```javascript
// Login response
{
  accessToken: "eyJ...",      // 15 minute expiry
  refreshToken: "eyJ...",     // 7 day expiry, also stored in DB
  expiresIn: 900              // seconds
}

// Refresh endpoint
POST /api/auth/refresh
Body: { refreshToken: "eyJ..." }
Response: { accessToken: "eyJ...", expiresIn: 900 }

// Logout - invalidates refresh token
POST /api/auth/logout
// Deletes refresh token from DB
```

**Database Schema Addition:**
```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,      -- SHA-256 hash, not plaintext
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Acceptance Criteria:**
- [ ] Access tokens include `exp` claim set to 15 minutes
- [ ] Refresh tokens stored in database (hashed)
- [ ] `/api/auth/refresh` returns new access token
- [ ] `/api/auth/logout` deletes refresh token from DB
- [ ] Expired refresh tokens are rejected
- [ ] Frontend handles token refresh automatically
- [ ] Frontend redirects to login when refresh fails

---

### Phase 2: High Priority Fixes (P1)

These MUST be completed before production/regular use.

#### 2.1 Restrict CORS Policy

**ID**: SEC-003
**Severity**: HIGH
**Location**: `server/index.js:223`
**CWE**: CWE-942 (Overly Permissive Cross-domain Whitelist)

**Current State:**
```javascript
app.use(cors());
```

**Problem:**
Allows requests from any origin, enabling CSRF attacks from malicious websites.

**Requirements:**
1. Implement origin whitelist via ALLOWED_ORIGINS env var
2. Default to localhost only if not configured
3. Support comma-separated list of origins
4. Allow requests with no origin (for mobile apps, curl)
5. Log rejected CORS requests for debugging

**Acceptance Criteria:**
- [ ] CORS rejects requests from non-whitelisted origins
- [ ] ALLOWED_ORIGINS env var controls allowed origins
- [ ] Default allows only localhost:3001 and localhost:5173 (dev)
- [ ] Requests without origin header are allowed (curl, mobile)
- [ ] CORS errors return appropriate error response

---

#### 2.2 Bind to Localhost by Default

**ID**: SEC-004
**Severity**: HIGH
**Location**: `server/index.js:1806`
**CWE**: CWE-668 (Exposure of Resource to Wrong Sphere)

**Current State:**
```javascript
server.listen(PORT, '0.0.0.0', async () => {
```

**Problem:**
Server listens on all network interfaces, exposing it to the entire network even without VPN.

**Requirements:**
1. Default bind address: 127.0.0.1 (localhost only)
2. Support BIND_HOST environment variable for override
3. Log warning if binding to 0.0.0.0
4. Update documentation with secure deployment guide

**Acceptance Criteria:**
- [ ] Server binds to 127.0.0.1 by default
- [ ] BIND_HOST env var allows override (e.g., for Docker)
- [ ] Warning logged when binding to non-localhost address
- [ ] README updated with reverse proxy instructions

---

#### 2.3 Remove Token from URL - Implement Ticket-Based WebSocket Auth

**ID**: SEC-005
**Severity**: HIGH
**Location**: `server/index.js:203`, `server/middleware/auth.js:44-46`
**CWE**: CWE-598 (Use of GET Request Method With Sensitive Query Strings)

**Current State:**
```javascript
const token = url.searchParams.get('token') ||
    info.req.headers.authorization?.split(' ')[1];
```

**Problem:**
Tokens in URLs are logged by servers, proxies, and browsers, and leak via Referer headers.

**v2 Decision: Implement ticket-based authentication**

**Requirements:**
1. New endpoint `POST /api/ws-ticket` returns single-use ticket
2. Ticket valid for 30 seconds, stored in memory/DB
3. WebSocket connects with ticket: `ws://host/terminal?ticket=abc123`
4. Server validates ticket, deletes it, establishes session
5. Remove support for token in URL query parameter

**Implementation:**
```javascript
// Step 1: Client requests ticket
POST /api/ws-ticket
Headers: { Authorization: "Bearer <access_token>" }
Response: { ticket: "abc123def456", expiresIn: 30 }

// Server stores ticket
tickets.set("abc123def456", {
  userId: 123,
  createdAt: Date.now(),
  expiresAt: Date.now() + 30000
});

// Step 2: Client connects WebSocket
ws://host/terminal?ticket=abc123def456

// Step 3: Server validates and consumes ticket
const ticketData = tickets.get(ticket);
if (!ticketData || ticketData.expiresAt < Date.now()) {
  ws.close(4001, 'Invalid or expired ticket');
  return;
}
tickets.delete(ticket);  // Single-use
// Proceed with authenticated connection
```

**Acceptance Criteria:**
- [ ] `POST /api/ws-ticket` endpoint implemented
- [ ] Tickets are single-use (deleted after validation)
- [ ] Tickets expire after 30 seconds
- [ ] Token-in-URL no longer supported
- [ ] Frontend updated to use ticket flow
- [ ] Existing WebSocket functionality preserved

---

#### 2.4 Secure Shell Command Construction

**ID**: SEC-006
**Severity**: HIGH
**Location**: `server/index.js:1054-1091`
**CWE**: CWE-78 (OS Command Injection)

**Current State:**
```javascript
shellCommand = `cd "${projectPath}" && ${initialCommand}`;
```

**Problem:**
If projectPath contains shell metacharacters (e.g., `"; rm -rf /;"`), arbitrary commands can be executed.

**v2 Decision: Allowlist + parameterized execution**

**Requirements:**
1. Implement WORKSPACES_ROOT env var defining allowed parent directories
2. Validate projectPath is under an allowed root (resolve symlinks)
3. Use `spawn()` with `cwd` option instead of `cd` in shell
4. Pass command arguments as arrays, never interpolate into shell strings
5. Reject paths containing `..` after normalization

**Implementation:**
```javascript
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT?.split(',') || [
  path.join(os.homedir(), 'Dev'),
  path.join(os.homedir(), 'Projects')
];

function isAllowedPath(requestedPath) {
  const resolved = path.resolve(requestedPath);
  return WORKSPACES_ROOT.some(root =>
    resolved.startsWith(path.resolve(root) + path.sep)
  );
}

// Usage
if (!isAllowedPath(projectPath)) {
  throw new SecurityError('Path not in allowed workspace');
}

// Parameterized execution - no shell interpolation
spawn('claude', [], {
  cwd: projectPath,  // Safe: OS handles path
  env: { ...process.env }
});
```

**Acceptance Criteria:**
- [ ] WORKSPACES_ROOT env var configurable
- [ ] Paths outside allowed roots rejected with clear error
- [ ] Path traversal attempts (`../`) blocked
- [ ] All shell commands use parameterized execution
- [ ] No string interpolation for paths or commands
- [ ] Audit log for rejected path attempts

---

#### 2.5 Add HTTPS Support

**ID**: SEC-007
**Severity**: HIGH
**Location**: Server-wide
**CWE**: CWE-319 (Cleartext Transmission of Sensitive Information)

**Current State:**
HTTP only, no TLS support.

**Problem:**
All traffic including tokens and code is transmitted in cleartext.

**Requirements:**
1. Document reverse proxy setup with Caddy/nginx
2. Optional: Add built-in HTTPS support with self-signed certs
3. Add HTTPS redirect middleware when behind proxy
4. Support X-Forwarded-Proto header detection

**Acceptance Criteria:**
- [ ] Documentation includes Caddy reverse proxy configuration
- [ ] Server detects when behind HTTPS proxy
- [ ] Secure cookies set when HTTPS detected
- [ ] Optional: Built-in TLS with configurable certs

---

#### 2.6 Secure System Update Endpoint

**ID**: SEC-008
**Severity**: HIGH
**Location**: `server/index.js:311-373`
**CWE**: CWE-94 (Code Injection)

**Current State:**
```javascript
const updateCommand = 'git checkout main && git pull && npm install';
const child = spawn('sh', ['-c', updateCommand], {
```

**Problem:**
Endpoint allows arbitrary git/npm execution, potential for supply chain attacks.

**Requirements:**
1. Disable endpoint by default in production
2. Require explicit ENABLE_SYSTEM_UPDATE=true to enable
3. Add confirmation step or admin PIN
4. Log all update attempts

**Acceptance Criteria:**
- [ ] Endpoint disabled unless ENABLE_SYSTEM_UPDATE=true
- [ ] Returns 403 Forbidden when disabled
- [ ] All update attempts logged with user info
- [ ] Documentation warns about security implications

---

### Phase 3: Medium Priority Fixes (P2)

Recommended for production hardening.

#### 3.1 Implement Rate Limiting

**ID**: SEC-009
**Severity**: MEDIUM
**Location**: Server-wide
**CWE**: CWE-770 (Allocation of Resources Without Limits)

**Requirements:**
1. Add express-rate-limit middleware
2. Configure limits: 100 requests/minute for API, 10 for auth
3. Support RATE_LIMIT_WINDOW and RATE_LIMIT_MAX env vars
4. Exempt WebSocket connections from rate limiting

**Acceptance Criteria:**
- [ ] Rate limiting active on all HTTP endpoints
- [ ] Auth endpoints have stricter limits (10/min)
- [ ] Rate limit headers returned (X-RateLimit-*)
- [ ] Configurable via environment variables

---

#### 3.2 Sanitize Error Messages

**ID**: SEC-010
**Severity**: MEDIUM
**Location**: Various error handlers
**CWE**: CWE-209 (Information Exposure Through Error Messages)

**Requirements:**
1. Create error sanitization middleware
2. Hide stack traces in production
3. Hide internal paths in error messages
4. Log full errors server-side, return generic messages to client

**Acceptance Criteria:**
- [ ] No stack traces in production responses
- [ ] No internal file paths exposed
- [ ] Error IDs for correlation with server logs
- [ ] Debug mode available for development

---

#### 3.3 Encrypted Credential Storage with Provider Abstraction

**ID**: SEC-011
**Severity**: MEDIUM
**Location**: `server/database/db.js`
**CWE**: CWE-312 (Cleartext Storage of Sensitive Information)

**v2 Decision: macOS Keychain with abstraction for future providers**

**Requirements:**
1. Create `CredentialProvider` interface
2. Implement `KeychainProvider` using macOS Keychain (`keytar`)
3. Design for future providers: AWS Secrets Manager, HashiCorp Vault
4. Configure provider via CREDENTIAL_PROVIDER env var
5. Migrate existing plaintext credentials

**Implementation:**
```javascript
// Abstract interface
class CredentialProvider {
  async get(service, key) { throw new Error('Not implemented'); }
  async set(service, key, value) { throw new Error('Not implemented'); }
  async delete(service, key) { throw new Error('Not implemented'); }
  async list(service) { throw new Error('Not implemented'); }
}

// macOS Keychain implementation
class KeychainProvider extends CredentialProvider {
  constructor() {
    super();
    this.keytar = require('keytar');
  }

  async get(service, key) {
    return this.keytar.getPassword(service, key);
  }

  async set(service, key, value) {
    return this.keytar.setPassword(service, key, value);
  }

  async delete(service, key) {
    return this.keytar.deletePassword(service, key);
  }
}

// Future implementations (stubs)
class AWSSecretsManagerProvider extends CredentialProvider { }
class VaultProvider extends CredentialProvider { }

// Factory
function createCredentialProvider() {
  const provider = process.env.CREDENTIAL_PROVIDER || 'keychain';
  switch (provider) {
    case 'keychain': return new KeychainProvider();
    case 'aws': return new AWSSecretsManagerProvider();
    case 'vault': return new VaultProvider();
    default: throw new Error(`Unknown credential provider: ${provider}`);
  }
}
```

**Acceptance Criteria:**
- [ ] CredentialProvider interface defined
- [ ] KeychainProvider implemented and tested
- [ ] Credentials no longer stored in SQLite
- [ ] CREDENTIAL_PROVIDER env var selects provider
- [ ] Migration script moves existing credentials to Keychain
- [ ] Graceful fallback/error if Keychain unavailable

---

#### 3.4 Reduce PTY Session Timeout

**ID**: SEC-012
**Severity**: MEDIUM
**Location**: `server/index.js:1252-1258`

**Requirements:**
1. Reduce default timeout from 30 minutes to 5 minutes
2. Support PTY_TIMEOUT environment variable
3. Clean up PTY resources on timeout
4. Notify user before session timeout

**Acceptance Criteria:**
- [ ] Default timeout is 5 minutes
- [ ] PTY_TIMEOUT env var allows customization
- [ ] Resources properly cleaned up
- [ ] Optional: Warning message before timeout

---

### Phase 4: Additional Security Controls (P3)

New items identified during v2 review.

#### 4.1 Add Security Headers including CSP

**ID**: SEC-013
**Severity**: LOW → MEDIUM (upgraded)
**Location**: Server-wide

**v2 Decision: Implement strict Content-Security-Policy**

**Requirements:**
1. Add Content-Security-Policy header with strict policy
2. Add X-Content-Type-Options: nosniff
3. Add X-Frame-Options: DENY
4. Add Referrer-Policy: strict-origin-when-cross-origin

**CSP Policy:**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' ws: wss:;
  img-src 'self' data: blob:;
  font-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

**Implementation:**
```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
```

**Acceptance Criteria:**
- [ ] CSP header present on all responses
- [ ] XSS attempts blocked by CSP
- [ ] No CSP violations in normal operation
- [ ] All other security headers present

---

#### 4.2 Implement Audit Logging

**ID**: SEC-014
**Severity**: LOW
**Location**: Server-wide

**Requirements:**
1. Log authentication events (login, logout, failures)
2. Log sensitive operations (file access, shell commands)
3. Include timestamp, user, IP, action, result
4. Support log rotation and retention policy

---

#### 4.3 WebSocket Message Validation

**ID**: SEC-015 (NEW)
**Severity**: MEDIUM
**Location**: WebSocket message handlers

**v2 Decision: Implement Zod schema validation**

**Requirements:**
1. Define Zod schemas for all WebSocket message types
2. Validate all incoming messages before processing
3. Reject invalid messages with error response
4. Add message size limits

**Implementation:**
```javascript
const { z } = require('zod');

// Define message schemas
const TerminalInputMessage = z.object({
  type: z.literal('input'),
  data: z.string().max(65536),
  sessionId: z.string().uuid()
});

const TerminalResizeMessage = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(500)
});

const ClaudeCommandMessage = z.object({
  type: z.literal('command'),
  command: z.string().max(1048576),  // 1MB max
  sessionId: z.string().uuid()
});

// Union of all valid message types
const WebSocketMessage = z.discriminatedUnion('type', [
  TerminalInputMessage,
  TerminalResizeMessage,
  ClaudeCommandMessage,
  // ... other message types
]);

// Validation middleware
function validateWSMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { success: false, error: 'Invalid JSON' };
  }

  const result = WebSocketMessage.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: 'Schema validation failed',
      details: result.error.issues
    };
  }

  return { success: true, data: result.data };
}

// Usage
ws.on('message', (raw) => {
  const validation = validateWSMessage(raw);
  if (!validation.success) {
    ws.send(JSON.stringify({
      type: 'error',
      message: validation.error
    }));
    return;
  }

  handleMessage(validation.data);
});
```

**Acceptance Criteria:**
- [ ] All WebSocket message types have Zod schemas
- [ ] Invalid messages rejected with error response
- [ ] Message size limits enforced
- [ ] No unvalidated messages processed
- [ ] Schema types exported for frontend use

---

## Technical Specifications

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| JWT_SECRET | Yes | - | Secret for signing JWTs (min 32 chars) |
| ACCESS_TOKEN_EXPIRY | No | 15m | Access token expiration time |
| REFRESH_TOKEN_EXPIRY | No | 7d | Refresh token expiration time |
| ALLOWED_ORIGINS | No | localhost | Comma-separated CORS origins |
| BIND_HOST | No | 127.0.0.1 | Server bind address |
| WORKSPACES_ROOT | No | ~/Dev,~/Projects | Comma-separated allowed workspace roots |
| CREDENTIAL_PROVIDER | No | keychain | Credential storage provider (keychain/aws/vault) |
| ENABLE_SYSTEM_UPDATE | No | false | Enable /api/system/update |
| RATE_LIMIT_MAX | No | 100 | Requests per window |
| RATE_LIMIT_WINDOW | No | 60000 | Rate limit window (ms) |
| PTY_TIMEOUT | No | 300000 | PTY session timeout (ms) |
| NODE_ENV | No | development | production disables debug features |

### File Changes Summary

| File | Changes |
|------|---------|
| `server/middleware/auth.js` | SEC-001, SEC-002 |
| `server/index.js` | SEC-003, SEC-004, SEC-006, SEC-008, SEC-012 |
| `server/routes/ws-ticket.js` | NEW: SEC-005 |
| `server/middleware/security.js` | NEW: SEC-009, SEC-010, SEC-013 |
| `server/middleware/audit.js` | NEW: SEC-014 |
| `server/middleware/ws-validation.js` | NEW: SEC-015 |
| `server/credentials/index.js` | NEW: SEC-011 provider abstraction |
| `server/credentials/keychain.js` | NEW: SEC-011 Keychain provider |
| `server/credentials/aws.js` | NEW: SEC-011 AWS provider (stub) |
| `server/credentials/vault.js` | NEW: SEC-011 Vault provider (stub) |
| `.env.example` | Update with all security variables |
| `README.md` | Security deployment guide |
| `SECURITY.md` | NEW: Security documentation |

---

## Implementation Plan

### Sprint 1: Critical Fixes (Day 1)
- [ ] SEC-001: Remove hardcoded JWT secret
- [ ] SEC-002: Implement access + refresh tokens
- [ ] Testing and verification

### Sprint 2: High Priority (Days 2-3)
- [ ] SEC-003: Restrict CORS
- [ ] SEC-004: Localhost binding
- [ ] SEC-005: Ticket-based WebSocket auth
- [ ] SEC-006: Allowlist + parameterized execution
- [ ] SEC-007: HTTPS documentation
- [ ] SEC-008: Secure update endpoint

### Sprint 3: Medium Priority (Day 4)
- [ ] SEC-009: Rate limiting
- [ ] SEC-010: Error sanitization
- [ ] SEC-011: Credential provider abstraction + Keychain
- [ ] SEC-012: PTY timeout

### Sprint 4: Polish (Day 5)
- [ ] SEC-013: Security headers + CSP
- [ ] SEC-014: Audit logging
- [ ] SEC-015: WebSocket message validation with Zod
- [ ] Documentation updates
- [ ] Final security review

---

## Testing Requirements

### Security Tests

1. **Authentication Tests**
   - Verify server fails to start without JWT_SECRET
   - Verify access tokens expire in 15 minutes
   - Verify refresh tokens can obtain new access tokens
   - Verify logout invalidates refresh token
   - Verify forged tokens are rejected

2. **WebSocket Auth Tests**
   - Verify ticket endpoint requires valid access token
   - Verify tickets are single-use
   - Verify tickets expire after 30 seconds
   - Verify invalid tickets rejected

3. **CORS Tests**
   - Verify cross-origin requests from non-whitelisted origins are blocked
   - Verify same-origin requests work
   - Verify requests without origin work

4. **Input Validation Tests**
   - Verify paths outside WORKSPACES_ROOT are rejected
   - Verify path traversal attempts (../) are blocked
   - Verify WebSocket messages validated against schemas
   - Verify oversized messages rejected

5. **Rate Limiting Tests**
   - Verify rate limits are enforced
   - Verify rate limit headers are returned
   - Verify WebSocket connections are not rate limited

### Regression Tests

1. All existing functionality must continue to work
2. Mobile PWA access must function correctly
3. Claude Code, Cursor, and Codex integrations must work
4. File operations must work within project boundaries

---

## Success Metrics

1. **Zero Critical/High vulnerabilities** in post-hardening audit
2. **All tests passing** including new security tests
3. **Documentation complete** for secure deployment
4. **No functionality regression** from security changes

---

## Appendix A: Secure Deployment Checklist

```
Pre-Deployment:
[ ] Generate secure JWT_SECRET: openssl rand -base64 32
[ ] Configure all required environment variables
[ ] Set NODE_ENV=production
[ ] Verify server binds to localhost only
[ ] Set WORKSPACES_ROOT to allowed directories
[ ] Verify CREDENTIAL_PROVIDER configured (keychain for macOS)

Reverse Proxy (Caddy):
[ ] Install Caddy on Mac Studio
[ ] Configure TLS certificates
[ ] Proxy to localhost:3001
[ ] Bind to VPN interface only

VPN:
[ ] Verify VPN connection required for access
[ ] Test from iOS device over VPN
[ ] Verify HTTPS certificate warnings handled

Post-Deployment:
[ ] Verify authentication works
[ ] Test access token expiration (15 min)
[ ] Test refresh token flow
[ ] Verify CORS blocks external origins
[ ] Test all Claude Code functionality
[ ] Verify CSP doesn't break functionality
```

---

## Appendix B: Caddyfile Example

```caddyfile
{
    # Only listen on VPN interface
    # Replace with your VPN interface IP
}

https://mac-studio.vpn {
    tls internal  # Self-signed cert, or use ACME

    reverse_proxy localhost:3001 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }

    # Security headers (supplement server-side headers)
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

---

## Appendix C: v2 Decision Summary

| Item | v1 Proposal | v2 Decision | Rationale |
|------|-------------|-------------|-----------|
| SEC-002 | 7-day token expiry | 15m access + 7d refresh tokens | Enables token revocation on logout |
| SEC-005 | Sec-WebSocket-Protocol header | Ticket-based auth | Cleaner, more standard approach |
| SEC-006 | Shell escaping | Allowlist + parameterized execution | Eliminates injection class entirely |
| SEC-011 | Password-derived encryption | Keychain with provider abstraction | Supports macOS + future AWS/Vault |
| NEW | - | CSP headers | Prevents XSS payload execution |
| NEW | - | WebSocket Zod validation | Runtime type safety for all messages |

---

## Appendix D: References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
- [Zod Documentation](https://zod.dev/)
