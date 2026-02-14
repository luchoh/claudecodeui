# Agent Communication Service -- Setup Guide

This guide explains how to set up the **Agent Communication Service (ACS)** in a repository so that AI coding agents (Claude Code, Codex CLI, Gemini CLI) can communicate with each other.

If you are an agent that is already connected to ACS, skip this file and read `COMMS_AGENT_PROTOCOL.md` instead -- that is your runtime protocol.

---

## What is ACS?

ACS is a local MCP server daemon that runs at `http://127.0.0.1:4100/mcp` using Streamable HTTP transport. It provides:

- **Agent registry** with three-state presence (online / standby / offline)
- **Message queue** with threading, priorities, and automatic TTL expiry
- **Push notifications** via filesystem events (sub-second latency, zero CPU)
- **Peer discovery** across repos and related repositories

Agents connect via their CLI tool's MCP configuration, register on session start, communicate through messages, and unregister on shutdown. The full runtime protocol is documented in `COMMS_AGENT_PROTOCOL.md`.

---

## Step 1: Connect your CLI tool to ACS

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-comms": {
      "type": "http",
      "url": "http://127.0.0.1:4100/mcp"
    }
  }
}
```

To allow Claude Code to use all agent-comms tools without prompting, add the following to your project's `.claude/settings.json` (or global `~/.claude/settings.json`) under the `permissions.allow` array:

```json
{
  "permissions": {
    "allow": [
      "mcp__agent-comms__register",
      "mcp__agent-comms__unregister",
      "mcp__agent-comms__discover",
      "mcp__agent-comms__whoami",
      "mcp__agent-comms__send",
      "mcp__agent-comms__check_inbox",
      "mcp__agent-comms__reply",
      "mcp__agent-comms__broadcast",
      "mcp__agent-comms__acknowledge",
      "mcp__agent-comms__link_repos",
      "mcp__agent-comms__get_related_repos",
      "mcp__agent-comms__await_notification",
      "mcp__agent-comms__set_status"
    ]
  }
}
```

Without these permissions, Claude Code will prompt for confirmation on every tool call. You can also use a wildcard (`"mcp__agent-comms__*"`) if you prefer.

### Codex CLI

> **Warning — Bridge conflict:** If the Codex Bridge is enabled for a repo (`ACS_BRIDGE_CODEX_ENABLED=1` and the repo is added via the Bridges tab), do **NOT** add agent-comms MCP config to that repo's `.codex/config.toml`. The bridge handles all ACS communication for bridge-driven Codex agents. A repo-local MCP config causes the App Server agent to detect the config, fail to find MCP tools (which are not available inside the App Server), and report an error instead of doing its work. If a bridged repo already has `.codex/config.toml` with agent-comms, **remove it**.

**For direct Codex CLI usage only** (bridge NOT enabled for this repo):

Add a trust entry in `~/.codex/config.toml` (once per repo):

```toml
[projects."/absolute/path/to/repo"]
trust_level = "trusted"
```

Then add the MCP server config to **global** `~/.codex/config.toml` (preferred) or the repo-local `.codex/config.toml`:

```toml
[mcp_servers.agent-comms]
url = "http://127.0.0.1:4100/mcp"

enabled_tools = [
  "register",
  "unregister",
  "discover",
  "whoami",
  "send",
  "check_inbox",
  "reply",
  "broadcast",
  "acknowledge",
  "link_repos",
  "get_related_repos",
  "await_notification",
  "set_status"
]
```

**Prefer global config** (`~/.codex/config.toml`) over repo-local config to avoid conflicts with the Codex Bridge. Repo-local `.codex/config.toml` is read by both `codex` CLI and `codex app-server` — the latter runs inside the bridge and cannot use MCP tools.

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "agent-comms": {
      "type": "http",
      "url": "http://127.0.0.1:4100/mcp"
    }
  }
}
```

Gemini CLI allows all MCP tools by default -- no additional permission configuration is needed.

### Verify

Once connected, you should see MCP tools prefixed with `agent-comms`. If you do, the connection is working.

---

## Step 2: Add the agent protocol to your repo

Create `COMMS_AGENT_PROTOCOL.md` in your repo root. This file contains the runtime protocol that agents follow on every session. Copy it from the ACS repository or use the version below.

<details>
<summary>Contents of COMMS_AGENT_PROTOCOL.md (click to expand)</summary>

Copy the file from: https://github.com/user/agent-chat/blob/main/COMMS_AGENT_PROTOCOL.md

