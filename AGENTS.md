# Repository Guidelines

**Before reading further:** Open `WORKING_AGREEMENT.md` and follow its commitments. It contains mandatory guardrails (no speculation, every claim tied to logs/tests, flag outstanding verification) that apply to every task in this repo.

## Project Structure & Module Organization

This is a web-based UI for Claude Code CLI, built with:
- **Frontend**: React + Vite in `src/`, with components, hooks, and utilities
- **Backend**: Express.js server in `server/`, handling API routes and WebSocket connections
- **Shared**: Common types and utilities in `shared/`
- **Static Assets**: Public files in `public/`

Key directories:
- `src/components/` - React components
- `src/hooks/` - Custom React hooks
- `src/lib/` - Utility functions and helpers
- `server/` - Express backend with authentication, database, and Claude CLI integration
- `shared/` - Types and constants shared between frontend and backend

## Build, Test, and Development Commands

- **Do not start or stop long-running services yourself.** The user manages backend and frontend lifecycles via `devenv up ...` or `npm run dev`; assume both are already running in development mode with auto-reload enabled.
- `npm run dev` starts both server and client with hot reload using concurrently
- `npm run server` runs only the Express backend
- `npm run client` runs only the Vite dev server
- `npm run build` creates a production build
- `npm run typecheck` runs TypeScript type checking

> **Service lifecycle rule**: Focus on code changes, tests, and diagnostics. Never run `devenv up`, `devenv down`, or similar orchestration commands unless the user explicitly instructs you to do so.

## Coding Style & Naming Conventions

- TypeScript throughout, with strict type checking
- React components use PascalCase filenames
- Hooks and utilities use camelCase
- Tailwind CSS for styling with `clsx`/`class-variance-authority` for conditional classes
- ESM modules (`"type": "module"` in package.json)

## Testing Guidelines

Run `npm run typecheck` to verify TypeScript compilation. Additional test suites should be added as the project matures.

## Commit & Pull Request Guidelines

Follow the existing history's imperative, sentence-case commit messages (`Add user authentication`). Keep the subject under ~72 characters and add focused bodies when explaining rationale or trade-offs. Pull requests should link issues, call out API changes, and include screenshots for UI adjustments.

## Local Environment Options

**devenv users** can enter the Nix shell via `devenv shell` (see below for details). Service processes source `.env.dev` from the repo root.

### Environment Setup

1. Create local profiles:
   ```bash
   cp .env.dev.example .env.dev
   ```

2. Enter the shell:
   ```bash
   devenv shell
   ```

3. Run services (managed by the user):
   - `devenv up server client` (sources `.env.dev`)
   - Or use `npm run dev` for the traditional workflow

## Security & Configuration Tips

Never commit secrets. Start from the tracked template:

- Local dev: `cp .env.dev.example .env.dev`

Add API keys and credentials as needed. Log files and database files should be gitignored; inspect them for sensitive data before sharing.

## Agent Communication

### Bridge-driven agents (Codex, sandboxed runners): STOP HERE

If you are running inside `codex app-server` or any sandboxed bridge environment, **the ACS bridge handles all communication on your behalf.** You have NO MCP tools and you do NOT need them.

- **Do NOT** check `.mcp.json` — that is a Claude Code config file, not yours.
- **Do NOT** report missing MCP tools as an error or escalation.
- **Do NOT** attempt to register, check inbox, or discover peers.
- **Skip this entire section** and focus on the task in your prompt.

### Step 1: Check if Agent Comms MCP tools are available

> This step is for Claude Code, Gemini CLI, and other MCP-capable agents only.

Check your tool inventory for ACS tools (`register`, `send`, `check_inbox`, or prefixed variants like `mcp__agent-comms__register`).

**If ACS tools ARE available** → proceed to Step 2.

**If ACS tools are NOT available:**
- **Claude Code agents:** Check if `agent-comms` is configured in `.mcp.json` or `~/.claude.json`. If configured but tools are missing, escalate to the user: run `/mcp reset agent-comms`. If not configured, skip this section — ACS is not part of this project.
- **Other agents:** If no ACS tools and no relevant config, skip this section.

### Step 2: Read the protocol and register

Once MCP tools are confirmed available:
1. **Read `COMMS_AGENT_PROTOCOL.md`** — the full runtime protocol for ACS agents.
2. **Register** with your vendor (e.g. `vendor="claude"` for Claude Code, `vendor="codex"` for Codex).
3. **Check inbox** between tasks. **Discover peers** and request reviews after significant work.

### CRITICAL — Waiting for ACS messages

When you send a message and need to wait for a reply, you MUST use the **filesystem watcher**, NOT polling with `sleep`+`curl`. The pattern (detailed in `COMMS_AGENT_PROTOCOL.md` § "Watching for notifications"):

1. Call `await_notification` tool → receive `{ watchCommand, ... }`
2. Run as a background task: `Bash(command=watchCommand, run_in_background=true)` → receive `task_id`
3. Block on: `TaskOutput(task_id=..., block=true, timeout=...)` — this waits for a filesystem event with zero CPU
4. When it fires, call `check_inbox` for full messages.
5. Repeat from step 1 if still expecting more replies.

**Never** use `sleep N && curl`, repeated polling loops, or any other wait pattern. The filesystem watcher uses kernel events (kqueue on macOS) with zero CPU usage and sub-second latency.
