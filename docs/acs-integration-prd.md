# PRD: ACS Integration — Agent Communication for Claude Code UI

## Status
- Final (iteration 6, all open questions resolved, cross-agent consensus with `codex-claudecodeui` on 2026-02-14)

## Problem Statement

Claude Code UI is a mobile-first web interface for managing AI coding sessions across multiple projects/repos. ACS (Agent Communication Service) is a local MCP server that enables AI agents across repos to communicate with each other — sending messages, requesting reviews, delegating tasks, broadcasting notifications.

Today these are disconnected: Claude Code UI manages sessions, ACS manages inter-agent communication. The user has no way to see ACS agent activity, receive notifications, or interact with ACS agents from the UI.

## Goals

1. Users can see ACS agents working on their projects and interact with them from Claude Code UI
2. Users receive notifications when ACS agents send messages relevant to their projects
3. Users can manage ACS bridges (Codex agent subprocesses) from Claude Code UI Settings
4. The integration is mobile-first and fits naturally into the existing project/session navigation
5. Zero impact when ACS is not running (feature-gated)

## Non-Goals

- Replacing ACS's admin dashboard (the built-in dashboard at `:4100/admin/` remains for power users)
- Running ACS from within Claude Code UI (ACS is a separate service managed by `devenv up`)
- Multi-user / multi-ACS-instance aggregation
- Real-time collaborative editing between agents

## Constraints

- Claude Code UI is mobile-first — no wide side panels, no desktop-only layouts
- CSP `connect-src: 'self'` blocks direct browser-to-ACS calls — all traffic through Express backend
- No Redux/Zustand — React Contexts only for state management
- All streaming via WebSocket (no EventSource/SSE in frontend)
- ACS runs at `127.0.0.1:4100` (localhost only)

---

## Key Design Decision: Agent Registration Model

### Wrong: Static singleton agent

~~Register once as `ui-claudecodeui`.~~ This is wrong because the UI serves multiple projects. A static identity doesn't map to any repo, so other agents don't know how to address it.

### Right: Per-project custodian agent

When the user selects a project (e.g., `quantum-iqm`), the UI backend registers with ACS as the **custodian** of that repo:

```
vendor: "ui"
repo: "quantum-iqm"
repoPath: "/Users/luchoh/Dev/quantum-iqm"
capabilities: ["ui", "dashboard", "notifications"]
```

This gives the agent an identity of `ui-quantum-iqm` — a first-class participant in that repo's agent mesh. Other agents (e.g., `codex-quantum-iqm`, `claude-quantum-iqm`) can discover it and send messages to it.

> **ACS-side change required**: Make vendor list configurable via `ACS_ALLOWED_VENDORS` env var (default includes `ui`). See "ACS-Side Changes" section below.

#### Multi-project behavior

The user may have multiple projects. The UI backend maintains **always-on ACS registrations for all projects**:

- On startup (if `ACS_ENABLED=1`): register for all known projects that have ACS activity
- Background: all registrations receive push notifications; UI aggregates unread counts across projects
- On project addition: register with ACS for the new project
- On project removal: unregister from ACS for that project
- On shutdown: unregister all, close all connections

Each registration requires a separate MCP session (separate `StreamableHTTPClientTransport` instance with its own `mcp-session-id`). The backend manages a pool of connections.

This "always-on" model ensures unread badges are accurate for all projects, even ones the user hasn't opened recently. The connection count is bounded by the number of projects (typically < 10).

#### Agent naming

ACS agent IDs follow `{vendor}-{repo}` convention. UI agents use vendor `ui`:
- `ui-quantum-iqm` — UI custodian for quantum-iqm
- `ui-agent-chat` — UI custodian for agent-chat
- `ui-claudecodeui` — UI custodian for the claudecodeui repo itself

Reserved vendors:
- `ui` is reserved for Claude Code UI custodian agents
- `other` is reserved for generic/manual agents (admin dashboard, scripts)
- `claude`, `codex`, `gemini` are reserved for their respective AI agents
- Third-party tools should use `other` or request a new vendor via `ACS_ALLOWED_VENDORS`

This means a repo can have multiple agents: `claude-quantum-iqm` (Claude Code CLI), `codex-quantum-iqm` (Codex bridge), and `ui-quantum-iqm` (Claude Code UI). They coexist and can communicate.

---

## UX Design (Mobile-First)

### Current navigation structure

```
Bottom nav: [Chat] [Terminal] [Files] [Tools] [Tasks]
Main view: Project list → Sessions within project
Settings: Modal with tabs (Agents, Appearance, API, Tasks)
```

### Proposed changes

#### 1. Agent messages as a session type within projects

Instead of adding a 6th bottom nav tab (too crowded on mobile), ACS agent conversations appear **within the project** as a distinct section. When the user opens a project:

