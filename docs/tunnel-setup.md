# Chisel Reverse Tunnel Setup

Connect your local development backend to the shared EC2 instance at `agents.superlinear.com` via an encrypted reverse tunnel. Multiple developers can connect simultaneously, each on a different port.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [New Developer Onboarding](#new-developer-onboarding)
- [Daily Workflow](#daily-workflow)
- [Adding a New Backend (Port Assignment)](#adding-a-new-backend-port-assignment)
- [Adding a New Project/Repository](#adding-a-new-projectrepository)
- [Security Model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)

---

## Architecture Overview

### Request Flow

```
Browser (HTTPS)
    |
    v
ALB (agents.superlinear.com:443)
    |  TLS terminated here (ACM certificate, auto-renewing)
    |  HTTP 80 redirect -> HTTPS 443
    v
Nginx (EC2, port 80, HTTP only)
    |  Reads `backend` cookie -> selects port (9001, 9002, ...)
    |  Proxies /api/*, /ws, /shell to localhost:$backend_port
    v
Chisel tunnel (localhost:$backend_port on EC2)
    |  Encrypted reverse tunnel (mTLS + password auth)
    |  Runs over HTTPS on tunnel.agents.superlinear.com:8443
    v
Developer's local machine (localhost:3001)
    |  Express backend + WebSocket server
```

### How It Works

1. **TLS termination at ALB** -- The Application Load Balancer holds the ACM certificate for `agents.superlinear.com`. All browser traffic arrives as HTTPS and is forwarded to nginx as plain HTTP.

2. **Nginx backend routing** -- Nginx uses a `map` directive to read the `backend` cookie from the request and select the corresponding port. The mapping is defined in `/etc/nginx/conf.d/claudeui-backends.conf`:

   ```nginx
   map $cookie_backend $backend_port {
       default     9001;
       backend-01  9001;
       backend-02  9002;
       backend-03  9003;
   }
   ```

   Requests to `/api/*`, `/ws`, and `/shell` are proxied to `localhost:$backend_port`. Static assets (the React build) are served directly from `/var/www/claudeui/dist`.

3. **Chisel reverse tunnel** -- Each developer runs a chisel client that opens a reverse tunnel from their local backend (e.g., `localhost:3001`) to a port on the EC2 instance (e.g., `9001`). The tunnel connects to `tunnel.agents.superlinear.com:8443` using mTLS and password authentication.

4. **DNS layout** -- Two DNS records point to different targets:
   - `agents.superlinear.com` -> ALB (Route53 alias record) -- for browser traffic
   - `tunnel.agents.superlinear.com` -> EC2 Elastic IP (A record) -- for chisel clients

---

## New Developer Onboarding

### Prerequisites

- AWS CLI v2 configured with the `sl-admin` profile
- `devenv` / Nix shell (provides `chisel`, `openssl`, `jq`, and other tools)
- An assigned backend port (coordinate with the team -- see [Adding a New Backend](#adding-a-new-backend-port-assignment))

### Step 1: Get Your Port Assignment

Each developer uses a unique port. Check the current assignments in the [Reference](#reference) table and claim the next available one. You will need to update the nginx config on EC2 if your port is not already listed (see [Adding a New Backend](#adding-a-new-backend-port-assignment)).

### Step 2: Generate Client mTLS Certificates

Create the `.chisel/` directory and generate your client certificate signed by the shared CA.

```bash
mkdir -p .chisel

# Get the CA certificate (public, shared by all clients and the server)
aws secretsmanager get-secret-value --secret-id claudeui/mtls-ca-cert \
  --query SecretString --output text --region us-west-2 --profile sl-admin > .chisel/ca.crt

# Get the CA private key (temporarily -- needed to sign your client cert)
aws secretsmanager get-secret-value --secret-id claudeui-ca/mtls-ca-key \
  --query SecretString --output text --region us-west-2 --profile sl-admin > /tmp/ca.key

# Generate a new client key + CSR
openssl req -new -newkey rsa:2048 -nodes -keyout .chisel/client.key \
  -out /tmp/client.csr -subj "/CN=$(whoami)-client"

# Sign the client cert with the CA (valid for 365 days)
openssl x509 -req -in /tmp/client.csr -CA .chisel/ca.crt -CAkey /tmp/ca.key \
  -CAcreateserial -out .chisel/client.crt -days 365 -sha256

# Clean up sensitive temp files
rm -f /tmp/client.csr /tmp/ca.key /tmp/ca.srl
```

After this, your `.chisel/` directory should contain:

```
.chisel/
  ca.crt         # CA certificate (shared)
  client.crt     # Your client certificate
  client.key     # Your client private key
```

The `.chisel/` directory is gitignored. Never commit these files.

### Step 3: Configure `.env.dev`

Copy the example environment file and fill in tunnel-related values.

```bash
cp .env.dev.example .env.dev
```

Set these values in `.env.dev`:

| Variable | How to Get It | Example |
|----------|--------------|---------|
| `CHISEL_AUTH` | `aws secretsmanager get-secret-value --secret-id claudeui/chisel-auth --query SecretString --output text --region us-west-2 --profile sl-admin` | `user:abcdef123456...` |
| `TUNNEL_REMOTE_PORT` | Your assigned port | `9002` |
| `JWT_SECRET` | `openssl rand -base64 32` | (random 32+ char string) |

The other tunnel-related variables (`TUNNEL_HOST`, `TUNNEL_PORT`) have sensible defaults and should not need changes.

### Step 4: Verify the Connection

```bash
devenv up tunnel
```

A successful connection looks like:

```
Connecting tunnel: localhost:3001 -> tunnel.agents.superlinear.com port 9002
Endpoint: https://tunnel.agents.superlinear.com:8443
client: Connected (Latency 45ms)
```

If you see errors, check the [Troubleshooting](#troubleshooting) section.

---

## Daily Workflow

### Starting Everything

```bash
devenv up          # Starts server + client (Vite) + tunnel together
```

Or start components individually:

```bash
devenv up server   # Express backend only (port 3001)
devenv up client   # Vite dev server only (port 5173)
devenv up tunnel   # Chisel reverse tunnel only
```

### Accessing Your Backend via the Browser

1. Open `https://agents.superlinear.com` in your browser.
2. Set the `backend` cookie to your backend ID:

   ```javascript
   // In the browser console:
   document.cookie = "backend=backend-02;path=/"
   ```

3. Reload the page. All `/api/*` and WebSocket requests now route to your local backend through the tunnel.

### Switching Between Backends

To point the browser at a different developer's backend, change the cookie value:

```javascript
document.cookie = "backend=backend-01;path=/"   // Switch to backend-01
document.cookie = "backend=backend-03;path=/"   // Switch to backend-03
```

You can verify the current cookie in DevTools under Application > Cookies.

### Using the Standalone Connect Script

If you cannot use `devenv` (e.g., on a machine without Nix), the fallback script works with any chisel binary:

```bash
.chisel/connect.sh
```

It reads `CHISEL_AUTH` and tunnel settings from `.env.dev` (or environment variables) and expects certs in `.chisel/`.

---

## Adding a New Backend (Port Assignment)

When a new developer needs a tunnel port:

### 1. Choose the Next Available Port

Ports follow the pattern `9001`, `9002`, `9003`, etc. Check the [Reference](#reference) table for current assignments.

### 2. Update the Nginx Backend Map on EC2

The backend-to-port mapping lives in two places on the EC2 instance, both embedded in the UserData in `cloudformation/03-ec2.yaml`:

**a) The nginx map** (in the `NGINX_MAP` heredoc):

```nginx
map $cookie_backend $backend_port {
    default     9001;
    backend-01  9001;
    backend-02  9002;      # <-- add new entries here
    backend-03  9003;
}
```

**b) The backends.json registry** (in the `REGISTRY` heredoc):

```json
{
  "backends": [
    {"id": "backend-01", "port": 9001},
    {"id": "backend-02", "port": 9002}
  ]
}
```

### 3. Deploy the Change

**Option A: Redeploy the EC2 stack** (clean, declarative):

Increment `ForceInstanceRebuild` in the CloudFormation parameters to trigger a new instance with the updated UserData.

**Option B: Update the live instance** (faster, non-persistent across rebuilds):

```bash
# SSH into the instance
ssh -i claudeui-ec2-key.pem ec2-user@<ELASTIC_IP>

# Edit the backends registry
sudo vi /etc/claudeui/backends.json

# Regenerate the nginx map and reload
sudo /usr/local/bin/gen-nginx-backends.sh

# Or edit nginx directly
sudo vi /etc/nginx/conf.d/claudeui-backends.conf
sudo nginx -t && sudo nginx -s reload
```

If you use Option B, also update the UserData in `cloudformation/03-ec2.yaml` so the next instance rebuild picks up the change.

### 4. Developer Configures Their Port

The new developer sets `TUNNEL_REMOTE_PORT=<their port>` in their `.env.dev`.

---

## Adding a New Project/Repository

If a completely different project (not claudecodeui) wants to use this tunnel infrastructure:

### What the Project Needs

1. **Chisel client binary** -- either from the system package manager, `devenv` (Nix), or a direct download from [github.com/jpillora/chisel/releases](https://github.com/jpillora/chisel/releases).

2. **mTLS client certificates** in a `.chisel/` directory -- generated using the same CA (see [Step 2](#step-2-generate-client-mtls-certificates) above).

3. **The `CHISEL_AUTH` credential** -- retrieved from Secrets Manager (same as claudecodeui).

4. **An assigned port** -- added to the nginx config and `backends.json` on the EC2 instance.

5. **Nginx route configuration** -- if the project uses different URL paths (not `/api/*`, `/ws`, `/shell`), the nginx server block on EC2 needs additional `location` blocks.

### Minimal Connect Script Template

Projects can copy and adapt this standalone script:

```bash
#!/bin/bash
set -euo pipefail

# Adjust these for your project
CHISEL_AUTH="${CHISEL_AUTH:?Set CHISEL_AUTH environment variable}"
CERT_DIR="${CERT_DIR:-.chisel}"
TUNNEL_HOST="${TUNNEL_HOST:-tunnel.agents.superlinear.com}"
TUNNEL_PORT="${TUNNEL_PORT:-8443}"
REMOTE_PORT="${TUNNEL_REMOTE_PORT:-9004}"   # Your assigned port
LOCAL_PORT="${PORT:-3000}"                   # Your local backend port

echo "Tunnel: localhost:$LOCAL_PORT -> $TUNNEL_HOST:$REMOTE_PORT"

exec chisel client \
  --auth "$CHISEL_AUTH" \
  --tls-ca "$CERT_DIR/ca.crt" \
  --tls-cert "$CERT_DIR/client.crt" \
  --tls-key "$CERT_DIR/client.key" \
  "https://$TUNNEL_HOST:$TUNNEL_PORT" \
  "R:$REMOTE_PORT:localhost:$LOCAL_PORT"
```

---

## Security Model

### Layers of Protection

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Transport encryption | mTLS over HTTPS (port 8443) | Encrypts all tunnel traffic; authenticates both server and client |
| Authentication | `CHISEL_AUTH` (user:password) | Additional credential beyond mTLS |
| Browser TLS | ALB + ACM certificate | Encrypts browser-to-ALB traffic |
| Network isolation | EC2 security group | Port 80 only from ALB; port 8443 open (mTLS is the gate) |
| Secret separation | `claudeui/*` vs `claudeui-ca/*` prefix | EC2 instance role can only read `claudeui/*` secrets |

### mTLS Details

- The chisel server and all chisel clients present certificates signed by the **same CA**.
- The server verifies that connecting clients have a valid CA-signed certificate (`--tls-ca`).
- Clients verify the server's certificate against the same CA.
- This is **mutual** TLS -- both sides authenticate.

### CA Key Protection

The CA private key (`claudeui-ca/mtls-ca-key`) is stored in Secrets Manager under a **different prefix** than the EC2 instance's IAM policy allows:

- EC2 instance role grants: `secretsmanager:GetSecretValue` on `claudeui/*`
- CA key is stored under: `claudeui-ca/mtls-ca-key`

This means the EC2 instance **cannot read the CA private key**. Only human operators with the `sl-admin` profile can access it to sign new client certificates.

### Client Certificate Lifecycle

- Client certs are generated **locally** by each developer.
- They are signed using the CA key retrieved temporarily from Secrets Manager.
- The CA key is deleted from the local filesystem immediately after signing.
- Client certs are **never stored centrally** -- each developer is responsible for their own.
- The `.chisel/` directory is in `.gitignore`.
- Default validity: 365 days. Regenerate before expiry using the same process.

### Port 8443 Open to 0.0.0.0/0

The EC2 security group allows inbound traffic on port 8443 from any IP. This is intentional:

- mTLS provides strong access control (only clients with CA-signed certs can connect).
- Developers may connect from varying IPs (home, office, VPN, travel).
- IP-based restrictions would create operational friction without meaningful security gain given mTLS.

---

## Troubleshooting

### "connection refused" or "dial tcp ... connection refused"

The chisel server is not running on the EC2 instance.

```bash
# SSH into the instance and check
ssh -i claudeui-ec2-key.pem ec2-user@<ELASTIC_IP>
sudo systemctl status chisel-server
sudo journalctl -u chisel-server -n 50
```

Common causes: mTLS certs not provisioned in Secrets Manager, instance recently rebuilt.

### "tls: bad certificate" or "tls: certificate required"

Your client certificate is not signed by the correct CA, or the cert files are missing/corrupt.

```bash
# Verify your cert is signed by the correct CA
openssl verify -CAfile .chisel/ca.crt .chisel/client.crt

# Expected output: .chisel/client.crt: OK
# If it fails, regenerate your client cert (Step 2 in onboarding)
```

### "auth failed" or "unauthorized"

`CHISEL_AUTH` in your `.env.dev` does not match the server's credential.

```bash
# Re-retrieve the current value from Secrets Manager
aws secretsmanager get-secret-value --secret-id claudeui/chisel-auth \
  --query SecretString --output text --region us-west-2 --profile sl-admin
```

Update `.env.dev` with the new value and restart the tunnel.

### 502 Bad Gateway from nginx

The tunnel is connected, but your local backend is not running.

- Verify your local server is running: `curl http://localhost:3001/api/health`
- Check that `PORT` in `.env.dev` matches `TUNNEL_REMOTE_PORT`'s expected local port (default `3001`)
- Run `devenv up server` to start the backend

### Wrong Backend / Seeing Someone Else's Data

The `backend` cookie is pointing to a different developer's port.

1. Open DevTools > Application > Cookies
2. Find the `backend` cookie for `agents.superlinear.com`
3. Set it to your backend ID (e.g., `backend-02`)
4. Reload the page

```javascript
// Or set it via console:
document.cookie = "backend=backend-02;path=/"
```

### Tunnel Connects but Drops Frequently

- Check your local network stability.
- The chisel client uses `--keepalive 25s` by default in the systemd service. The devenv process does not set keepalive explicitly (chisel default is 25s).
- If behind a corporate firewall/proxy, the WebSocket upgrade on port 8443 may be blocked.

### Certificate Expired

Client certificates are valid for 365 days. If you see TLS errors after about a year, regenerate your cert:

```bash
# Check expiry
openssl x509 -in .chisel/client.crt -noout -enddate

# If expired, re-run the cert generation process (Step 2 in onboarding)
```

### Checking Tunnel Health on EC2

The instance runs a health check timer every 30 seconds that logs unreachable ports:

```bash
ssh -i claudeui-ec2-key.pem ec2-user@<ELASTIC_IP>

# View health log
sudo cat /var/log/chisel/health.log

# Check which ports are reachable right now
for port in 9001 9002 9003; do
  nc -z -w 2 localhost $port && echo "$port: UP" || echo "$port: DOWN"
done
```

---

## Reference

### Endpoints

| Endpoint | URL | Purpose |
|----------|-----|---------|
| Frontend | `https://agents.superlinear.com` | Browser-facing UI (served by nginx) |
| Tunnel server | `tunnel.agents.superlinear.com:8443` | Chisel server (mTLS + auth) |
| Health check | `https://agents.superlinear.com/health` | ALB health check (returns `ok`) |

### Port Assignments

| Backend ID | Port | Developer/Project |
|-----------|------|-------------------|
| backend-01 | 9001 | (default) |
| backend-02 | 9002 | (unassigned) |
| backend-03 | 9003 | (unassigned) |
| backend-04 | 9004 | (unassigned) |

Update this table when assigning new ports.

### Key Files

| File | Purpose |
|------|---------|
| `.env.dev` | Local environment config (CHISEL_AUTH, TUNNEL_REMOTE_PORT, etc.) |
| `.env.dev.example` | Template for `.env.dev` with documentation |
| `.chisel/ca.crt` | CA certificate (shared across all clients) |
| `.chisel/client.crt` | Your client certificate (per-developer) |
| `.chisel/client.key` | Your client private key (per-developer) |
| `.chisel/connect.sh` | Standalone tunnel script (fallback for non-devenv use) |
| `devenv.nix` | Devenv process definitions (server, client, tunnel) |
| `cloudformation/03-ec2.yaml` | EC2 instance with nginx + chisel server (UserData) |
| `deploy/ec2/nginx/claudeui-backends.conf` | Reference copy of the nginx backend map |
| `deploy/ec2/nginx/claudeui.conf` | Reference copy of the nginx server block |
| `scripts/deploy/gen-nginx-backends.sh` | Script to regenerate nginx map from backends.json |

### Secrets Manager Entries

| Secret ID | Access | Content |
|-----------|--------|---------|
| `claudeui/chisel-auth` | EC2 + developers | Chisel `user:password` credential |
| `claudeui/mtls-ca-cert` | EC2 + developers | CA certificate (PEM) |
| `claudeui/mtls-server-cert` | EC2 only | Server certificate (PEM) |
| `claudeui/mtls-server-key` | EC2 only | Server private key (PEM) |
| `claudeui-ca/mtls-ca-key` | **Developers only** (not EC2) | CA private key for signing client certs |

### DNS Records

| Record | Type | Target |
|--------|------|--------|
| `agents.superlinear.com` | A (alias) | ALB DNS name |
| `tunnel.agents.superlinear.com` | A | EC2 Elastic IP |
