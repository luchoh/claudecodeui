# PRD: Claude Code UI — AWS EC2 Deployment with Chisel Tunnel + mTLS

**Status:** FINAL DRAFT
**Date:** 2026-02-15
**Author:** Team Lead
**Expert Reviews:** Network, Security, Critic (incorporated)
**AWS Account:** sl-admin
**Region:** us-west-2

---

## 0. Decision Log

| Decision | Options Considered | Chosen | Rationale |
|---|---|---|---|
| Compute | Fargate vs **EC2** | EC2 | ~$11/month vs ~$70-85. Single instance. Local EBS eliminates EFS/SQLite-on-NFS issues. IaC via CloudFormation. |
| Tunnel | WireGuard, Headscale, SSH, **Chisel** | Chisel | Zero routing impact on backend (application-level WebSocket). Backend has multiple VPNs — can't touch routing. |
| Authentication | mTLS, OAuth, API keys | mTLS + auth credential | Defense in depth. No third-party dependency. Chisel supports natively. |
| Architecture | Option A (proxy mode) vs **Option B (reverse proxy)** | Option B first | Option A requires rewriting 60% of backend. Prove tunnel viability first. |
| TLS (user-facing) | ALB + ACM vs Nginx + Let's Encrypt | **ALB + ACM** | ACM auto-renews (eliminates certbot failure risk). Nginx simplifies to HTTP-only. Standard AWS pattern. ~$16-22/mo addition. |

---

## 1. Problem Statement

Claude Code UI runs as a monolith behind a VPN. The Express server spawns CLI tools (claude, cursor, codex) locally. We need the frontend publicly accessible on AWS while backends stay behind NAT. Backend machines have multiple existing VPNs — adding new network interfaces or routes is not viable.

## 2. Architecture

```
                          ┌──────────────────────────────────────┐
                          │  ALB (TLS termination via ACM)       │
Users ──HTTPS (443)──────►│  agents.superlinear.com              │
                          └──────────────────┬───────────────────┘
                                             │ HTTP (80)
                          ┌──────────────────▼───────────────────┐
                          │  EC2 Instance (t4g.small)            │
                          │  us-west-2, Elastic IP               │
                          │                                      │
                          │  Nginx:                              │
                          │  ├─ Reverse proxy → backends         │
                          │  └─ Static files (React build)       │
                          │                                      │
Backends ──WSS (8443)────►│  Chisel server:                      │
 (outbound from backend)  │  ├─ mTLS (private CA)                │
                          │  ├─ AUTH credential                  │
                          │  └─ Reverse tunnels from backends    │
                          │                                      │
                          │  Local EBS:                          │
                          │  └─ Static files + config only       │
                          └──────────────────────────────────────┘
                                        │
              chisel reverse tunnels    │  (outbound WSS from backends)
              (mTLS + auth)             │  (zero routing impact on backend)
                                        │
          ┌─────────────┬─────────────┬─────────────┬─────────────┐
          │             │             │             │             │
 ┌────────▼──────┐ ┌───▼───────┐ ┌──▼────────┐ ┌──▼────────┐   ...
 │Backend 01     │ │Backend 02 │ │Backend 03 │ │Backend 04 │  (4+ backends)
 │(behind NAT)   │ │(behind NAT│ │(behind NAT│ │(behind NAT│
 │               │ │           │ │           │ │           │
 │chisel client  │ │chisel     │ │chisel     │ │chisel     │
 │(outbound WSS) │ │client     │ │client     │ │client     │
 │               │ │           │ │           │
 │Express monolith│ │Express   │ │Express   │ │Express   │
 │Claude/Cursor/  │ │monolith  │ │monolith  │ │monolith  │
 │Codex           │ │          │ │          │ │          │
 │R:9001:local:3001│R:9002:...│ │R:9003:...│ │R:9004:...│
 └────────────────┘└──────────┘ └──────────┘ └──────────┘
```

