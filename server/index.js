#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

console.log('PORT from env:', process.env.PORT);

const PROJECTS_TIMING_ENABLED = process.env.PROJECTS_TIMING === 'true';
const PROJECTS_TIMING_LOG_PATH = process.env.PROJECTS_TIMING_LOG_PATH || '/tmp/claudecodeui-projects-timing.log';
const projectsTimingNowMs = () => Number(process.hrtime.bigint()) / 1e6;
const appendProjectsHttpTimingLog = (line) => {
  try {
    fs.appendFileSync(PROJECTS_TIMING_LOG_PATH, `${line}\n`);
  } catch (error) {
    // Ignore logging failures
  }
};
const logProjectsHttpTiming = (payload) => {
  if (!PROJECTS_TIMING_ENABLED) return;
  try {
    const line = `[projects-http-timing] ${JSON.stringify(payload)}`;
    console.log(line);
    appendProjectsHttpTimingLog(line);
  } catch (error) {
    const fallback = '[projects-http-timing] {"error":"failed to serialize timing payload"}';
    console.log(fallback);
    appendProjectsHttpTimingLog(fallback);
  }
};
let projectsTimingSeq = 0;

import express from 'express';
import { WebSocketServer } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { spawn } from 'child_process';

import { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteProject, addProjectManually } from './projects.js';
// SEC-007: Git routes removed per user mandate (unnecessary bloat)
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import cursorRoutes from './routes/cursor.js';
import taskmasterRoutes from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectsRoutes, { WORKSPACES_ROOT, validateWorkspacePath } from './routes/projects.js';
// SEC-007: cloneProgressHandler removed - GitHub cloning functionality removed per user mandate
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import codexRoutes from './routes/codex.js';
import filesRoutes from './routes/files.js';
import uploadsRoutes from './routes/uploads.js';
import tokenUsageRoutes from './routes/token-usage.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket, authenticateWebSocketWithTicket, validateSecurityConfig } from './middleware/auth.js';
import { authRateLimiter, generalRateLimiter, errorSanitizer } from './middleware/security.js';
import { IS_PLATFORM } from './constants/config.js';

// Extracted modules
import { ALLOWED_ORIGINS, isOriginFromAllowedNetwork, BIND_HOST } from './utils/security.js';
import { broadcastProgress, setupProjectsWatcher, closeProjectWatcher } from './services/projectWatcher.js';
import { setupWebSocketRouting } from './ws/router.js';

const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (IS_PLATFORM) {
            const user = authenticateWebSocket(null); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Parse URL to determine path and get ticket
        const url = new URL(info.req.url, 'http://localhost');
        const pathname = url.pathname;

        // SEC-005: Use ticket-based authentication only (legacy token auth removed)
        const ticket = url.searchParams.get('ticket');

        // Determine purpose based on path
        const purpose = pathname === '/shell' ? 'shell' : 'websocket';

        if (!ticket) {
            console.log('[WARN] WebSocket authentication failed: no ticket provided');
            return false;
        }

        // Ticket-based auth
        const user = authenticateWebSocketWithTicket(ticket, purpose);
        if (!user) {
            console.log('[WARN] WebSocket ticket authentication failed');
            return false;
        }
        info.req.user = user;
        console.log('[OK] WebSocket ticket authenticated for user:', user.username);
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

// SEC-003: CORS restriction with explicit origin whitelist + network ranges
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, same-origin)
    if (!origin) return callback(null, true);
    // Check explicit whitelist
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Check network ranges (SEC-003b)
    if (isOriginFromAllowedNetwork(origin)) return callback(null, true);
    console.warn(`[SECURITY] CORS blocked request from origin: ${origin}`);
    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));

// SEC-005: Security headers with Content Security Policy
// Gate unsafe-inline/eval to development only
const isDev = process.env.NODE_ENV !== 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // SEC-005: Only allow unsafe-inline/eval in development (required for React dev tools)
      scriptSrc: isDev
        ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
        : ["'self'"],
      styleSrc: isDev
        ? ["'self'", "'unsafe-inline'"]
        : ["'self'"],
      connectSrc: ["'self'"], // SEC: Tightened from wildcard ws:/wss:/http:/https:
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false, // May need adjustment for external resources
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } // Allow OAuth popups
}));

// SEC-009: Apply general rate limiting to all API routes
app.use('/api', generalRateLimiter);

// SEC-006: Cookie parser (required for CSRF protection)
app.use(cookieParser());

