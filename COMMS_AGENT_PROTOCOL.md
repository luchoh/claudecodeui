# Agent Communication Protocol

This is the runtime protocol for AI agents connected to the **Agent Communication Service (ACS)**. Read this file on every session start, before doing any work.

ACS is an MCP server at `http://127.0.0.1:4100/mcp`. It provides agent registry with presence tracking, a message queue with threading and priorities, push notifications via filesystem events, and peer discovery across repos.

> **Bridge-driven Codex agents:** If you are a Codex agent and you do NOT have ACS tools (`register`, `send`, `check_inbox`) in your tool inventory, you are running inside a `codex app-server` managed by the ACS Codex Bridge. **Stop reading this file.** The bridge handles all ACS communication on your behalf. Focus on the task prompt you were given. Do not report missing MCP tools — this is expected.

---

## 1. Register on session start

**When:** First thing after connecting to ACS. Before any other ACS tool call.

```
Tool: register
Arguments:
  vendor:       "claude" | "codex" | "gemini" | "other"
  repo:         derive from `git remote get-url origin` or use directory name
  repoPath:     absolute path to the repo on disk
  capabilities: ["implementation", "review", "testing"]  (optional)
```

**What you get:** `{ agentId, sessionId, registered: true }`

- `agentId` format: `{vendor}-{repo}` (e.g., `claude-my-app`)
- `sessionId`: unique per MCP connection, used internally

**What if:**

- **Server is down?** The tool call will fail. Inform the user that ACS appears to be unavailable. Probe the health endpoint (`curl -sf http://127.0.0.1:4100/health`) to confirm. Continue working without ACS -- you do not depend on it.
- **Already registered?** Safe to call again. ACS upserts your record: `registeredAt` is preserved, `sessionId` and `lastSeen` are refreshed, status resets to `online`.
- **Session is stale?** If the server restarted since your last registration, you will get a new session automatically on re-initialization. Just call `register` again.

---

## 2. The work loop

After registration, your work loop is:

```
register -> discover peers -> work -> check inbox -> repeat
```

Every ACS tool call you make acts as an **implicit heartbeat**: it updates your `lastSeen` timestamp and resets your status to `online`. You do not need to send explicit heartbeats.

---

### Presence and status

Agents have three states:

| State | Meaning | How to enter | How to leave |
|-------|---------|-------------|-------------|
| **online** | Registered and actively monitoring ACS | `register()`, `set_status("online")`, or any tool call (implicit heartbeat) | Auto-decay after 5 min inactivity -> standby |
| **standby** | Registered but busy with a long task, not watching inbox | `set_status("standby")`, or auto-decay from online (5 min) | Any tool call -> online, or auto-decay after 30 min -> offline |
| **offline** | Not available. Signed off or timed out | `unregister()`, or auto-decay from standby (30 min) | `register()` -> online |

**Implicit heartbeat:** Every tool call (send, reply, check_inbox, discover, etc.) automatically updates `lastSeen` and resets status to `online`. The only exceptions are `register` (runs before you are mapped), `unregister` (you are leaving), and `set_status` (you are setting a specific state).

**Auto-decay:** ACS runs a sweep every 60 seconds:
1. Agents with status `online` and `lastSeen` older than 5 minutes -> `standby`
2. Agents with status `standby` and `lastSeen` older than 30 minutes -> `offline` (session cleared)

**Manual control:** Before starting a long task where you will not call any ACS tools for several minutes, call `set_status("standby")`. This signals to peers that you are busy but still registered. Any subsequent tool call will automatically return you to `online`.

**What if you crash without unregistering?** Auto-decay handles it. After 5 minutes of silence, you move to `standby`. After 30 more minutes, `offline`. No stale `online` ghosts.

---

### Checking inbox

**When:** Between tasks, after completing work, when idle, or after being notified of a new message.

```
Tool: check_inbox
Arguments:
  since:      ISO 8601 timestamp (optional, filter by date)
  type:       message type filter (optional)
  unreadOnly: true (default) -- only pending messages
  limit:      number of messages per page (optional, default 50)
  cursor:     pagination cursor from previous response (optional)
```

**What you get:** `{ messages: [...], nextCursor: string | null }`

Messages returned as `pending` are automatically transitioned to `delivered`.

**Handle by priority:**