**How it works:**
1. Users hit `https://agents.superlinear.com` → ALB (TLS via ACM) → Nginx on EC2 (HTTP)
2. User selects a **project** in the UI → frontend sets a `backend` cookie (e.g., `backend-02`)
3. Nginx maps cookie → port (`backend-02` → `localhost:9002`)
4. `localhost:900X` is a chisel reverse tunnel to that backend's port 3001
5. Backend runs the full unmodified monolith — project files are local to that machine
6. Backends connect outbound via WSS to `wss://tunnel.agents.superlinear.com:8443` — to the backend OS, this is just another HTTPS request. No interfaces, no routes, invisible to existing VPNs.

## 3. What This Eliminates (vs Fargate PRD)

| Component | Fargate PRD | This PRD |
|---|---|---|
| ALB | $22/month | **ALB for TLS + ACM** (~$16-22/mo). Nginx runs HTTP-only behind ALB. |
| NLB | $22/month | **Not needed** (chisel listens on EC2 directly) |
| EFS | $3/month + SQLite-on-NFS risk | **Not needed** (local EBS, SQLite works perfectly) |
| ECR | Container registry | **Not needed** (deploy via git pull or rsync) |
| Sidecar containers | Complex task definition | **Not needed** (systemd services) |
| WAL mode concerns | CRITICAL — broken on NFS | **Non-issue** (local disk, WAL works fine) |
| Dual-task corruption | CRITICAL during deploys | **Non-issue** (single process, local disk) |

## 4. Infrastructure

### 4.1 VPC — Dedicated

Per network review: do NOT reuse quantum VPCs.

| Resource | Value |
|---|---|
| VPC CIDR | `10.2.0.0/16` |
| Public Subnet A | `10.2.1.0/24` (us-west-2a) |
| Public Subnet B | `10.2.2.0/24` (us-west-2b) |
| Internet Gateway | Standard |

### 4.2 EC2 Instance

| Setting | Value |
|---|---|
| Instance Type | `t4g.small` (2 vCPU, 2 GB RAM, ARM64) |
| AMI | Amazon Linux 2023 (ARM64) |
| EBS | 20 GB gp3 |
| Elastic IP | Yes (stable public IP) |
| Key Pair | Existing or new |
| Subnet | Public Subnet A |

**Note:** ALB handles TLS termination (ACM certificate). EC2 receives plain HTTP on port 80 from the ALB only — no public HTTP/HTTPS exposure on the instance.

**Why t4g.small:** The app is a reverse proxy (Nginx) + chisel server. Minimal CPU/RAM. `t4g.micro` (1 GB RAM) would work for testing; `t4g.small` gives headroom for chisel tunnels + nginx.

### 4.3 Security Group

```yaml
# ALB Security Group (public-facing)
ALBSecurityGroupIngress:
  - IpProtocol: tcp
    FromPort: 80
    ToPort: 80
    CidrIp: 0.0.0.0/0
  - IpProtocol: tcp
    FromPort: 443
    ToPort: 443
    CidrIp: 0.0.0.0/0

# EC2 Security Group
SecurityGroupIngress:
  # HTTP from ALB only (TLS terminated at ALB)
  - IpProtocol: tcp
    FromPort: 80
    ToPort: 80
    SourceSecurityGroupId: !Ref ALBSecurityGroup
  # Chisel tunnel (mTLS is the access gate)
  - IpProtocol: tcp
    FromPort: 8443
    ToPort: 8443
    CidrIp: 0.0.0.0/0
  # SSH (admin access — restrict to your IP)
  - IpProtocol: tcp
    FromPort: 22
    ToPort: 22
    CidrIp: <YOUR_IP>/32
SecurityGroupEgress:
  - IpProtocol: -1
    CidrIp: 0.0.0.0/0
```

### 4.4 Route53

| Record | Type | Target |
|---|---|---|
| `agents.superlinear.com` | A (alias) | ALB DNS name |
| `tunnel.agents.superlinear.com` | A | Elastic IP |

### 4.5 Secrets Manager

