import pty from 'node-pty';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import {
    isValidSessionId,
    isAllowedWorkspacePath,
    validatePtyCommand,
    escapeShellArg,
    escapePowerShellArg,
    PTY_IDLE_TIMEOUT
} from '../utils/security.js';
import { validateShellMessage } from '../middleware/ws-validation.js';

export const ptySessionsMap = new Map();
export const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;

// Handle shell WebSocket connections
export function handleShellConnection(ws) {
    console.log('\u{1F41A} Shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let outputBuffer = [];

    ws.on('message', async (message) => {
        try {
            // SEC-015: Validate message with Zod schema
            const validationResult = validateShellMessage(message.toString());
            if (!validationResult.success) {
                console.warn('[SECURITY] Invalid shell message format:', validationResult.error);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid message format: ${validationResult.error}`
                }));
                return;
            }
            const data = validationResult.data;
            console.log('\u{1F4E8} Shell message received:', data.type);

            if (data.type === 'init') {
                const projectPath = data.projectPath || process.cwd();
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const provider = data.provider || 'claude';
                const initialCommand = data.initialCommand;
                const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';

                // SEC-006: Validate sessionId format
                if (sessionId && !isValidSessionId(sessionId)) {
                    console.warn(`[SECURITY] Rejected invalid sessionId: ${sessionId}`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid session ID format'
                    }));
                    ws.close();
                    return;
                }

                // SEC-006: Validate workspace path
                if (!isAllowedWorkspacePath(projectPath)) {
                    console.warn(`[SECURITY] Rejected path outside allowed workspace: ${projectPath}`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Path not in allowed workspace. Check WORKSPACES_ROOT configuration.'
                    }));
                    ws.close();
                    return;
                }

                // SEC-006: Validate command if plain shell mode
                if (isPlainShell && initialCommand) {
                    const cmdResult = validatePtyCommand(initialCommand);
                    if (!cmdResult.valid) {
                        console.warn(`[SECURITY] Rejected command: ${cmdResult.error}`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: cmdResult.error
                        }));
                        ws.close();
                        return;
                    }
                }

                // Login commands (Claude/Cursor auth) should never reuse cached sessions
                const isLoginCommand = initialCommand && (
                    initialCommand.includes('setup-token') ||
                    initialCommand.includes('cursor-agent login') ||
                    initialCommand.includes('auth login')
                );

                // Include command hash in session key so different commands get separate sessions
                const commandSuffix = isPlainShell && initialCommand
                    ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                    : '';
                ptySessionKey = `${projectPath}_${sessionId || 'default'}${commandSuffix}`;

                // Kill any existing login session before starting fresh
                if (isLoginCommand) {
                    const oldSession = ptySessionsMap.get(ptySessionKey);
                    if (oldSession) {
                        console.log('\u{1F9F9} Cleaning up existing login session:', ptySessionKey);
                        if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                        if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                        ptySessionsMap.delete(ptySessionKey);
                    }
                }

                const existingSession = isLoginCommand ? null : ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('\u267B\uFE0F  Reconnecting to existing PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;

                    clearTimeout(existingSession.timeoutId);

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                    }));

                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        console.log(`\u{1F4DC} Sending ${existingSession.buffer.length} buffered messages`);
                        existingSession.buffer.forEach(bufferedData => {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: bufferedData
                            }));
                        });
                    }

                    existingSession.ws = ws;

                    return;
                }

                console.log('[INFO] Starting shell in:', projectPath);
                console.log('\u{1F4CB} Session info:', hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session'));
                console.log('\u{1F916} Provider:', isPlainShell ? 'plain-shell' : provider);
                if (initialCommand) {
                    console.log('\u26A1 Initial command:', initialCommand);
                }

                // First send a welcome message
                let welcomeMsg;
                if (isPlainShell) {
                    welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                } else {
                    const providerName = provider === 'cursor' ? 'Cursor' : 'Claude';
                    welcomeMsg = hasSession ?
                        `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                        `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                }

                ws.send(JSON.stringify({
                    type: 'output',
                    data: welcomeMsg
                }));

                try {
                    // Prepare the shell command adapted to the platform and provider
                    // SEC-006: Use proper escaping for all user-supplied values
                    let shellCommand;
                    const isWindows = os.platform() === 'win32';
                    const escapedPath = isWindows ? escapePowerShellArg(projectPath) : escapeShellArg(projectPath);

                    if (isPlainShell) {
                        // Plain shell mode - command already validated by validatePtyCommand
                        if (isWindows) {
                            shellCommand = `Set-Location -Path ${escapedPath}; ${initialCommand}`;
                        } else {
                            shellCommand = `cd ${escapedPath} && ${initialCommand}`;
                        }
                    } else if (provider === 'cursor') {
                        // Use cursor-agent command
                        if (isWindows) {
                            if (hasSession && sessionId) {
                                // sessionId already validated by isValidSessionId
                                const escapedSessionId = escapePowerShellArg(sessionId);
                                shellCommand = `Set-Location -Path ${escapedPath}; cursor-agent --resume=${escapedSessionId}`;
                            } else {
                                shellCommand = `Set-Location -Path ${escapedPath}; cursor-agent`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                // sessionId already validated by isValidSessionId
                                const escapedSessionId = escapeShellArg(sessionId);
                                shellCommand = `cd ${escapedPath} && cursor-agent --resume=${escapedSessionId}`;
                            } else {
                                shellCommand = `cd ${escapedPath} && cursor-agent`;
                            }
                        }
                    } else {
                        // Claude provider (default)
                        // SEC-006: Validate initialCommand even in non-plain-shell mode
                        let command = 'claude';
                        if (initialCommand) {
                            const cmdResult = validatePtyCommand(initialCommand);
                            if (!cmdResult.valid) {
                                console.warn(`[SECURITY] Rejected command in Claude mode: ${cmdResult.error}`);
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: cmdResult.error
                                }));
                                ws.close();
                                return;
                            }
                            command = initialCommand;
                        }

                        if (isWindows) {
                            if (hasSession && sessionId) {
                                // sessionId already validated by isValidSessionId
                                const escapedSessionId = escapePowerShellArg(sessionId);
                                // Try to resume session, but with fallback to new session if it fails
                                shellCommand = `Set-Location -Path ${escapedPath}; claude --resume ${escapedSessionId}; if ($LASTEXITCODE -ne 0) { claude }`;
                            } else {
                                shellCommand = `Set-Location -Path ${escapedPath}; ${command}`;
                            }
                        } else {
                            if (hasSession && sessionId) {
                                // sessionId already validated by isValidSessionId
                                const escapedSessionId = escapeShellArg(sessionId);
                                shellCommand = `cd ${escapedPath} && claude --resume ${escapedSessionId} || claude`;
                            } else {
                                shellCommand = `cd ${escapedPath} && ${command}`;
                            }
                        }
                    }

                    console.log('\u{1F527} Executing shell command:', shellCommand);

                    // Use appropriate shell based on platform
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                    // Use terminal dimensions from client if provided, otherwise use defaults
                    const termCols = data.cols || 80;
                    const termRows = data.rows || 24;
                    console.log('\u{1F4D0} Using terminal dimensions:', termCols, 'x', termRows);

                    shellProcess = pty.spawn(shell, shellArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: os.homedir(),
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            FORCE_COLOR: '3',
                            // Override browser opening commands to echo URL for detection
                            BROWSER: os.platform() === 'win32' ? 'echo "OPEN_URL:"' : 'echo "OPEN_URL:"'
                        }
                    });

                    console.log('\u{1F7E2} Shell process started with PTY, PID:', shellProcess.pid);

                    // SEC-012: Create idle timeout handler
                    const createIdleTimeout = () => {
                        return setTimeout(() => {
                            console.log(`[SECURITY] PTY session ${ptySessionKey} timed out after ${PTY_IDLE_TIMEOUT}ms of inactivity`);
                            const session = ptySessionsMap.get(ptySessionKey);
                            if (session) {
                                if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                                    session.ws.send(JSON.stringify({
                                        type: 'output',
                                        data: `\r\n\x1b[33m[Session timed out due to inactivity]\x1b[0m\r\n`
                                    }));
                                }
                                if (session.pty && session.pty.kill) {
                                    session.pty.kill();
                                }
                                ptySessionsMap.delete(ptySessionKey);
                            }
                        }, PTY_IDLE_TIMEOUT);
                    };

                    // SEC-012: Reset idle timeout on activity
                    const resetIdleTimeout = () => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session) {
                            if (session.idleTimeoutId) {
                                clearTimeout(session.idleTimeoutId);
                            }
                            session.idleTimeoutId = createIdleTimeout();
                        }
                    };

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        timeoutId: null,
                        idleTimeoutId: createIdleTimeout(), // SEC-012: Start idle timeout
                        projectPath,
                        sessionId
                    });

                    // Handle data output
                    shellProcess.onData((data) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        if (session.buffer.length < 5000) {
                            session.buffer.push(data);
                        } else {
                            session.buffer.shift();
                            session.buffer.push(data);
                        }

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            let outputData = data;

                            // Check for various URL opening patterns
                            const patterns = [
                                // Direct browser opening commands
                                /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
                                // BROWSER environment variable override
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                // Git and other tools opening URLs
                                /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
                                // General URL patterns that might be opened
                                /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                                /View at:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                                /Browse to:\s*(https?:\/\/[^\s\x1b\x07]+)/gi
                            ];

                            patterns.forEach(pattern => {
                                let match;
                                while ((match = pattern.exec(data)) !== null) {
                                    const url = match[1];
                                    console.log('[DEBUG] Detected URL for opening:', url);

                                    // Send URL opening message to client
                                    session.ws.send(JSON.stringify({
                                        type: 'url_open',
                                        url: url
                                    }));

                                    // Replace the OPEN_URL pattern with a user-friendly message
                                    if (pattern.source.includes('OPEN_URL')) {
                                        outputData = outputData.replace(match[0], `[INFO] Opening in browser: ${url}`);
                                    }
                                }
                            });

                            // Send regular output
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    // Handle process exit
                    shellProcess.onExit((exitCode) => {
                        console.log('\u{1F51A} Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                            }));
                        }
                        if (session) {
                            if (session.timeoutId) clearTimeout(session.timeoutId);
                            if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId); // SEC-012
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // SEC-012: Reset idle timeout on user input
                const session = ptySessionsMap.get(ptySessionKey);
                if (session && session.idleTimeoutId) {
                    clearTimeout(session.idleTimeoutId);
                    session.idleTimeoutId = setTimeout(() => {
                        console.log(`[SECURITY] PTY session ${ptySessionKey} timed out after ${PTY_IDLE_TIMEOUT}ms of inactivity`);
                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33m[Session timed out due to inactivity]\x1b[0m\r\n`
                            }));
                        }
                        if (session.pty && session.pty.kill) {
                            session.pty.kill();
                        }
                        ptySessionsMap.delete(ptySessionKey);
                    }, PTY_IDLE_TIMEOUT);
                }

                // Send input to shell process
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to shell:', error);
                    }
                } else {
                    console.warn('No active shell process to send input to');
                }
            } else if (data.type === 'resize') {
                // Handle terminal resize
                if (shellProcess && shellProcess.resize) {
                    console.log('Terminal resize requested:', data.cols, 'x', data.rows);
                    shellProcess.resize(data.cols, data.rows);
                }
            }
        } catch (error) {
            console.error('[ERROR] Shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('\u{1F50C} Shell client disconnected');

        if (ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                console.log('\u23F3 PTY session kept alive, will timeout in 30 minutes:', ptySessionKey);
                session.ws = null;

                session.timeoutId = setTimeout(() => {
                    console.log('\u23F0 PTY session timeout, killing process:', ptySessionKey);
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                }, PTY_SESSION_TIMEOUT);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Shell WebSocket error:', error);
    });
}