| Priority | Action |
|----------|--------|
| **urgent** | Drop current work and respond immediately |
| **high** | Respond after finishing current subtask |
| **normal** | Respond between tasks |
| **low** | Respond when convenient |

**What if:**

- **Inbox is empty?** Normal. Continue working.
- **Message was already acknowledged?** It will not appear with `unreadOnly: true`. Use `unreadOnly: false` to see all messages.
- **Too many messages?** Use `limit` and `cursor` to paginate.

---

### Discovering peers

**When:** After registration to see who else is working on the same codebase. Before sending a review request. Periodically to check for new collaborators.

```
Tool: discover
Arguments:
  repo:                "my-app" (optional)
  vendor:              "claude" | "codex" | "gemini" (optional)
  capability:          "code_review" (optional)
  includeRelatedRepos: true (optional -- include agents on linked repos)
```

**How to read status:**

| Status | Meaning | What to expect |
|--------|---------|---------------|
| **online** | Active and monitoring | Fast response |
| **standby** | Busy with a task, not watching inbox | Delayed response, message will be queued |
| **offline** | Signed off or timed out | Message will be queued, no response until they return |

**What if:**

- **Peer is standby?** They are working but not actively monitoring. Send your message; they will see it when they next call `check_inbox` or when their current task finishes.
- **Peer is offline?** They are not available. Your message will be queued. Consider proceeding without waiting for a reply.
- **No peers found?** You are the only agent on this repo. Continue working solo.

---

### Sending messages

**When:** To request a review, ask a question, delegate a task, or notify peers.

```
Tool: send
Arguments:
  to:       "gemini-my-app"        (target agentId)
  type:     "review_request"       (see table below)
  subject:  "Review auth changes"
  body:     "I've refactored the auth middleware..."
  context:  { files: ["src/auth.ts"], diff: "...", branch: "feature/auth" }
  priority: "normal" (optional, default "normal")
```

**Message types:**

| Type | Use when |
|------|----------|
| `review_request` | You want a peer to review your work |
| `question` | You need help or clarification |
| `task_request` | You want to delegate a subtask |
| `notification` | FYI, no response expected |
| `review_feedback` | Responding to a review request |
| `answer` | Responding to a question |
| `task_result` | Reporting results of a delegated task |

**What you get:** `{ messageId, delivered: boolean, queued: true }`

- `delivered: true` means the recipient is online
- `delivered: false` means the recipient is offline or standby; the message is still queued

**What if:**

- **Recipient is offline?** Message is queued. They will see it when they next check inbox. `delivered` will be `false`.
- **Send fails?** The tool call will return an error. Check that the recipient agentId is correct (use `discover` first). Verify ACS is running.
- **Message body too large?** Maximum body size is 100 KB. Trim diffs or split into multiple messages.

---

### Replying

**When:** Responding to a `review_request`, `question`, or `task_request`.

```
Tool: reply
Arguments:
  messageId: "msg-abc123"    (the message you are replying to)
  body:      "Looks good, one suggestion..."
  context:   { ... }         (optional)
  type:      "review_feedback" (optional -- auto-inferred from original)
  subject:   "Re: ..."        (optional -- auto-prefixed from original)
```

**Always use `reply` instead of `send`** when responding to a message. `reply` preserves the thread, auto-routes to the sender, and infers the correct response type (`review_request` -> `review_feedback`, `question` -> `answer`, `task_request` -> `task_result`).

**What if:**

- **Original message not found?** The tool throws an error. The message may have expired (24h TTL by default) or the messageId is wrong.
- **Already acknowledged the original?** You can still reply to acknowledged messages. Reply and acknowledge are independent operations.

---

### Acknowledging

**When:** You have read and acted on a message. This tells the sender you handled it.

```
Tool: acknowledge
Arguments:
  messageId: "msg-abc123"
```

**What if:**

- **Message already acknowledged?** The operation succeeds idempotently. No error.
- **Message not found?** The tool throws an error. The message may have expired.
- **Message not addressed to you?** The tool throws an error. You can only acknowledge messages in your own inbox.

---

### Watching for notifications (push)

ACS supports filesystem-based push notifications via the `await_notification` tool. When a message arrives for you, ACS writes a notification file to `~/.agent-comms/notify/<agentId>/`. A Python watcher script blocks on kernel filesystem events (kqueue on macOS) with zero CPU usage and sub-second latency.

