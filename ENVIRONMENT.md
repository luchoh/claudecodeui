# Environment Setup

## Overview

This repository uses **profile files** in the repo root. Only the `*.example`
templates are tracked in git; real profiles are gitignored.

Local profiles:

- `.env.dev` (copy from `.env.dev.example`)
  - Local dev stack (defaults: backend `3001`, frontend `5173`)
  - Requires `JWT_SECRET` (minimum 32 characters)

## Nix + devenv workflow

1. Create local profile:
   ```bash
   cp .env.dev.example .env.dev
   ```

2. Generate and add JWT_SECRET:
   ```bash
   openssl rand -base64 32
   # Add the output to .env.dev as JWT_SECRET=<generated-value>
   ```

   Or use the helper script after entering the shell:
   ```bash
   devenv shell
   setup-env  # Creates .env.dev with auto-generated JWT_SECRET
   ```

3. Enter the shell:
   ```bash
   devenv shell
   ```

4. Run services (managed by the user):
   ```bash
   devenv up                 # Both server + client
   devenv up server          # Backend only (port 3001)
   devenv up client          # Frontend only (port 5173)
   ```

### Security Configuration

Required environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Authentication secret (32+ chars). Generate with `openssl rand -base64 32` |
| `PORT` | No | Backend server port (default: 3001) |
| `VITE_PORT` | No | Vite dev server port (default: 5173) |
| `BIND_HOST` | No | Server bind address (default: 127.0.0.1) |

Optional security settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `http://localhost:3001,http://localhost:5173` | CORS allowed origins (comma-separated) |
| `ACCESS_TOKEN_EXPIRY` | `15m` | JWT access token lifetime |
| `REFRESH_TOKEN_EXPIRY_DAYS` | `7` | Refresh token lifetime in days |
| `RATE_LIMIT_WINDOW` | `60000` | Rate limit window in ms |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_AUTH_MAX` | `10` | Max auth attempts per window |
| `PTY_IDLE_TIMEOUT` | `300000` | PTY session idle timeout in ms (5 min) |
| `ENABLE_SYSTEM_UPDATE` | `false` | Enable /api/system/update endpoint |

Platform mode (for hosted deployments):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_IS_PLATFORM` | `false` | Enable platform mode (bypasses auth) |
| `ALLOW_PLATFORM_MODE` | `false` | Required acknowledgment when platform mode is enabled |

### Runtime knobs

- `CONTEXT_WINDOW`: Claude context window size (default 160000)
- `WORKSPACES_ROOT`: Allowed workspace directories (default: user home, comma-separated for multiple)
- `DATABASE_PATH`: Custom path for SQLite auth database

## npm workflow (without devenv)

If not using devenv/Nix:

```bash
# Install dependencies
npm install

# Create and configure .env.dev
cp .env.dev.example .env.dev
# Edit .env.dev and add JWT_SECRET

# Run in development mode
npm run dev

# Or run server and client separately
npm run server   # Backend on port 3001
npm run client   # Vite on port 5173
```

## Production build

```bash
npm run build    # Build frontend to dist/
npm run start    # Build + start server
```

The production server serves the built frontend from `dist/` and binds to
`BIND_HOST:PORT` (default `127.0.0.1:3001`).