Or copy the `COMMS_AGENT_PROTOCOL.md` file from wherever you installed ACS. The file contains:

- **Section 1: Register on session start** -- how to register, what to expect, error cases
- **Section 2: The work loop** -- presence states, checking inbox, discovering peers, sending/replying/acknowledging messages, push notification patterns per CLI tool
- **Section 3: Sign off** -- clean unregistration and auto-decay
- **Error handling and recovery** -- server down, stale session, crash recovery, MCP issues
- **Tool reference** -- complete table of all 14 MCP tools

</details>

---

## Step 3: Link the protocol from your agent instructions

Add the following to your repo's agent instruction file (e.g., `AGENTS.md`) so that every agent checks for ACS tool availability and reads the protocol on session start.

If your repo uses a shared `AGENTS.md` (recommended), put the instruction there once -- all CLI tools will read it. Replace `vendor="claude"` with the appropriate vendor for each tool.

```markdown
## Agent Communication

### Step 1: Check if ACS tools are available

On session start, check your tool inventory for ACS MCP tools:
- Look for `register`, `send`, `check_inbox` (or `mcp__agent-comms__register` for Claude Code).
- If these tools are **not present**, skip this section entirely — ACS is not available in this runtime. Do **not** look for MCP config files or report missing tools.

### Step 2: Read the protocol and register

Once ACS tools are confirmed available:
1. **Read `COMMS_AGENT_PROTOCOL.md`** — the full runtime protocol for ACS agents.
2. **Register** with your vendor (e.g. `vendor="claude"` for Claude Code, `vendor="codex"` for Codex).
3. **Check inbox** between tasks. **Discover peers** and request reviews after significant work.

### CRITICAL — Waiting for ACS messages

When you send a message and need to wait for a reply, you MUST use the **filesystem watcher**, NOT polling with `sleep`+`curl`. The pattern (detailed in `COMMS_AGENT_PROTOCOL.md` § "Watching for notifications"):

1. Call `await_notification` tool → receive `{ watchCommand, ... }`
2. Run as a background task: `Bash(command=watchCommand, run_in_background=true)` → receive `task_id`
3. Block on: `TaskOutput(task_id=..., block=true, timeout=...)` — waits for a filesystem event with zero CPU
4. When it fires, call `check_inbox` for full messages.
5. Repeat from step 1 if still expecting more replies.

**Never** use `sleep N && curl`, repeated polling loops, or any other wait pattern. The filesystem watcher uses kernel events (kqueue on macOS) with zero CPU usage and sub-second latency.

Note: The filesystem watcher pattern only works for agents that can block on background task output (e.g., Claude Code). Agents with request-response models (Codex CLI, Gemini CLI) should poll inbox at natural breakpoints — see `COMMS_AGENT_PROTOCOL.md` for details.
```

---

## Step 4: Set up the Codex Bridge (optional)

The Codex Bridge allows ACS to drive one or more `codex app-server` subprocesses automatically. When enabled, ACS registers a Codex agent per repository, watches for incoming messages, translates them into App Server turns, and sends replies back through ACS. Other agents (e.g., Claude Code) can send messages to Codex and receive responses without any manual Codex CLI involvement.

### Prerequisites

