# PRD: CloudCLI Security Hardening (v4)

## Document Information

- **Project**: CloudCLI Security Hardening
- **Version**: 4.0
- **Date**: 2026-02-04
- **Author**: Security Audit Team
- **Status**: Ready for Implementation
- **Changes from v3**:
  - Detailed audit of all `spawn` calls (SEC-006).
  - Identified sensitive data in SSE endpoints (SEC-016).
  - Clarified multi-root workspace validation implementation.
  - Refined ticket-based auth scope to include all streaming endpoints.

---

## Executive Summary

CloudCLI (Claude Code UI) is a web-based interface for Claude Code, Cursor CLI, and Codex that enables remote access from mobile devices. A comprehensive security audit identified **2 critical**, **6 high**, **6 medium**, and **0 low** severity vulnerabilities.

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
| Critical | 2 | Must fix before any use |
| High | 6 | Must fix before production |
| Medium | 6 | Recommended |
| Low | 0 | Nice to have |

### Threat Model

**Deployment Context:**
- Single-user deployment on Mac Studio.
- Access via VPN from iOS devices.
- **Platform Mode**: `VITE_IS_PLATFORM=true` bypasses JWT auth. This MUST be false for self-hosted/VPN use.
- **Sensitive Data**: Source code, API keys (Anthropic, OpenAI, GitHub), Shell access.

**Assets to Protect:**
- **Shell Access**: Full control over the host machine via `spawn` and PTY.
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
1. Remove the hardcoded fallback secret.
2. Server MUST fail to start if `JWT_SECRET` is not set.
3. Enforce minimum length of 32 characters.

#### 1.2 Implement Token Expiration with Refresh Tokens

**ID**: SEC-002
**Severity**: CRITICAL
**Location**: `server/middleware/auth.js:70-78`
**CWE**: CWE-613 (Insufficient Session Expiration)

**Current State:**
Tokens are signed without an expiration time.

**Requirements:**
1. **Access Token**: 15-minute expiry.
2. **Refresh Token**: 7-day expiry, stored in SQLite (`refresh_tokens` table), hashed.
3. **Rotation**: Refresh token rotation on use.
4. **Revocation**: Logout deletes the refresh token.

---

### Phase 2: High Priority Fixes (P1)

#### 2.1 Restrict CORS Policy

**ID**: SEC-003
**Severity**: HIGH
**Location**: `server/index.js:223`
**CWE**: CWE-942

**Current State:**
`app.use(cors())` allows all origins.

**Requirements:**
1. `ALLOWED_ORIGINS` env var (comma-separated).
2. Default to `localhost:3001` and `localhost:5173`.
3. Block all other origins (unless empty/null for non-browser clients).

#### 2.2 Bind to Localhost by Default

**ID**: SEC-004
**Severity**: HIGH
**Location**: `server/index.js:1806`
**CWE**: CWE-668

**Current State:**
`server.listen(PORT, '0.0.0.0', ...)`

**Requirements:**
1. Default bind to `127.0.0.1`.
2. Allow override via `BIND_HOST` env var (e.g., for Docker).
3. Log a warning if binding to `0.0.0.0`.

#### 2.3 Ticket-Based Authentication for WebSocket & SSE

**ID**: SEC-005
**Severity**: HIGH
**Location**: `server/index.js` (WebSocket), `server/routes/projects.js` (SSE)
**CWE**: CWE-598 (Sensitive Information in URL Query String)

**Current State:**
- WebSocket: `ws://...?token=JWT`
- SSE (`/clone-progress`): `GET ...?githubTokenId=...&newGithubToken=...`

**Requirements:**
1. Create `POST /api/auth/ticket` endpoint (protected by JWT).
2. Returns a short-lived (30s), single-use ticket string.
3. **WebSocket**: Connect via `ws://...?ticket=TICKET`.
4. **SSE**: Connect via `GET ...?ticket=TICKET`.
   - The ticket payload MUST store any context needed (e.g., "this ticket authorizes cloning repo X with token Y").
   - **Crucially**, remove `githubTokenId` and `newGithubToken` from the SSE URL. Pass them to the ticket creation endpoint instead.

#### 2.4 Audit and Secure All Command Execution

**ID**: SEC-006
**Severity**: HIGH
**Location**: Multiple files
**CWE**: CWE-78 (OS Command Injection)

**Audit Findings:**
1. `server/index.js`: `spawn('sh', ['-c', updateCommand])` -> **UNSAFE** (See SEC-008).
2. `server/routes/taskmaster.js`: `spawn('which', ..., { shell: true })` -> **RISKY**.
3. `server/routes/projects.js`: `spawn('git', ...)` -> **SAFE** (parameterized), but needs workspace validation.
4. `server/routes/mcp.js`, `codex.js`, `cli-auth.js`: Use `spawn` with array args -> **SAFE**, but check input validation.

**Requirements:**
1. **Multi-Root Workspaces**: Update `server/routes/projects.js` to support `WORKSPACES_ROOT` as a comma-separated list.
2. **Validation**: `validateWorkspacePath` must check if the path is within *any* of the allowed roots.
3. **Sanitization**: Ensure NO user input is passed to `shell: true` instances. Replace `shell: true` with direct execution where possible (e.g., use `which` binary directly or `command -v` if needed, but avoid full shell if possible).

#### 2.5 Secure System Update Endpoint