**Important:** Push notifications only work for agents that can block on background task output (e.g., Claude Code). Agents with a request-response execution model (Codex CLI, Gemini CLI) cannot use the watcher — see their sections below for the correct inbox polling pattern.

#### Claude Code pattern (background watcher)

**When:** ONLY after sending a message where you expect a reply (e.g., a `review_request`, `question`, or `task_request`). Do not run the watcher by default.

1. **Call `await_notification`:**
   ```
   Tool: await_notification
   Arguments: { timeoutSeconds: 600 }  (optional, default 600 for Claude Code)
   ```
   You receive: `{ status, notifyDir, watchCommand, instructions }`

2. **Launch background watcher:**
   ```
   Bash(command=watchCommand, run_in_background=true)
   ```
   You receive: `task_id`

3. **Block and wait:**
   ```
   TaskOutput(task_id=task_id, block=true, timeout=600000)
   ```
   Blocks until a notification arrives or timeout.

4. **Process the result:**
   Parse the JSON output, then call `check_inbox` to get the full messages.

5. **Repeat** from step 1 if still expecting more replies.

**What if:**

- **Watcher returns `[]`?** Timeout, no notifications. Loop back to step 1.
- **`check_inbox` returns nothing?** False wakeup (notification was for a previously processed message). Loop back to step 1.
- **Watcher script is missing?** The server may have restarted. Call `await_notification` again to get a fresh `watchCommand`.
- **User presses Esc?** The background task is interrupted. Re-run from step 1 when ready.

**Limitation:** While blocking on `TaskOutput`, user input is blocked. The user must press Esc to interrupt.

#### Codex pattern

##### If you are running inside `codex app-server` (bridge-driven) — SKIP ACS entirely

**How to detect:** You have no MCP tools in your tool inventory (no `register`, `send`, `check_inbox`, etc.), and you received a task prompt rather than interactive user input. This means you are running inside a `codex app-server` subprocess managed by the ACS Codex Bridge.

**What to do:** The bridge handles ALL ACS communication on your behalf — registration, inbox polling, message sending, and replies. You do NOT have access to ACS MCP tools and you do NOT need them. **Do not attempt to register, discover peers, check inbox, or send messages.** Do not report MCP tools as missing — this is expected, not an error.

**Your only job is to respond to the task prompt.** The bridge will take your response and route it back through ACS as a reply to the original sender.

**Do NOT** look for `.codex/config.toml`, `.mcp.json`, or any other MCP configuration. Even if those files exist in the repo, they are irrelevant to your execution context. Ignore them.

##### If you are using Codex CLI directly (bridge NOT enabled)

Codex CLI uses a request-response execution model. Each turn is driven by user input. Codex cannot autonomously loop on subprocess output — a background watcher would receive notifications but has no way to feed them back into Codex's reasoning. Do NOT use `await_notification`.

**Instead, poll your inbox at natural breakpoints:**

1. Call `check_inbox` **before starting** a new task.
2. Call `check_inbox` **after completing** a task.
3. When you have sent a message and are **waiting for a reply**, tell the user:
   ```
   I've sent a review request to claude-my-app. I'll check for their
   reply next time I run. You can prompt me with "check inbox" to
   check sooner.
   ```
4. When the user prompts you (or at the start of your next turn), call `check_inbox` and process any replies.

**Why not `await_notification` for direct Codex CLI?** The watcher subprocess detects filesystem events correctly, but it runs as an isolated process — its output does not re-enter your reasoning loop. The notification arrives, but you never see it. This gives an illusion of real-time listening without the substance.

**What if:**

- **You need a fast reply?** Tell the user to prompt you once the peer has responded. The user is your event loop.
- **Peer is offline?** Proceed with your work. Check inbox on your next turn.
- **Multiple messages queued?** `check_inbox` returns them all. Handle by priority.
- **Bridge is enabled but Codex isn't responding?** Check ACS logs for bridge errors. The bridge runs in degraded mode if the App Server fails to start — ACS continues serving other agents normally.

#### Gemini CLI pattern (inbox polling — no watcher)

Same constraints as Codex CLI. Gemini CLI is also request-response and cannot autonomously act on subprocess output. Follow the same inbox polling pattern described above.

#### Fallback: polling watcher

If `await_notification` is unavailable or your runtime cannot execute shell commands, use the polling watcher script:

```bash
#!/bin/bash
# acs-inbox-watch.sh -- polls ACS inbox, exits with message content when found
# Usage: bash acs-inbox-watch.sh <agent-id> [poll-interval-seconds]

AGENT_ID="${1:?Usage: acs-inbox-watch.sh <agent-id> [poll-interval]}"
POLL_INTERVAL="${2:-15}"
ACS_URL="${ACS_URL:-http://127.0.0.1:4100}"

while true; do
  result=$(curl -sf "${ACS_URL}/admin/api/messages?to=${AGENT_ID}&limit=5" 2>/dev/null)
  if [ $? -eq 0 ]; then
    unread=$(echo "$result" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    msgs = data.get('messages', data) if isinstance(data, dict) else data
    unread = [m for m in msgs if m.get('status') == 'pending']
    if unread:
        json.dump(unread, sys.stdout)
except: pass
" 2>/dev/null)
    if [ -n "$unread" ] && [ "$unread" != "[]" ]; then
      echo "$unread"
      exit 0
    fi
  fi
  sleep "$POLL_INTERVAL"
done
```

The polling watcher and push notifications are complementary -- both ultimately lead to `check_inbox` to retrieve the actual message.

---

## 3. Sign off

**When:** Your session is ending, the user dismissed you, or you are done with your task.

```
Tool: unregister
```

This marks you as `offline` and clears your session, but preserves your record for future discovery.

**What if:**

- **You cannot reach the server?** Auto-decay handles it. After 5 minutes without a tool call, you will transition to `standby`. After 30 more minutes, `offline`. No action needed from you.
- **You forgot to unregister?** Same as above. Auto-decay cleans up.

---

## Error handling and recovery

**Important: Always try the MCP tool call first.** Do not pre-flight with `curl` or other shell probes. If the MCP tools are listed in your tool inventory, they are connected and ready. Some CLI tools (e.g., Codex) run shell commands in a network sandbox that cannot reach `localhost:4100`, but MCP tools work because they use a STDIO bridge that runs outside the sandbox. A failed `curl` does not mean ACS is down — it may just mean the sandbox blocks network access.

### Server is down

If a `register` or other ACS tool call fails with a connection error, ACS may be down. As a diagnostic (not a prerequisite), you can try probing the health endpoint from the shell:

```bash
curl -sf http://127.0.0.1:4100/health
```

If both the tool call and the probe fail, inform the user that ACS appears to be down and ask them to start it. Continue working without ACS -- agent communication is not required for your primary tasks.

**Note:** If the probe fails but MCP tool calls succeed, you are in a sandboxed shell environment. Ignore the probe result and use the MCP tools normally.

### Stale session

If the ACS server restarted since your last registration, non-`register` tool calls will fail with "Agent not registered." Fix: call `register` again. Your previous registration data is preserved.

For Claude Code specifically: if MCP connections are broken, the user can run `/mcp reset agent-comms` to reinitialize.

### Crash recovery

If you (or ACS) crashed:
1. Auto-decay has already transitioned your old status to `standby` or `offline`.
2. Call `register` again to rejoin as `online`.
3. Call `check_inbox` to retrieve any messages that arrived while you were away.

### MCP connection issues

- **Claude Code:** `/mcp reset agent-comms` to reinitialize the MCP connection.
- **Codex CLI:** Restart the CLI session. Ensure `.codex/config.toml` has the correct config.
- **Gemini CLI:** Restart the CLI session. Check `~/.gemini/settings.json`.

---

## Tool reference

| Tool | Purpose | Requires registration? |
|------|---------|----------------------|
| `register` | Join the network | No (this *is* registration) |
| `unregister` | Leave cleanly | Yes |
| `discover` | Find peers | No (but you should register first) |
| `whoami` | Check your own registration | Yes |
| `send` | Direct message to a specific agent | Yes |
| `check_inbox` | Poll for incoming messages | Yes |
| `reply` | Respond to a message (preserves thread) | Yes |
| `broadcast` | Message all agents on a repo | Yes |
| `acknowledge` | Mark a message as handled | Yes |
| `link_repos` | Declare a relationship between two repos | Yes |
| `get_related_repos` | Find repos linked to a given repo | No |
| `await_notification` | Get a watcher command that blocks until a notification arrives | Yes |
| `set_status` | Set your availability status (online or standby) | Yes |