```
Project: quantum-iqm
├── Sessions (existing)
│   ├── Session 1 — "Fix auth bug" (2h ago)
│   └── Session 2 — "Add tests" (yesterday)
├── Agent Messages (new, if ACS available)
│   ├── codex-quantum-iqm — "Review complete" (5m ago) [unread badge]
│   └── claude-quantum-iqm — "Build passed" (1h ago)
```

Tapping an agent conversation opens a threaded message view (similar to chat, but using ACS messages instead of Claude API).

#### 2. Unread badges on projects

Projects with unread ACS messages show a badge (dot or count) in the project list. This works naturally with the existing mobile layout — the user sees at a glance which projects have agent activity.

```
[quantum-iqm] ● 2 unread    [8+ sessions] [★] [🗑] [✏] [>]
[agent-chat]                 [4 sessions]  [★] [🗑] [✏] [>]
```

#### 3. Notification toast/banner

When an ACS message arrives (for any registered project), show a toast notification:

```
┌──────────────────────────────────┐
│ codex-quantum-iqm                │
│ "Review complete: 2 issues found"│
│ [View] [Dismiss]                 │
└──────────────────────────────────┘
```

Tapping "View" navigates to that project's agent message thread.

#### 4. Settings → Agents → ACS Bridges

Add "ACS Bridges" as a new category under Settings → Agents (alongside existing account/permissions/mcp categories):

```
Settings → Agents
├── Account
├── Permissions
├── MCP Servers
└── ACS Bridges (new)
    ├── Bridge: quantum-iqm [running] [edit] [remove]
    ├── Bridge: agent-chat [running] [edit] [remove]
    ├── Bridge: claudecodeui [stopped] [edit] [remove]
    └── [+ Add Bridge]
```

Bridge management: add/edit/remove repos, view status, toggle enabled/disabled. Live output viewing available per bridge (streams output in a scrollable log view).

#### 5. Agent discovery in project detail

Within a project, a small "Agents" chip/section shows discovered ACS agents for that repo:

```
Project: quantum-iqm
Agents: codex-quantum-iqm (online) · claude-quantum-iqm (standby)
```

Tapping an agent shows: send message, view conversation history, see agent capabilities.

---

## Architecture

### Backend

#### `server/services/acs-client.js` — ACS Connection Manager

A singleton service managing multiple MCP connections (one per registered project):

```javascript
class ACSConnectionManager {
  // Map of repo → { client, transport, agentId, connected }
  connections = new Map();

  async registerForProject(repo, repoPath) {
    // Create new MCP client + transport
    // Register as vendor:"ui", repo, repoPath
    // Subscribe to push notifications via SSE
    // Return agentId
  }

  async unregisterFromProject(repo) {
    // Unregister agent, close transport
  }

  async sendMessage(fromRepo, to, type, subject, body, opts) {
    // Send via the connection for fromRepo
  }

  async checkInbox(repo) {
    // Check inbox for the agent registered for this repo
  }

  // ... discover, reply, acknowledge
}
```

Initialized in `server/index.js`, attached to `app.locals.acsManager`.

Push notifications from any connection are broadcast to all WebSocket clients via `connectedClients` (same pattern as `projectWatcher.js`).

Connection cap (UI-side safeguard):
- `ACS_MAX_REGISTRATIONS` env var (default: 20)
- When exceeded, log a warning and skip registration for least-recently-active projects
- This cap only limits UI registrations; ACS itself has no connection limit

#### `server/routes/acs.js` — BFF Proxy Routes

```
GET    /api/acs/status                  — Overall ACS status + per-project connection status
GET    /api/acs/projects/:repo/agents   — Discover agents for a repo
GET    /api/acs/projects/:repo/inbox    — Check inbox for a repo's UI agent
POST   /api/acs/projects/:repo/send     — Send message from a repo's UI agent
POST   /api/acs/projects/:repo/reply    — Reply to a message
POST   /api/acs/projects/:repo/ack      — Acknowledge a message
GET    /api/acs/bridges                 — List all bridges (proxy to ACS admin API)
POST   /api/acs/bridges                 — Create bridge
PATCH  /api/acs/bridges/:repo           — Update/rename bridge
DELETE /api/acs/bridges/:repo           — Remove bridge
GET    /api/acs/bridges/:repo/output    — Stream bridge output (SSE→WS relay)
```

Admin API calls proxy to `http://127.0.0.1:4100/admin/api/*` with `ACS_ADMIN_TOKEN`.

#### Environment Variables

```bash
ACS_ENABLED=0                          # Toggle ACS integration (default: off)
ACS_URL=http://127.0.0.1:4100/mcp     # MCP endpoint
ACS_ADMIN_URL=http://127.0.0.1:4100   # Admin API base URL
ACS_ADMIN_TOKEN=                       # Admin auth token (optional in dev)
```