Per security review: use Secrets Manager for all credentials.

| Secret | Path | Access |
|---|---|---|
| JWT_SECRET | `claudeui/jwt-secret` | EC2 instance role |
| CSRF_SECRET | `claudeui/csrf-secret` | EC2 instance role |
| Chisel AUTH credential | `claudeui/chisel-auth` | EC2 instance role |
| CA private key | `claudeui-ca/mtls-ca-key` | **Human operator only** (separate IAM policy, NOT accessible by EC2) |

**Important:** The CA key is stored under `claudeui-ca/*`, not `claudeui/*`. The EC2 instance role only has access to `claudeui/*`. This prevents the instance from extracting the CA key and minting rogue client certificates.

CA cert, server cert+key, and client certs are **files on the EC2 instance** at `/etc/chisel/certs/`, deployed manually by an operator (not via user-data).

## 5. Software Stack on EC2

All managed via systemd:

```
┌──────────────────────────────────┐
│  systemd services                │
│                                  │
│  nginx.service                   │  ← Reverse proxy, static files (HTTP-only behind ALB)
│  chisel-server.service           │  ← mTLS tunnel server
│  claudeui-aggregator.timer       │  ← Polls backends, writes project list (60s)
│                                  │
│  /var/www/claudeui/dist/         │  ← React build + backends-projects.json
│  /etc/chisel/certs/              │  ← mTLS certificates
│  /etc/claudeui/backends.json     │  ← Backend registry (port → machine mapping)
└──────────────────────────────────┘
```

### 5.1 Nginx Configuration

TLS is terminated at the ALB (ACM certificate). Nginx runs HTTP-only on port 80.

```nginx
# /etc/nginx/conf.d/claudeui.conf
# IMPORTANT: /etc/nginx/conf.d/claudeui-backends.conf must also exist
# (contains the map $cookie_backend → $backend_port, see Section 7.2).
# Both files are auto-loaded by nginx's default include of conf.d/*.conf.
#
# TLS is terminated at the ALB. Nginx receives plain HTTP on port 80.

server {
    listen 80 default_server;
    server_name agents.superlinear.com;

    # Static files (React build)
    root /var/www/claudeui/dist;
    index index.html;

    # ALB health check — lightweight response, no upstream proxy
    location /health {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    # API proxy to backend via chisel tunnel (project-based routing)
    # $backend_port is defined by the map in claudeui-backends.conf (see Section 7.2)
    location /api/ {
        proxy_pass http://localhost:$backend_port;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # IMPORTANT: Use $http_x_forwarded_proto (ALB's header), NOT $scheme.
        # ALB→nginx is plain HTTP, so $scheme = "http" always. That would
        # overwrite ALB's correct "X-Forwarded-Proto: https" and break
        # Express req.secure / HTTPS-aware middleware.
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }

    location /ws {
        proxy_pass http://localhost:$backend_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;  # 24h for long-lived WebSocket
    }

    location /shell {
        proxy_pass http://localhost:$backend_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 5.2 Chisel Server (systemd)

```ini
# /etc/systemd/system/chisel-server.service
[Unit]
Description=Chisel Tunnel Server (mTLS)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chisel
Group=chisel
EnvironmentFile=/etc/chisel/env
ExecStart=/usr/local/bin/chisel server \
    --port 8443 \
    --reverse \
    --tls-key /etc/chisel/certs/server.key \
    --tls-cert /etc/chisel/certs/server.crt \
    --tls-ca /etc/chisel/certs/ca.crt
