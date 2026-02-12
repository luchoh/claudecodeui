import path from 'path';
import os from 'os';
import { WebSocket } from 'ws';
import { getProjects, clearProjectDirectoryCache } from '../projects.js';

// File system watcher for projects folder
let projectsWatcher = null;
export const connectedClients = new Set();
let isGetProjectsRunning = false; // Flag to prevent reentrant calls

// Broadcast progress to all connected WebSocket clients
export function broadcastProgress(progress) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Setup file system watcher for Claude projects folder using chokidar
export async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;
    const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');

    if (projectsWatcher) {
        projectsWatcher.close();
    }

    try {
        // Initialize chokidar watcher with optimized settings
        projectsWatcher = chokidar.watch(claudeProjectsPath, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/*.tmp',
                '**/*.swp',
                '**/.DS_Store'
            ],
            persistent: true,
            ignoreInitial: true, // Don't fire events for existing files on startup
            followSymlinks: false,
            depth: 10, // Reasonable depth limit
            awaitWriteFinish: {
                stabilityThreshold: 100, // Wait 100ms for file to stabilize
                pollInterval: 50
            }
        });

        // Debounce function to prevent excessive notifications
        let debounceTimer;
        const debouncedUpdate = async (eventType, filePath) => {
            // Skip full re-scan for 'change' events on .jsonl files — these are just
            // message appends to existing sessions and don't affect the project/session list.
            // Only 'add' (new session file) and 'unlink' (deleted session) need a full re-scan.
            if (eventType === 'change' && filePath.endsWith('.jsonl')) {
                // Still notify clients about the changed file so ChatInterface can reload
                // messages for externally-modified sessions, but skip the expensive getProjects()
                const updateMessage = JSON.stringify({
                    type: 'projects_updated',
                    projects: null, // null signals "no project list change, just a file update"
                    timestamp: new Date().toISOString(),
                    changeType: eventType,
                    changedFile: path.relative(claudeProjectsPath, filePath)
                });
                connectedClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updateMessage);
                    }
                });
                return;
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                // Prevent reentrant calls
                if (isGetProjectsRunning) {
                    return;
                }

                try {
                    isGetProjectsRunning = true;

                    // Clear project directory cache when files change
                    clearProjectDirectoryCache();

                    // Get updated projects list
                    const updatedProjects = await getProjects(broadcastProgress);

                    // Notify all connected clients about the project changes
                    const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: eventType,
                        changedFile: path.relative(claudeProjectsPath, filePath)
                    });

                    connectedClients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(updateMessage);
                        }
                    });

                } catch (error) {
                    console.error('[ERROR] Error handling project changes:', error);
                } finally {
                    isGetProjectsRunning = false;
                }
            }, 300); // 300ms debounce (slightly faster than before)
        };

        // Set up event listeners
        projectsWatcher
            .on('add', (filePath) => debouncedUpdate('add', filePath))
            .on('change', (filePath) => debouncedUpdate('change', filePath))
            .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
            .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
            .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
            .on('error', (error) => {
                console.error('[ERROR] Chokidar watcher error:', error);
            })
            .on('ready', () => {
            });

    } catch (error) {
        console.error('[ERROR] Failed to setup projects watcher:', error);
    }
}

// Graceful shutdown: close the chokidar watcher and release file handles
export async function closeProjectWatcher() {
    if (projectsWatcher) {
        await projectsWatcher.close();
        projectsWatcher = null;
        console.log('[SHUTDOWN] Project watcher closed');
    }
}