#### New Dependency

`@modelcontextprotocol/sdk` — MCP client SDK for Streamable HTTP transport + SSE notifications.

### Frontend

#### `src/contexts/ACSContext.jsx` — React Context

Follows `TaskMasterContext` pattern:
- Fetches ACS status on mount (when auth ready)
- Subscribes to `latestMessage` from `WebSocketContext` for live updates
- Manages per-project agent lists, inbox, unread counts
- Exposes `useACS()` hook

State shape:
```javascript
{
  enabled: boolean,                    // ACS reachable
  projectConnections: Map<repo, {      // Per-project state
    connected: boolean,
    agents: Agent[],
    threads: Thread[],
    unreadCount: number,
  }>,
  bridges: Bridge[],                   // All bridges
}
```

Feature gate: follows `TasksSettingsContext` pattern — probes `/api/acs/status` on mount, hides all ACS UI when unavailable.

#### New Components

- `src/components/AgentMessages.jsx` — Agent message section within project view. Shows conversation threads with ACS agents for the selected project.
- `src/components/AgentThread.jsx` — Threaded message view (chat-like, but for ACS messages).
- `src/components/AgentNotification.jsx` — Toast/banner for incoming ACS messages.
- `src/components/settings/ACSBridges.jsx` — Bridge management in Settings → Agents.

#### WebSocket Message Types

Added to `globalMessageTypes` in `useWebSocketHandler.js`:
```javascript
'acs-message-received'     // New ACS message for any registered project
'acs-agent-changed'        // Agent presence changed
'acs-bridge-status'        // Bridge status changed
'acs-connection-changed'   // ACS connection status changed
```

### ACS-Side Changes (agent-chat repo)

Three changes needed:

1. **Configurable vendor list**: Replace hardcoded `ALLOWED_VENDORS` array with `ACS_ALLOWED_VENDORS` env var (default: `claude,codex,gemini,other,ui`). Changes in `src/registry.ts` line 9 and `src/server.ts` line 280.

2. **Force-register flag**: Add optional `force: boolean` parameter to the `register` MCP tool. When `true`, unregisters any existing agent with the same computed agentId before registering the new one. Change in `src/registry.ts` register function.

3. **Bridge output history endpoint**: `GET /admin/api/bridges/:repo/output?mode=history&limit=100` — Returns JSON array of recent output events from ring buffer (currently only SSE streaming exists). Change in `src/admin-routes.ts`.

---

## Open Questions

### Resolved

1. ~~**Connection pool limits**~~: **Always-on connections.** Register for all known projects on startup. Connection count bounded by project count (typically < 10). Ensures unread badges are accurate across all projects.

2. ~~**Message persistence**~~: **No local caching needed.** ACS retains messages for 24 hours (default TTL, swept every 60 seconds). The UI can pull messages on demand via `check_inbox`. For most real-time workflows, 24h retention is sufficient. If long-term history is needed later, local caching can be added as a follow-up.

3. ~~**Notification permissions**~~: **Yes, use browser Notification API.** Request permission on first ACS message receipt. Show native push notifications when the tab is backgrounded. In-app toast when the tab is focused.

4. **Agent identity conflicts**: **Force-register (Option C).** Add an optional `force: true` flag to the ACS `register` tool. When set, ACS unregisters any existing agent with the same ID before registering the new one. The UI backend always passes `force: true` on startup. This handles crash recovery without needing persistent token storage (the Claude Code UI DB has no per-project token table — adding one would be non-trivial new infrastructure). ACS-side change: ~10 lines in `registry.ts`.

5. **Bridge output on mobile**: **Toggle (Option A).** Bridge list shows status only. User taps "Show output" to expand a fixed-height (300px) scrollable log div. No bottom sheet — the codebase has no drawer/sheet component or library (`src/components/ui/` only has badge, button, input, scroll-area). Toggle fits existing patterns and avoids a new dependency.

6. **ACS vendor list**: **Configurable via env var (Option C).** Instead of hardcoding allowed vendors, ACS reads `ACS_ALLOWED_VENDORS` from the environment (default: `claude,codex,gemini,other,ui`). This is future-proof and avoids code changes for new vendors. ACS-side change: ~5 lines in `registry.ts` and `server.ts`.

---

## Security Considerations

- **Force-register eviction**: `force: true` allows any local MCP client to evict an agent with the same `{vendor}-{repo}` ID. This is acceptable for v1 because ACS is localhost-only and agent IDs are namespaced by vendor.
- **V2 improvement**: add a session-scoped eviction token. The agent that registers first gets a token and must present it to force-evict.
- **Audit trail**: emit `log.warn` on every force-eviction.

## Validated Code Touchpoints (from cross-agent review)