# AUTH is read from environment via EnvironmentFile
Restart=always
RestartSec=5
LimitNOFILE=65535

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/log/chisel
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/chisel/env (mode 0600, owned by root)
# Chisel reads AUTH from environment when no --auth flag is passed.
# Ref: https://github.com/jpillora/chisel#authentication
# This avoids exposing credentials in /proc/{pid}/cmdline.
AUTH=user:STRONG_PASSWORD_HERE
```

### 5.3 Chisel Client (Backend Machines)

```ini
# /etc/systemd/system/chisel-client.service
[Unit]
Description=Chisel Tunnel Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chisel
Group=chisel
EnvironmentFile=/etc/chisel/env
ExecStart=/usr/local/bin/chisel client \
    --tls-key /etc/chisel/certs/client.key \
    --tls-cert /etc/chisel/certs/client.crt \
    --tls-ca /etc/chisel/certs/ca.crt \
    --keepalive 25s \
    wss://tunnel.agents.superlinear.com:8443 \
    R:9001:localhost:3001
# AUTH is read from environment
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 6. mTLS Implementation

Carried forward from expert-reviewed Fargate PRD. No changes needed — mTLS is between chisel endpoints, independent of compute platform.

### 6.1 Certificate Generation

**Server cert MUST include SAN extensions** (per security review):

```bash
# Private CA (do once, store ca.key in Secrets Manager)
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key \
  -out ca.crt -subj "/CN=ClaudeUI Internal CA/O=Superlinear"

# Server cert (for EC2 chisel server)
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr \
  -subj "/CN=tunnel.agents.superlinear.com"
openssl x509 -req -days 365 -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -extfile <(printf "subjectAltName=DNS:tunnel.agents.superlinear.com") \
  -out server.crt

# Client cert (per backend — repeat for each)
openssl genrsa -out client-a.key 2048
openssl req -new -key client-a.key -out client-a.csr \
  -subj "/CN=backend-a/O=Superlinear"
openssl x509 -req -days 365 -in client-a.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial -out client-a.crt
```

### 6.2 Certificate Storage

| Certificate | Location |
|---|---|
| CA cert | EC2: `/etc/chisel/certs/ca.crt` + each backend |
| CA key | Secrets Manager only (never on any server) |
| Server cert + key | EC2: `/etc/chisel/certs/server.{crt,key}` |
| Client cert + key | Each backend: `/etc/chisel/certs/client.{crt,key}` |

### 6.3 Revocation

For 3-5 backends: re-issue CA + all certs. Disruptive but simple. Document as runbook.

### 6.4 Cipher Suites

Chisel v1.10.1+ uses Go TLS 1.3 defaults: `TLS_AES_128_GCM_SHA256`, `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`. All strong. Pin chisel version; monitor for CVEs.

## 7. Multi-Backend Routing

### 7.1 Port Allocation (4+ backends)

Static port range: `9001–9099`. Each backend gets a fixed port assigned at onboarding.

| Backend | Chisel Client Config | EC2 Localhost Port | Machine |
|---|---|---|---|
| backend-01 | `R:9001:localhost:3001` | `localhost:9001` | e.g., dev-laptop-luchoh |
| backend-02 | `R:9002:localhost:3001` | `localhost:9002` | e.g., workstation-lab |
| backend-03 | `R:9003:localhost:3001` | `localhost:9003` | e.g., gpu-server |
| backend-04 | `R:9004:localhost:3001` | `localhost:9004` | e.g., ci-runner |
| ... | ... | ... | Up to 99 backends |

Port assignment is tracked in a config file on the EC2 instance:

```json
// /etc/claudeui/backends.json
{
  "backends": {
    "backend-01": { "port": 9001, "name": "luchoh-laptop", "cn": "backend-01" },
    "backend-02": { "port": 9002, "name": "lab-workstation", "cn": "backend-02" },
    "backend-03": { "port": 9003, "name": "gpu-server", "cn": "backend-03" },
    "backend-04": { "port": 9004, "name": "ci-runner", "cn": "backend-04" }
  }
}
```

### 7.2 Project-Based Routing

Users don't pick backends — they pick **projects**. Each project's files live on a specific backend machine. The routing flow:

```
User selects project in UI
  → Frontend sets cookie: backend=backend-02; Secure; SameSite=Strict; Path=/
  → All subsequent requests include cookie
  → Nginx maps cookie → port (unknown values fall through to default)
  → Traffic reaches the correct backend
```

