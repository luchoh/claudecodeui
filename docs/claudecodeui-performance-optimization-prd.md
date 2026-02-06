# PRD: Claude Code UI Project Loading Performance Optimization

## Status
- Draft (blocked on HTTP + CPU profiling because server/client are not running).

## Problem Statement
Projects take an unacceptable amount of time to load. Current in-process profiling of `getProjects()` shows ~20.4s for 6 projects, dominated by repeated Codex session scans.

## Goals
- Reduce end-to-end `/api/projects` latency to single-digit seconds on this dataset.
- Reduce in-process `getProjects()` time to under 3s for 6 projects.
- Maintain functional parity of project, session, Codex, Cursor, and TaskMaster data.

## Non-Goals
- UI redesign.
- Removing Codex/Cursor/TaskMaster features.

## Constraints
- Do not start/stop long-running services (managed by `devenv up`).
- Timing logs are gated by `PROJECTS_TIMING=true` and optional `PROJECTS_TIMING_LOG_PATH`.

## Current Measurements (Evidence)
### In-process `getProjects()` timing (no HTTP/middleware)
Command:
```sh
PROJECTS_TIMING=true PROJECTS_TIMING_LOG_PATH=/tmp/claudecodeui-projects-timing.log node --input-type=module - <<'NODE'
process.env.PROJECTS_TIMING = 'true';
process.env.PROJECTS_TIMING_LOG_PATH = '/tmp/claudecodeui-projects-timing.log';
const { getProjects } = await import('./server/projects.js');
const start = process.hrtime.bigint();
const projects = await getProjects();
const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
console.log(`[projects-timing] ${JSON.stringify({ event: 'script_total', ms, projects: projects.length })}`);
NODE
```
Output (excerpt, full log at `/tmp/claudecodeui-projects-timing.log`):
```text
[projects-timing] {"event":"getProjects_complete","ms":20400,"totalProjects":6}
[projects-timing] {"event":"script_total","ms":20400,"projects":6}
```

### Codex session scans are repeated for each project
Command:
```sh
rg -n "getCodexSessions\"" /tmp/claudecodeui-projects-timing.log
```
Output (excerpt):
```text
[projects-timing] {"event":"getCodexSessions","projectPath":"/Users/luchoh","ms":3091,"findMs":13,"jsonlFiles":144,"parsedFiles":144,"parseMs":3076,"matchedSessions":3,"returnedSessions":3,"limit":5}
[projects-timing] {"event":"getCodexSessions","projectPath":"/Users/luchoh/Dev/claudecodeui","ms":2902,"findMs":3,"jsonlFiles":144,"parsedFiles":144,"parseMs":2898,"matchedSessions":4,"returnedSessions":4,"limit":5}
[projects-timing] {"event":"getCodexSessions","projectPath":"/Users/luchoh/Dev/quantum-iqm","ms":2938,"findMs":3,"jsonlFiles":144,"parsedFiles":144,"parseMs":2934,"matchedSessions":33,"returnedSessions":5,"limit":5}
```

### A single project has expensive `extractProjectDirectory` scanning
Command:
```sh
rg -n "extractProjectDirectory\"|quantum-iqm" /tmp/claudecodeui-projects-timing.log
```
Output:
```text
[projects-timing] {"event":"extractProjectDirectory","project":"-Users-luchoh-Dev-quantum-iqm","ms":1996,"jsonlFiles":60,"jsonlLines":66527,"cwdVariants":6,"usedFallback":false}
```

## Missing HTTP + CPU Profiling (Blocked)
The services are not currently running, so HTTP/middleware and CPU profiling are blocked.

Evidence:
```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/api/projects
```
Output:
```text
000
```
```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5177
```
Output:
```text
000
```
```sh
ps -ax -o pid,ppid,command | rg -n "node .*server/index.js|vite --host|npm run client|npm run server|claudecodeui"
```
Output:
```text
```
```sh
ls /var/folders/p6/27mkyy9n4rlghhs7hljj2nk40000gn/T/devenv-e0f5535
```
Output:
```text
shell
```

## Proposed Optimizations
1) Codex session indexing (highest impact)
- Build a single in-memory index of Codex sessions once per `/api/projects` request and reuse it for each project.
- Avoid re-parsing all Codex JSONL files per project.

2) Project directory extraction caching
- Persist last-known `cwd` per project with file mtime checks to avoid rescanning large JSONL histories on each cold start.

3) Parallelize per-project sub-steps
- Fetch sessions, Cursor sessions, Codex sessions, and TaskMaster detection in parallel per project with a bounded concurrency limit.

4) Optional lazy-loading flags
- Add query params to `/api/projects` to skip Codex or TaskMaster data during initial load and fetch lazily when needed.

## Measurement Plan (to run once services are up)
### HTTP/middleware timing
- Use existing `PROJECTS_TIMING=true` logs from `/api/projects` requests.

### CPU profiling of server and client
Commands to execute (once processes are running):
```sh
ps -ax -o pid,ppid,command | rg -n "node .*server/index.js|vite --host|npm run client"
```
```sh
top -l 5 -pid <server_pid> -stats pid,command,cpu,threads,mem
```
```sh
top -l 5 -pid <client_pid> -stats pid,command,cpu,threads,mem
```
```sh
sample <server_pid> 5 -file /tmp/claudecodeui-sample-server.txt
```
```sh
sample <client_pid> 5 -file /tmp/claudecodeui-sample-client.txt
```

## Success Metrics
- `/api/projects` request time reduced by at least 5x on the same dataset.
- `getProjects()` in-process time reduced from ~20.4s to <3s for 6 projects.

## Risks
- Caching or indexing could return stale session data if not invalidated correctly.
- Parallelization could increase peak IO usage; must limit concurrency.

## Rollout Plan
1) Implement Codex session indexing behind a feature flag.
2) Add cache invalidation for `extractProjectDirectory` using file mtimes.
3) Measure impact with `PROJECTS_TIMING` logs and HTTP timings.
4) Remove flag after successful validation.

## Open Questions
- Need HTTP/middleware timing output and CPU samples once `devenv up` is running.
- Should Codex/TaskMaster data be optional on initial load?