These are the specific files and locations that need modification, validated against the codebase by `codex-claudecodeui` (2026-02-14).

### Backend

| File | Change | Evidence |
|------|--------|----------|
| `server/services/acs-client.js` | **New file.** ACS Connection Manager singleton. Fits alongside existing `server/services/projectWatcher.js`. | `ls server/services` → only `projectWatcher.js` exists |
| `server/routes/acs.js` | **New file.** BFF proxy routes under `/api/acs/*`. | Existing pattern: `app.use('/api/projects', ...)` in `server/index.js` |
| `server/index.js` | Initialize `ACSConnectionManager` and attach to `app.locals.acsManager`. Add ACS pool cleanup to shutdown sequence (lines ~630-740). Wire `/api/acs` routes. | DI pattern: `app.locals.wss` at line 146, used by `req.app.locals.wss` in routes |
| `server/ws/chatHandler.js` | Subscribe to ACS notifications from `acsManager` and broadcast via `connectedClients`. | `connectedClients` in `projectWatcher.js` is the existing broadcast mechanism |
| `package.json` + `npm-shrinkwrap.json` | Add `@modelcontextprotocol/sdk` dependency. | npm workflow confirmed (`npm-shrinkwrap.json` present) |

### Frontend

| File | Change | Evidence |
|------|--------|----------|
| `src/contexts/ACSContext.jsx` | **New file.** React Context following `TaskMasterContext` pattern: fetch on mount, subscribe to WS `latestMessage`, feature-gate via status probe. | `TaskMasterContext.jsx` lines 160-340 show the exact pattern |
| `src/hooks/useWebSocketHandler.js` | Add ACS types to `globalMessageTypes` array. | Line ~70: `const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created']` |
| `src/components/Sidebar.jsx` | Add "Agent Messages" section below sessions list in expanded project. | Lines 1140-1250: sessions rendered via `getAllSessions(project).map(...)`. Agent messages go below this as a separate section. |
| `src/components/Sidebar.jsx` | Extend `getAllSessions` or add parallel function for ACS threads. | Lines 220-260: currently merges Claude/Cursor/Codex sessions only. |
| `src/components/Sidebar.jsx` | Hook into `handleProjectSelect` for lazy ACS registration. | Lines 470-520: calls `onProjectSelect(project)` + `setCurrentProject(project)` |
| `src/components/MainContent.jsx` | Add agent thread rendering alongside chat. Extend selection path (currently keyed to `selectedSession`). | Lines 280-340: header icons keyed to `selectedSession.__provider` |
| `src/components/MainContent.jsx` | Reuse existing toast pattern for ACS notifications. Add safe-area class for mobile. | Lines 620-680: `prdNotification` toast with `fixed bottom-4 right-4 z-50` |
| `src/components/MobileNav.jsx` | No change needed (no 6th tab). | Lines ~1-200: nav items are chat/shell/files/(conditional)tasks |
| `src/components/Settings.jsx` | Add "ACS Bridges" category button under Agents tab. | Lines 1220-1430: existing categories are Account, Permissions, MCP Servers |
| `src/components/settings/ACSBridges.jsx` | **New file.** Bridge management component. | Fits alongside existing settings components |
| `src/components/AgentMessages.jsx` | **New file.** Agent message section within project view. | |
| `src/components/AgentThread.jsx` | **New file.** Threaded message view. | |
| `src/components/AgentNotification.jsx` | **New file.** Toast/banner for incoming ACS messages. | Reuses existing toast pattern from MainContent |

### Registration Strategy (resolved)

**Always-on registration** — register for all projects once project list is known:
- `getProjects` is NOT called on server startup — it runs on the first `/api/projects` request from the frontend (server/index.js line ~439) and on file watcher events. ACS registration hooks into the first successful `getProjects` call, not server init.
- Implementation: After `/api/projects` returns, the backend triggers `acsManager.registerAll(projects)` for each project with a known `repoPath`. Subsequent `getProjects` calls update registrations if projects are added/removed.
- All connections receive push notifications in background; `ACSContext` aggregates unread counts across projects
- `handleProjectSelect` (Sidebar.jsx lines 470-520) triggers inbox fetch for the selected project
- Unregister all on shutdown via the existing graceful shutdown sequence in `server/index.js` (lines 630-740)
- Connection count bounded by project count (typically < 10)

---

## Success Criteria

- [ ] User can see ACS agents for each project (when ACS is running)
- [ ] User can send messages to ACS agents from the UI
- [ ] User receives real-time notifications for incoming ACS messages
- [ ] User can manage ACS bridges from Settings
- [ ] Mobile layout is not degraded — no horizontal scrolling, no cramped UI
- [ ] Feature is fully hidden when ACS is not running
- [ ] All existing tests pass (no regressions)