**Cookie security:**
- `Secure` — only sent over HTTPS
- `SameSite=Strict` — prevents CSRF via cross-origin requests
- NOT `HttpOnly` — frontend JavaScript needs to set/read it for project switching
- The nginx `map` block uses `default 9001` as fallback — any unknown cookie value routes to backend-01, not to an error. This is safe because all backends require authentication anyway.
- Cookie value is validated against a fixed set of known backend IDs in the map block. Arbitrary values cannot reach arbitrary ports.

Nginx config for project-based routing:

```nginx
# /etc/nginx/conf.d/claudeui-backends.conf
# Auto-generated from /etc/claudeui/backends.json

map $cookie_backend $backend_port {
    default     9001;
    backend-01  9001;
    backend-02  9002;
    backend-03  9003;
    backend-04  9004;
}

# Used in the main server block:
# proxy_pass http://localhost:$backend_port;
```

**How the frontend knows which projects live where:**

A lightweight aggregator service runs on EC2 (`claudeui-aggregator.service`):

```bash
#!/bin/bash
# /usr/local/bin/aggregate-projects.sh (runs every 60s via systemd timer)
# Queries each online backend's /api/projects and writes a combined JSON file
BACKENDS_JSON="/etc/claudeui/backends.json"
OUTPUT="/var/www/claudeui/dist/backends-projects.json"
RESULT='{"backends":{}}'

for key in $(jq -r '.backends | keys[]' "$BACKENDS_JSON"); do
  port=$(jq -r ".backends[\"$key\"].port" "$BACKENDS_JSON")
  name=$(jq -r ".backends[\"$key\"].name" "$BACKENDS_JSON")
  # Skip unreachable backends
  if nc -z -w 2 localhost "$port" 2>/dev/null; then
    projects=$(curl -sf --max-time 5 "http://localhost:$port/api/projects" || echo '[]')
    RESULT=$(echo "$RESULT" | jq --arg k "$key" --arg n "$name" --argjson p "$projects" \
      '.backends[$k] = {"name": $n, "online": true, "projects": $p}')
  else
    RESULT=$(echo "$RESULT" | jq --arg k "$key" --arg n "$name" \
      '.backends[$k] = {"name": $n, "online": false, "projects": []}')
  fi
done

echo "$RESULT" > "$OUTPUT"
```

```ini
# /etc/systemd/system/claudeui-aggregator.service
[Unit]
Description=Aggregate backend project lists (one-shot)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/aggregate-projects.sh
User=root
```

```ini
# /etc/systemd/system/claudeui-aggregator.timer
[Unit]
Description=Run project aggregator every 60s

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s

[Install]
WantedBy=timers.target
```

- Frontend fetches `/backends-projects.json` (static file served from nginx root `/var/www/claudeui/dist/`) on load
- Each project entry is tagged with its `backend-id`
- Selecting a project sets the `backend` cookie, routing all traffic to the correct backend
- The aggregator also feeds the stale tunnel detection (backends marked `online: false`)

### 7.3 Stale Tunnel Detection

```bash
#!/bin/bash
# /usr/local/bin/check-tunnels.sh
BACKENDS_JSON="/etc/claudeui/backends.json"
PORTS=$(jq -r '.backends[].port' "$BACKENDS_JSON")

for port in $PORTS; do
  if ! nc -z -w 2 localhost $port 2>/dev/null; then
    echo "$(date) WARN: tunnel port $port unreachable" >> /var/log/chisel/health.log
  fi
done
```

```ini
# /etc/systemd/system/check-tunnels.service
[Unit]
Description=Check chisel tunnel health (one-shot)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/check-tunnels.sh
```

```ini
# /etc/systemd/system/check-tunnels.timer
[Unit]
Description=Run tunnel health check every 30s

[Timer]
OnBootSec=60s
OnUnitActiveSec=30s

[Install]
WantedBy=timers.target
```

### 7.4 Backend Registration Workflow

Adding a new backend:

1. Generate client cert: `CN=backend-05/O=Superlinear` (Section 6.1)
2. Assign next port: edit `/etc/claudeui/backends.json`, add `backend-05: { port: 9005 }`
3. Regenerate nginx map: `scripts/gen-nginx-backends.sh` → reload nginx
4. Deploy chisel client on the backend machine with `R:9005:localhost:3001`
5. Verify: `nc -z localhost 9005` on EC2

## 8. CloudFormation

### 8.1 Stack Order

1. **network.yaml** — VPC (`10.2.0.0/16`), subnets (2 AZs), IGW, routes
2. **secrets.yaml** — Secrets Manager entries
3. **ec2.yaml** — EC2 instance, EIP, security groups (ALB + EC2), IAM role, ALB, ACM certificate, target group, listeners, Route53 records

### 8.2 EC2 Template

See `cloudformation/03-ec2.yaml` for the full template. Key resources:

| Resource | Type | Purpose |
|---|---|---|
| `Certificate` | `AWS::CertificateManager::Certificate` | DNS-validated TLS cert for `agents.superlinear.com` |
| `LoadBalancer` | `AWS::ElasticLoadBalancingV2::LoadBalancer` | Internet-facing ALB, 300s idle timeout |
| `TargetGroup` | `AWS::ElasticLoadBalancingV2::TargetGroup` | Instance target on port 80, `/health` check |
| `HTTPSListener` | `AWS::ElasticLoadBalancingV2::Listener` | Port 443, ACM cert, TLS 1.2+/1.3 policy, forward to TG |
| `HTTPListener` | `AWS::ElasticLoadBalancingV2::Listener` | Port 80, redirect to HTTPS |
| `ALBSecurityGroup` | `AWS::EC2::SecurityGroup` | Ports 80/443 from `0.0.0.0/0` |
| `SecurityGroup` | `AWS::EC2::SecurityGroup` | Port 80 from ALB SG, 8443 from public, 22 from admin |
| `AgentsRecord` | `AWS::Route53::RecordSet` | A alias → ALB DNS |
| `TunnelRecord` | `AWS::Route53::RecordSet` | A record → Elastic IP |
| `Instance` | `AWS::EC2::Instance` | EC2 with chisel + nginx (no certbot) |
| `ElasticIP` | `AWS::EC2::EIP` | Stable IP for SSH + chisel tunnel |
| `InstanceRole` | `AWS::IAM::Role` | Secrets Manager read access |
| `KeyPair` | `AWS::EC2::KeyPair` | SSH key (private key in SSM Parameter Store) |

New parameters (vs original template):
- `SubnetBId` — second subnet for ALB (ALB requires 2 AZs)
- `HostedZoneId` — Route53 hosted zone (for DNS records + ACM validation)

## 9. Deployment Procedure

### 9.1 Initial Setup (one-time, after CloudFormation)

```bash
# SSH into the instance
ssh ec2-user@<Elastic-IP>

# 1. Deploy mTLS certificates (generated offline per Section 6.1)
sudo cp ca.crt server.crt server.key /etc/chisel/certs/
sudo chown chisel:chisel /etc/chisel/certs/*
sudo chmod 600 /etc/chisel/certs/server.key

# 2. Start chisel
sudo systemctl start chisel-server
sudo systemctl status chisel-server

# 3. Deploy the app (React build)
cd /var/www/claudeui
git clone <repo> . && npm ci && npm run build

# 4. Configure nginx (copy config from Section 5.1)
sudo vi /etc/nginx/conf.d/claudeui.conf
sudo vi /etc/nginx/conf.d/claudeui-backends.conf  # map block from Section 7.2
sudo nginx -t && sudo systemctl reload nginx

# 5. Set up project aggregator (Section 7.2)
sudo cp aggregate-projects.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/aggregate-projects.sh
sudo mkdir -p /etc/claudeui
sudo vi /etc/claudeui/backends.json  # backend registry from Section 7.1
# Install service + timer units from Section 7.2
sudo cp claudeui-aggregator.service claudeui-aggregator.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now claudeui-aggregator.timer
```