**ID**: SEC-008
**Severity**: HIGH
**Location**: `server/index.js:311`
**CWE**: CWE-96

**Current State:**
Arbitrary shell execution via `git checkout ... && npm install`.

**Requirements:**
1. Disable by default. Enable only if `ENABLE_SYSTEM_UPDATE=true`.
2. Hardcode the command (no user input allowed).
3. Log all attempts.

#### 2.6 Secure GitHub Tokens in SSE (Merged into SEC-005)

**ID**: SEC-016 (New)
**Severity**: HIGH
**Location**: `server/routes/projects.js` (clone-progress)

**Problem:**
The `clone-progress` endpoint receives GitHub tokens in the URL query string.

**Resolution:**
Handled via **SEC-005 (Ticket-Based Auth)**. The sensitive data is sent in the `POST /ticket` body, stored server-side associated with the ticket, and the SSE connection only uses the ticket ID.

---

### Phase 3: Medium Priority Fixes (P2)

#### 3.1 Rate Limiting (SEC-009)
- `express-rate-limit` on all routes. Stricter on `/api/auth`.

#### 3.2 Error Sanitization (SEC-010)
- Middleware to strip stack traces and internal paths in production `NODE_ENV`.

#### 3.3 Credential Storage (SEC-011)
- Migrate from plaintext SQLite to `keytar` (System Keychain) on macOS.
- Abstraction layer for `CredentialProvider`.

#### 3.4 PTY Timeout (SEC-012)
- Reduce default PTY timeout from 30m to 5m.

#### 3.5 Security Headers & CSP (SEC-013)
- `helmet` with strict CSP.

#### 3.6 WebSocket Zod Validation (SEC-015)
- Validate all incoming WS messages against Zod schemas.

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
| VITE_IS_PLATFORM | No | false | Enables platform mode (bypasses JWT auth) |

### File Changes Summary

| File | Changes |
|------|---------|
| `server/middleware/auth.js` | SEC-001, SEC-002 |
| `server/index.js` | SEC-003, SEC-004, SEC-005, SEC-006, SEC-008, SEC-012 |
| `server/routes/auth.js` | SEC-005 (ticket endpoint) |
| `server/routes/projects.js` | SEC-005 (SSE tickets), SEC-006 (multi-root workspace validation) |
| `server/routes/taskmaster.js` | SEC-006 (remove `shell: true` where possible) |
| `server/routes/agent.js` | SEC-006 (command execution audit) |
| `server/routes/mcp.js` | SEC-006 (command execution audit) |
| `server/routes/codex.js` | SEC-006 (command execution audit) |
| `server/routes/cli-auth.js` | SEC-006 (command execution audit) |
| `server/middleware/security.js` | SEC-009, SEC-010, SEC-013 |
| `server/middleware/ws-validation.js` | SEC-015 |
| `server/credentials/index.js` | SEC-011 provider abstraction |
| `server/credentials/keychain.js` | SEC-011 Keychain provider |
| `server/credentials/aws.js` | SEC-011 AWS provider (stub) |
| `server/credentials/vault.js` | SEC-011 Vault provider (stub) |
| `.env.example` | Update with all security variables |
| `README.md` | Security deployment guide |
| `SECURITY.md` | Security documentation |

---

## Implementation Plan

### Sprint 1: Critical & Auth (Day 1-2)
- [ ] SEC-001 (JWT Secret) & SEC-002 (Refresh Tokens).
- [ ] SEC-005 (Ticket Auth for WS and SSE). **Critical for fixing SEC-016**.

### Sprint 2: Network & System (Day 3-4)
- [ ] SEC-003 (CORS) & SEC-004 (Binding).
- [ ] SEC-006 (Command Execution & Multi-Root Workspace).
- [ ] SEC-008 (Update Endpoint).

### Sprint 3: Hardening (Day 5)
- [ ] SEC-009 (Rate Limit), SEC-010 (Errors), SEC-013 (CSP).
- [ ] SEC-011 (Keychain), SEC-012 (PTY Timeout).

---

## Verification

- **Automated**: Test suite must verify token expiration, refresh flow, and rejection of invalid tickets.
- **Manual**: Verify VPN access blocked for non-localhost bind (before VPN config). Verify no sensitive data in browser history/network tab for SSE/WS connections.

---

## Appendix A: Secure Deployment Checklist

```
Pre-Deployment:
[ ] Generate secure JWT_SECRET: openssl rand -base64 32
[ ] Configure all required environment variables
[ ] Set NODE_ENV=production
[ ] Ensure VITE_IS_PLATFORM is not enabled for self-hosted/VPN use
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
[ ] Verify WS/SSE use tickets only (no sensitive query parameters)
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

## Appendix C: v4 Decision Summary

| Item | v3 Decision | v4 Update | Rationale |
|------|-------------|-----------|-----------|
| SEC-005 | Ticket-based WebSocket auth | Extend ticket-based auth to SSE; remove GitHub tokens from query params | Eliminates sensitive data in URLs |
| SEC-006 | Allowlist + parameterized execution | Audit all `spawn` calls; remove `shell: true` where possible | Reduce command injection risk |
| SEC-016 | N/A | Merged into SEC-005 | Keep sensitive data handling in one flow |
| WORKSPACES_ROOT | Single root assumed | Multi-root comma-separated validation | Matches deployment needs |

---

## Appendix D: References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [JWT Security Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
- [Zod Documentation](https://zod.dev/)