// SEC-006: CSRF protection for state-changing operations
const isProduction = process.env.NODE_ENV === 'production';
// SEC: Derive a CSRF-specific secret from JWT_SECRET to avoid reusing the JWT secret directly
const CSRF_SECRET = process.env.CSRF_SECRET || (process.env.JWT_SECRET ? crypto.createHmac('sha256', process.env.JWT_SECRET).update('csrf-secret').digest('hex') : undefined);
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  cookieName: isProduction ? '__Host-csrf' : 'csrf',
  cookieOptions: {
    httpOnly: false, // Must be false so JS can read it for the header
    sameSite: 'strict',
    secure: isProduction,
    path: '/'
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  getSessionIdentifier: (req) => req.ip || 'anonymous' // Use IP as session identifier
});

// SEC-006: Route to get CSRF token (must be called before state-changing requests)
app.get('/api/csrf-token', (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
});

// SEC-006: Apply CSRF protection to state-changing API routes
// Exclude routes that use their own auth (agent API uses API keys, WebSocket uses tickets)
app.use('/api/projects', (req, res, next) => {
  if (!PROJECTS_TIMING_ENABLED) {
    return next();
  }

  const timingId = ++projectsTimingSeq;
  const startMs = projectsTimingNowMs();
  res.locals.projectsTiming = { id: timingId, startMs };

  logProjectsHttpTiming({
    event: 'request_start',
    id: timingId,
    method: req.method,
    path: req.originalUrl
  });

  res.on('finish', () => {
    logProjectsHttpTiming({
      event: 'request_finish',
      id: timingId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(projectsTimingNowMs() - startMs)
    });
  });

  next();
});

app.use('/api/projects', doubleCsrfProtection);
// SEC-007: Git CSRF protection removed (git routes removed)
app.use('/api/settings', doubleCsrfProtection);
app.use('/api/user', doubleCsrfProtection);
app.use('/api/taskmaster', doubleCsrfProtection);