### 9.2 App Updates (manual)

```bash
ssh ec2-user@<Elastic-IP>
cd /var/www/claudeui
git pull && npm ci && npm run build
sudo systemctl reload nginx
```

### 9.3 Backend Setup (per machine, one-time)

```bash
# 1. Install chisel
curl -L https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz \
  | gunzip > /usr/local/bin/chisel && chmod +x /usr/local/bin/chisel

# 2. Deploy client certificate (generated offline per Section 6.1)
sudo mkdir -p /etc/chisel/certs
sudo cp ca.crt client.crt client.key /etc/chisel/certs/
sudo chmod 600 /etc/chisel/certs/client.key

# 3. Configure auth
echo "AUTH=user:STRONG_PASSWORD_HERE" | sudo tee /etc/chisel/env
sudo chmod 600 /etc/chisel/env

# 4. Install systemd service (from Section 5.3)
sudo cp chisel-client.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chisel-client

# 5. Verify tunnel
curl -s http://localhost:3001/health  # Should return OK from the backend's Express app
```

## 10. Required App Changes

Per security review — these apply regardless of deployment approach:

| Change | File | Severity | Notes |
|---|---|---|---|
| Add `app.set('trust proxy', N)` | `server/index.js` | CRITICAL | Rate limiting broken behind nginx without this. `N` = number of proxy hops: **1** for nginx-only, **2** for ALB + nginx. Override via `TRUST_PROXY` env var. |
| Update CORS `ALLOWED_ORIGINS` | `server/index.js` | HIGH | Add `https://agents.superlinear.com` |
| Disable `/api/system/update` in production | `server/index.js` | HIGH | RCE vector if enabled |
| Add WebSocket ping/pong (30-60s) | `server/ws/*.js` | MEDIUM | Prevents nginx `proxy_read_timeout` kills |
| Encrypt `credential_value` or complete keychain migration | `server/database/` | MEDIUM | Plaintext tokens on disk |

**Note:** SQLite auth.db stays on each backend machine (local disk). WAL mode works fine. No journal mode changes needed.

## 11. Cost

### Monthly (us-west-2, estimated from AWS public pricing pages, Feb 2026)

| Resource | Spec | Cost |
|---|---|---|
| EC2 | t4g.small, on-demand, 24/7 | ~$12 |
| ALB | Application Load Balancer, ~1 LCU avg | ~$16-22 |
| Elastic IP | Associated (no charge while instance running) | $0 |
| EBS | 20 GB gp3 | ~$2 |
| Route53 | 2 records (1 alias, 1 A) | ~$1 |
| Secrets Manager | 4 secrets | ~$2 |
| Data Transfer | First 100 GB/month free | ~$0-5 |
| **Total** | | **~$33-44/month** |

### Comparison

| Approach | Monthly Cost | Complexity |
|---|---|---|
| Current (local behind VPN) | $0 | None |
| **This PRD (EC2 + ALB + chisel)** | **~$33-44** | **Low** |
| ~~Fargate + ALB + NLB~~ | ~~$70-85~~ | ~~High~~ |

## 12. Operational Concerns

### 12.1 Monitoring

```bash
# Tunnel health check (systemd timer, every 30s)
# Alerts via CloudWatch agent or simple SNS notification
# Uses /etc/claudeui/backends.json for dynamic port list
PORTS=$(jq -r '.backends[].port' /etc/claudeui/backends.json)
for port in $PORTS; do
  nc -z -w 2 localhost $port || echo "ALERT: tunnel $port down"
done
```

Install CloudWatch agent for:
- EC2 instance metrics (CPU, memory, disk)
- Nginx access/error logs → CloudWatch Logs
- Chisel logs → CloudWatch Logs
- Custom metric: tunnel health (0/1 per backend)

### 12.2 Backups