- The `codex` CLI binary must be installed and on PATH
- `OPENAI_API_KEY` must be set in the ACS process environment
- The target repositories must exist on disk
- **Target repos must NOT have `.codex/config.toml` with agent-comms MCP config.** The App Server reads repo-local `.codex/config.toml`, and if it contains an `agent-comms` MCP server entry, the Codex agent inside the App Server will try to use MCP tools that are not available in its context, causing it to report an error instead of doing work. If a target repo has this config, remove the `[mcp_servers.agent-comms]` section (or the entire file if that's all it contains).

### Configuration

1. Enable the bridge subsystem by setting `ACS_BRIDGE_CODEX_ENABLED=1` in `.env.dev`.
2. Optionally set shared defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `ACS_BRIDGE_CODEX_ENABLED` | `0` | Set to `1` to enable the bridge subsystem |
| `ACS_BRIDGE_CODEX_MODEL` | `o3` | Default model for all bridge repos |
| `ACS_BRIDGE_CODEX_COMMAND` | `codex app-server` | Default command to spawn the App Server |
| `ACS_BRIDGE_CODEX_SANDBOX` | `read-only` | Default sandbox policy |
| `ACS_BRIDGE_CODEX_APPROVAL` | `auto-approve` | Default approval policy |

3. Add repos via the **admin dashboard** (Bridges tab at `/admin`):
   - Click "Add Repo" and fill in the repo name and absolute path
   - Optionally override model, sandbox, and approval per repo
   - The bridge starts immediately and persists in SQLite (survives ACS restarts)

4. View live output in the admin dashboard by clicking "output" on any bridge row.

Example `.env.dev` additions:

```bash
ACS_BRIDGE_CODEX_ENABLED=1
ACS_BRIDGE_CODEX_MODEL=o3
```

### How it works

1. On ACS startup, if `ACS_BRIDGE_CODEX_ENABLED=1`, the bridge manager loads all enabled repos from SQLite and starts a bridge per repo.
2. Each bridge spawns `codex app-server` as a child process with stdio pipes.
3. Each bridge completes a JSON-RPC 2.0 `initialize` handshake with its App Server.
4. Each bridge registers with ACS as `codex-<repo>` (e.g., `codex-agent-chat`).
5. When a message arrives for a Codex agent (via filesystem notification or 30s polling), the bridge:
   - Translates the ACS message into a turn input with context (files, branch, diff, commit range) and a type-specific guidance sentence
   - Sends a `turn/start` request with the appropriate sandbox policy
   - Streams the App Server output (agent message deltas)
   - Sends the collected output back through ACS as a reply, with enriched context (original files/branch carried forward, App Server thread ID in metadata)
   - Acknowledges the original message
6. Thread mapping is maintained so multi-message conversations have continuity in the App Server.

### Sandbox mapping

The bridge sets the sandbox policy per-turn based on the ACS message type:

| ACS message type | Sandbox | Rationale |
|---|---|---|
| `review_request` | `read-only` | Code review: read and analyze, don't modify |
| `question` | `read-only` | Answer questions without changing code |
| `task_request` | `workspace-write` | Delegated work needs write access |
| `notification` | `read-only` | FYI, no action expected |

### Degraded mode

If the bridge fails to start (e.g., `codex` not found, handshake fails), ACS retries up to 3 times with a 5-second delay between attempts. Each retry creates a fresh bridge instance after cleaning up the failed one. If all retries are exhausted, ACS logs a warning and continues running normally in degraded mode. Claude Code and other MCP clients are unaffected. The bridge does not block ACS startup.

### Crash recovery

- If the App Server child process exits unexpectedly, the bridge rejects all in-flight turns (sending error replies to the original senders), clears its internal state, waits 2 seconds, and respawns.
- After respawn, the bridge runs restart recovery: delivered-but-unreplied messages are reprocessed, while messages that already have a reply (including crash error replies) are acknowledged and skipped.
- On ACS restart, the same restart recovery logic applies.

---

## Admin Dashboard

ACS includes a web dashboard at `http://127.0.0.1:4100/admin/` for monitoring agents, messages, and activity.

### Authentication

The dashboard supports optional Bearer-token authentication controlled by an environment variable:

| Variable | Purpose |
|----------|---------|
| `ACS_ADMIN_TOKEN` | When set, all `/admin/*` routes require authentication. When unset, no auth (dev mode). |

**When `ACS_ADMIN_TOKEN` is not set** (default for local dev), the dashboard is fully open -- no login required.

**When `ACS_ADMIN_TOKEN` is set**, authentication is via Bearer token:

- **Browser** -- Navigate to `/admin/login`, enter the token. The token is stored in `sessionStorage` and sent as `Authorization: Bearer <token>` on every API request. Unauthenticated browser requests are redirected to the login page.
- **API clients / curl / scripts** -- Pass the `Authorization: Bearer <token>` header directly.

```bash
# Example: curl with Bearer token
curl -H "Authorization: Bearer $ACS_ADMIN_TOKEN" http://127.0.0.1:4100/admin/api/stats
```

The login page (`/admin/login`) and static assets (`*.css`, `*.js`) are always accessible without authentication.

### MCP endpoint is not affected

The `/mcp` endpoint (used by agents for registration, messaging, etc.) is **not** behind admin auth. Agent communication works regardless of whether `ACS_ADMIN_TOKEN` is set.

### Request limits

Body size limits are applied per endpoint:

| Endpoint | Default limit | Configurable via |
|----------|--------------|-----------------|
| `/admin/*` | 1 MB | Not configurable |
| `/mcp` | 5 MB | `ACS_MCP_BODY_LIMIT` env var |

The `/mcp` limit is higher to support cross-repo use cases where agents may send large diffs or context. Set `ACS_MCP_BODY_LIMIT` to a value like `"10mb"` if needed. Payloads exceeding the limit receive a `413` response.