app.use(express.json({
  limit: '50mb',
  type: (req) => {
    // Skip multipart/form-data requests (for file uploads like images)
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return false;
    }
    return contentType.includes('json');
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public, with stricter rate limiting)
app.use('/api/auth', authRateLimiter, authRoutes);

// SEC-007: Clone-progress route removed - GitHub cloning functionality removed per user mandate

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// SEC-007: Git API Routes removed per user mandate

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// Cursor API Routes (protected)
app.use('/api/cursor', authenticateToken, cursorRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// File operations routes (browse-filesystem, create-folder, file read/write/list)
app.use('/api', filesRoutes);

// Upload routes (transcribe, upload-images)
app.use('/api', uploadsRoutes);

// Token usage routes
app.use('/api', tokenUsageRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(__dirname, '../public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(__dirname, '../dist'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // Prevent HTML caching to avoid service worker issues after builds
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
      // Cache static assets for 1 year (they have hashed names)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// SEC-008: System update endpoint (disabled by default)
app.post('/api/system/update', authenticateToken, async (req, res) => {
    // Check if system update is explicitly enabled
    if (process.env.ENABLE_SYSTEM_UPDATE !== 'true') {
        console.warn(`[SECURITY] System update attempted by user ${req.user.id} but endpoint is disabled`);
        return res.status(403).json({
            error: 'System update endpoint is disabled',
            message: 'Set ENABLE_SYSTEM_UPDATE=true to enable this endpoint'
        });
    }

    try {
        console.log(`[INFO] System update initiated by user ${req.user.id}`);
        // Get the project root directory (parent of server directory)
        const projectRoot = path.join(__dirname, '..');

        console.log('Starting system update from directory:', projectRoot);

        // Run the update command
        const updateCommand = 'git checkout main && git pull && npm install';

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: projectRoot,
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const timing = res.locals.projectsTiming;
        const handlerStartMs = projectsTimingNowMs();
        if (timing) {
            logProjectsHttpTiming({
                event: 'handler_start',
                id: timing.id
            });
        }

        const projects = await getProjects(broadcastProgress);

        if (timing) {
            logProjectsHttpTiming({
                event: 'handler_getProjects_complete',
                id: timing.id,
                ms: Math.round(projectsTimingNowMs() - handlerStartMs),
                projects: projects.length
            });
        }
        res.json(projects);
    } catch (error) {
        const timing = res.locals.projectsTiming;
        if (timing) {
            logProjectsHttpTiming({
                event: 'handler_error',
                id: timing.id,
                error: error.message
            });
        }
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;

        const result = await getSessionMessages(projectName, sessionId, parsedLimit, parsedOffset);

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            // Backward compatibility: no pagination parameters were provided
            res.json({ messages: result });
        } else {
            // New format with pagination info
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName } = req.body;
        await renameProject(req.params.projectName, displayName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}`);
        await deleteSession(projectName, sessionId);
        console.log(`[API] Session ${sessionId} deleted successfully`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (force=true to delete with sessions)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        await deleteProject(projectName, force);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        // SEC: Validate workspace path before adding project
        const validation = await validateWorkspacePath(projectPath.trim());
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }

        const project = await addProjectManually(projectPath.trim());
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
  // Skip requests for static assets (files with extensions)
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }

  // Only serve index.html for HTML routes, not for static assets
  // Static assets should already be handled by express.static middleware above
  const indexPath = path.join(__dirname, '../dist/index.html');

  // Check if dist/index.html exists (production build available)
  if (fs.existsSync(indexPath)) {
    // Set no-cache headers for HTML to prevent service worker issues
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  } else {
    // In development, redirect to Vite dev server only if dist doesn't exist
    res.redirect(`http://localhost:${process.env.VITE_PORT || 5173}`);
  }
});

// SEC-010: Error sanitization middleware (must be after all routes)
app.use(errorSanitizer);

// Setup WebSocket routing (chat + shell handlers)
setupWebSocketRouting(wss);

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
    try {
        // SEC-001, SEC-017: Validate security configuration before anything else
        validateSecurityConfig();

        // Initialize authentication database
        await initializeDatabase();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(__dirname, '../dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        // SEC-004: Warn if binding to all interfaces
        if (BIND_HOST === '0.0.0.0') {
            console.warn('');
            console.warn(c.warn('\u2550'.repeat(70)));
            console.warn(`${c.warn('[SECURITY]')} Server binding to 0.0.0.0 (all interfaces)`);
            console.warn(`${c.warn('[SECURITY]')} This exposes the server to the network. Use a reverse proxy in production.`);
            console.warn(c.warn('\u2550'.repeat(70)));
            console.warn('');
        }

        server.listen(PORT, BIND_HOST, async () => {
            const appInstallPath = path.join(__dirname, '..');

            console.log('');
            console.log(c.dim('\u2550'.repeat(63)));
            console.log(`  ${c.bright('Claude Code UI Server - Ready')}`);
            console.log(c.dim('\u2550'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright(`http://${BIND_HOST}:${PORT}`)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
let shutdownInProgress = false;

async function gracefulShutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`\n[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

    // 1. Stop accepting new connections
    server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed');
    });

    // 2. Close all WebSocket connections
    wss.clients.forEach(client => {
        try {
            client.close(1001, 'Server shutting down');
        } catch (e) {
            // Ignore errors during shutdown
        }
    });
    console.log('[SHUTDOWN] WebSocket connections closed');

    // 3. Kill all PTY sessions
    try {
        const { ptySessionsMap } = await import('./ws/shellHandler.js');
        for (const [key, session] of ptySessionsMap) {
            try {
                if (session.timeoutId) clearTimeout(session.timeoutId);
                if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId);
                if (session.pty && session.pty.kill) session.pty.kill();
            } catch (e) {
                // Ignore errors during shutdown
            }
        }
        ptySessionsMap.clear();
    } catch (e) { /* ignore */ }
    console.log('[SHUTDOWN] PTY sessions cleaned up');

    // 4. Abort all active SDK sessions
    try {
        const { getActiveClaudeSDKSessions, abortClaudeSDKSession } = await import('./claude-sdk.js');
        const activeClaude = getActiveClaudeSDKSessions();
        for (const sessionId of activeClaude) {
            await abortClaudeSDKSession(sessionId).catch(() => {});
        }
    } catch (e) { /* ignore */ }

    try {
        const { getActiveCursorSessions, abortCursorSession } = await import('./cursor-cli.js');
        const activeCursor = getActiveCursorSessions();
        for (const sessionId of activeCursor) {
            abortCursorSession(sessionId);
        }
    } catch (e) { /* ignore */ }

    try {
        const { getActiveCodexSessions, abortCodexSession } = await import('./openai-codex.js');
        const activeCodex = getActiveCodexSessions();
        for (const session of activeCodex) {
            abortCodexSession(session.id);
        }
    } catch (e) { /* ignore */ }
    console.log('[SHUTDOWN] Active sessions aborted');

    // 5. Close file watcher
    try {
        await closeProjectWatcher();
    } catch (e) { /* ignore */ }

    // 6. Close database
    try {
        const { closeDatabase } = await import('./database/db.js');
        if (typeof closeDatabase === 'function') {
            closeDatabase();
        }
    } catch (e) { /* ignore */ }

    // 7. Clean up Codex session cleanup interval
    try {
        const { cleanupCodexSessions } = await import('./openai-codex.js');
        if (typeof cleanupCodexSessions === 'function') {
            cleanupCodexSessions();
        }
    } catch (e) { /* ignore */ }

    console.log('[SHUTDOWN] Cleanup complete, exiting...');
    process.exit(0);
}

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    gracefulShutdown('unhandledRejection');
});

startServer();