- **SQLite auth.db:** Lives on each backend machine (not on EC2). Backup is the backend operator's responsibility.
- **EC2 EBS:** Daily snapshot via AWS Backup — captures nginx config, chisel certs, backends.json. Low priority (all config is reproducible from IaC + Secrets Manager).
- **Certificates:** CA key in Secrets Manager (automatic versioning). Server/client certs are reproducible from CA.
- **Nginx config:** In git (IaC)

### 12.3 Disaster Recovery

If the EC2 instance dies:
1. CloudFormation recreates it (user-data reinstalls everything)
2. Redeploy mTLS certs (from Secrets Manager or regenerate from CA)
3. Redeploy nginx config + backends.json (from git / EBS snapshot)
4. Chisel clients reconnect automatically (built-in retry)
Note: auth.db is on backend machines — EC2 loss does not affect auth state. ALB + ACM certificate persist independently of the EC2 instance.

### 12.4 Updates

| Component | Update Method |
|---|---|
| OS | `dnf update -y` (schedule via cron or SSM) |
| Node.js | `dnf update nodejs20` |
| Nginx | `dnf update nginx` |
| Chisel | Download new binary, restart service |
| ACM certificate | Auto-renewed by AWS (no action required) |
| App | `git pull && npm ci && npm run build` |

## 13. Security Hardening

Per security expert review (still applicable):

| Item | Status |
|---|---|
| mTLS on chisel (private CA + client certs) | Included |
| AUTH credential via env file (not CLI args) | Included |
| SAN extensions on server certificate | Included |
| Non-root chisel user with systemd hardening | Included |
| Chisel binary pinned to exact version | Included |
| Secrets Manager for credentials | Included |
| Security group restricts SSH to admin IP | In CloudFormation params |
| ACM for user-facing TLS (via ALB) | Included |
| `trust proxy` for Express behind ALB + nginx (`TRUST_PROXY=2`) | Required app change |
| Disable system update endpoint | Required app change |

**Additional for EC2 (not in Fargate PRD):**
- IMDSv2 enforced via `MetadataOptions` in CloudFormation template (instance metadata hardening) — **Included**
- SSM Session Manager instead of SSH (eliminates port 22) — Phase 3
- Automatic security updates via `dnf-automatic` — Phase 3

## 14. Migration Path

### Phase 1: Infrastructure + First Backend
- Deploy EC2 via CloudFormation (network → secrets → ec2)
- Set up nginx + chisel + mTLS certs (ALB + ACM handled by CloudFormation)
- Connect first backend, verify tunnel
- Validate: latency, WebSocket terminal, session management
- **Gate:** Terminal keystroke echo < 100ms

### Phase 2: All Backends + Project Routing
- Onboard remaining backends (4+ total) with unique tunnel ports
- Implement project-based routing (cookie → nginx map → port)
- Build project aggregation endpoint (query each backend's `/api/projects`)
- Add tunnel health monitoring (`check-tunnels.sh` timer)
- Create `backends.json` management tooling

### Phase 3: Hardening
- CloudWatch agent + alarms
- AWS Backup for EBS snapshots
- Certificate rotation runbook
- SSM Session Manager (drop SSH)
- CI/CD pipeline if manual deploys become painful

### Future: Option A (Split Architecture)
- Separate PRD required
- Auth on EC2, CLI commands proxied to backends
- Only pursue if Phase 1 latency/reliability is validated

## 15. Resolved Questions

| # | Question | Answer |
|---|---|---|
| 1 | Exact domain name? | `agents.superlinear.com` (user-facing), `tunnel.agents.superlinear.com` (chisel mTLS) |
| 2 | Which AWS region for backends? | **Still open** — latency depends on geographic proximity to us-west-2 |
| 3 | How many backends initially? | 4+ backends — need dynamic port allocation (see Section 7 update) |
| 4 | CI/CD preference? | Manual deploy (`ssh` + `git pull`) for now. CI/CD deferred to Phase 3. |
| 5 | Backend selection UX? | **Project-based routing** — each project lives on a specific backend. User selects a project, system routes to the correct backend. No manual backend picker needed. |
