# PRD: CloudCLI Security Hardening

## Document Information

- **Project**: CloudCLI Security Hardening
- **Version**: 1.0
- **Date**: 2026-02-03
- **Author**: Security Audit Team
- **Status**: Ready for Implementation

---

## Executive Summary

CloudCLI (Claude Code UI) is a web-based interface for Claude Code, Cursor CLI, and Codex that enables remote access from mobile devices. A comprehensive security audit identified **2 critical**, **6 high**, **4 medium**, and **2 low** severity vulnerabilities that must be addressed before production deployment.

This PRD defines the security hardening work required to make CloudCLI safe for use over a VPN connection from iOS devices.

### Goals

1. Eliminate all critical and high severity vulnerabilities
2. Implement defense-in-depth security controls
3. Enable secure remote access via VPN + HTTPS
4. Maintain full functionality while hardening security
5. Zero third-party service dependencies

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

#### 1.2 Implement JWT Token Expiration

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

**Requirements:**
1. Add configurable token expiration (default: 7 days)
2. Support TOKEN_EXPIRY environment variable
3. Handle expired token errors gracefully in frontend
4. Add token refresh mechanism (optional stretch goal)

**Acceptance Criteria:**
- [ ] All new tokens include `exp` claim
- [ ] Default expiration is 7 days
- [ ] TOKEN_EXPIRY env var allows customization (e.g., "24h", "7d", "30d")
- [ ] Expired tokens return 401 with clear error message
- [ ] Frontend handles token expiration gracefully (redirect to login)

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

#### 2.3 Remove Token from URL Query Parameters

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

**Requirements:**
1. Remove token from URL query parameter support
2. Implement WebSocket authentication via Sec-WebSocket-Protocol header
3. Alternative: Use short-lived auth tickets exchanged for session
4. Update frontend to use new authentication method

**Acceptance Criteria:**
- [ ] No tokens passed in URL query strings
- [ ] WebSocket connections authenticated via headers or tickets
- [ ] Existing functionality preserved
- [ ] Frontend updated to new auth flow

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

**Requirements:**
1. Validate and sanitize projectPath before use
2. Use parameterized command execution where possible
3. Implement allowlist for permitted project directories
4. Escape shell metacharacters properly
5. Add path traversal protection

**Acceptance Criteria:**
- [ ] projectPath validated against WORKSPACES_ROOT
- [ ] Shell metacharacters in paths are rejected or escaped
- [ ] Path traversal attempts (../) are blocked
- [ ] Only allowed commands can be executed
- [ ] Audit log for shell command execution

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

#### 3.3 Encrypt Stored Credentials

**ID**: SEC-011
**Severity**: MEDIUM
**Location**: `server/database/db.js`
**CWE**: CWE-312 (Cleartext Storage of Sensitive Information)

**Requirements:**
1. Encrypt GitHub tokens and other credentials at rest
2. Use user's password-derived key or separate encryption key
3. Migrate existing plaintext credentials
4. Handle decryption failures gracefully

**Acceptance Criteria:**
- [ ] All credentials encrypted in SQLite database
- [ ] Encryption key derived from secure source
- [ ] Migration script for existing data
- [ ] Credential retrieval still functions correctly

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

### Phase 4: Low Priority Fixes (P3)

Nice to have for defense in depth.

#### 4.1 Add Security Headers

**ID**: SEC-013
**Severity**: LOW
**Location**: Server-wide

**Requirements:**
1. Add Content-Security-Policy header
2. Add X-Content-Type-Options: nosniff
3. Add X-Frame-Options: DENY
4. Add Referrer-Policy: strict-origin-when-cross-origin

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

## Technical Specifications

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| JWT_SECRET | Yes | - | Secret for signing JWTs (min 32 chars) |
| TOKEN_EXPIRY | No | 7d | JWT token expiration time |
| ALLOWED_ORIGINS | No | localhost | Comma-separated CORS origins |
| BIND_HOST | No | 127.0.0.1 | Server bind address |
| ENABLE_SYSTEM_UPDATE | No | false | Enable /api/system/update |
| RATE_LIMIT_MAX | No | 100 | Requests per window |
| RATE_LIMIT_WINDOW | No | 60000 | Rate limit window (ms) |
| PTY_TIMEOUT | No | 300000 | PTY session timeout (ms) |
| NODE_ENV | No | development | production disables debug features |

### File Changes Summary

| File | Changes |
|------|---------|
| `server/middleware/auth.js` | SEC-001, SEC-002, SEC-005 |
| `server/index.js` | SEC-003, SEC-004, SEC-005, SEC-006, SEC-008, SEC-012 |
| `server/middleware/security.js` | NEW: SEC-009, SEC-010, SEC-013 |
| `server/middleware/audit.js` | NEW: SEC-014 |
| `server/database/db.js` | SEC-011 |
| `.env.example` | Update with all security variables |
| `README.md` | Security deployment guide |
| `SECURITY.md` | NEW: Security documentation |

---

## Implementation Plan

### Sprint 1: Critical Fixes (Day 1)
- [ ] SEC-001: Remove hardcoded JWT secret
- [ ] SEC-002: Implement token expiration
- [ ] Testing and verification

### Sprint 2: High Priority (Days 2-3)
- [ ] SEC-003: Restrict CORS
- [ ] SEC-004: Localhost binding
- [ ] SEC-005: Remove token from URL
- [ ] SEC-006: Secure shell commands
- [ ] SEC-007: HTTPS documentation
- [ ] SEC-008: Secure update endpoint

### Sprint 3: Medium Priority (Day 4)
- [ ] SEC-009: Rate limiting
- [ ] SEC-010: Error sanitization
- [ ] SEC-011: Credential encryption
- [ ] SEC-012: PTY timeout

### Sprint 4: Polish (Day 5)
- [ ] SEC-013: Security headers
- [ ] SEC-014: Audit logging
- [ ] Documentation updates
- [ ] Final security review

---

## Testing Requirements

### Security Tests

1. **Authentication Tests**
   - Verify server fails to start without JWT_SECRET
   - Verify expired tokens are rejected
   - Verify forged tokens are rejected

2. **CORS Tests**
   - Verify cross-origin requests from non-whitelisted origins are blocked
   - Verify same-origin requests work
   - Verify requests without origin work

3. **Input Validation Tests**
   - Verify path traversal attempts are blocked
   - Verify shell metacharacters are handled safely
   - Verify malformed input returns appropriate errors

4. **Rate Limiting Tests**
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
[ ] Test token expiration
[ ] Verify CORS blocks external origins
[ ] Test all Claude Code functionality
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

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

---

## Appendix C: References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
