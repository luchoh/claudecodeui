import { WebSocket } from 'ws';
import { connectedClients } from '../services/projectWatcher.js';
import { queryClaudeSDK, abortClaudeSDKSession, isClaudeSDKSessionActive, getActiveClaudeSDKSessions, resolveToolApproval } from '../claude-sdk.js';
import { spawnCursor, abortCursorSession, isCursorSessionActive, getActiveCursorSessions } from '../cursor-cli.js';
import { queryCodex, abortCodexSession, isCodexSessionActive, getActiveCodexSessions } from '../openai-codex.js';
import { validateChatMessage } from '../middleware/ws-validation.js';

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 */
export class WebSocketWriter {
  constructor(ws) {
    this.ws = ws;
    this.sessionId = null;
    this.isWebSocketWriter = true;  // Marker for transport detection
  }

  send(data) {
    if (this.ws.readyState === 1) { // WebSocket.OPEN
      // Providers send raw objects, we stringify for WebSocket
      this.ws.send(JSON.stringify(data));
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }
}

// Handle chat WebSocket connections
export function handleChatConnection(ws) {
    console.log('[INFO] Chat WebSocket connected');

    // Add to connected clients for project updates
    connectedClients.add(ws);

    // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
    const writer = new WebSocketWriter(ws);

    ws.on('message', async (message) => {
        try {
            // SEC-015: Validate message with Zod schema
            const validationResult = validateChatMessage(message.toString());
            if (!validationResult.success) {
                console.warn('[SECURITY] Invalid chat message format:', validationResult.error);
                writer.send({
                    type: 'error',
                    error: `Invalid message format: ${validationResult.error}`
                });
                return;
            }
            const data = validationResult.data;

            if (data.type === 'claude-command') {
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('\u{1F4C1} Project:', data.options?.projectPath || 'Unknown');
                console.log('\u{1F504} Session:', data.options?.sessionId ? 'Resume' : 'New');

                // Use Claude Agents SDK
                await queryClaudeSDK(data.command, data.options, writer);
            } else if (data.type === 'cursor-command') {
                console.log('[DEBUG] Cursor message:', data.command || '[Continue/Resume]');
                console.log('\u{1F4C1} Project:', data.options?.cwd || 'Unknown');
                console.log('\u{1F504} Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('\u{1F916} Model:', data.options?.model || 'default');
                await spawnCursor(data.command, data.options, writer);
            } else if (data.type === 'codex-command') {
                console.log('[DEBUG] Codex message:', data.command || '[Continue/Resume]');
                console.log('\u{1F4C1} Project:', data.options?.projectPath || data.options?.cwd || 'Unknown');
                console.log('\u{1F504} Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('\u{1F916} Model:', data.options?.model || 'default');
                await queryCodex(data.command, data.options, writer);
            } else if (data.type === 'cursor-resume') {
                // Backward compatibility: treat as cursor-command with resume and no prompt
                console.log('[DEBUG] Cursor resume session (compat):', data.sessionId);
                await spawnCursor('', {
                    sessionId: data.sessionId,
                    resume: true,
                    cwd: data.options?.cwd
                }, writer);
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = data.provider || 'claude';
                let success;

                if (provider === 'cursor') {
                    success = abortCursorSession(data.sessionId);
                } else if (provider === 'codex') {
                    success = abortCodexSession(data.sessionId);
                } else {
                    // Use Claude Agents SDK
                    success = await abortClaudeSDKSession(data.sessionId);
                }

                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider,
                    success
                });
            } else if (data.type === 'claude-permission-response') {
                // Relay UI approval decisions back into the SDK control flow.
                // This does not persist permissions; it only resolves the in-flight request,
                // introduced so the SDK can resume once the user clicks Allow/Deny.
                if (data.requestId) {
                    resolveToolApproval(data.requestId, {
                        allow: Boolean(data.allow),
                        updatedInput: data.updatedInput,
                        message: data.message,
                        rememberEntry: data.rememberEntry
                    });
                }
            } else if (data.type === 'cursor-abort') {
                console.log('[DEBUG] Abort Cursor session:', data.sessionId);
                const success = abortCursorSession(data.sessionId);
                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider: 'cursor',
                    success
                });
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const provider = data.provider || 'claude';
                const sessionId = data.sessionId;
                let isActive;

                if (provider === 'cursor') {
                    isActive = isCursorSessionActive(sessionId);
                } else if (provider === 'codex') {
                    isActive = isCodexSessionActive(sessionId);
                } else {
                    // Use Claude Agents SDK
                    isActive = isClaudeSDKSessionActive(sessionId);
                }

                writer.send({
                    type: 'session-status',
                    sessionId,
                    provider,
                    isProcessing: isActive
                });
            } else if (data.type === 'get-active-sessions') {
                // Get all currently active sessions
                const activeSessions = {
                    claude: getActiveClaudeSDKSessions(),
                    cursor: getActiveCursorSessions(),
                    codex: getActiveCodexSessions()
                };
                writer.send({
                    type: 'active-sessions',
                    sessions: activeSessions
                });
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            writer.send({
                type: 'error',
                error: error.message
            });
        }
    });

    ws.on('close', () => {
        console.log('\u{1F50C} Chat client disconnected');
        // Remove from connected clients
        connectedClients.delete(ws);
    });
}
