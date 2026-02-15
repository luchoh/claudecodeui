import { handleChatConnection } from './chatHandler.js';
import { handleShellConnection } from './shellHandler.js';

const WS_PING_INTERVAL = parseInt(process.env.WS_PING_INTERVAL, 10) || 30000;

// WebSocket connection handler that routes based on URL path
export function setupWebSocketRouting(wss) {
    // Ping/pong keepalive — prevents nginx proxy_read_timeout from killing idle connections.
    // Runs at transport level (not per-handler) since ping/pong is a WebSocket protocol concern.
    const pingInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log('[WARN] Terminating unresponsive WebSocket client');
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, WS_PING_INTERVAL);

    wss.on('close', () => {
        clearInterval(pingInterval);
    });

    wss.on('connection', (ws, request) => {
        const url = request.url;
        console.log('[INFO] Client connected to:', url);

        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Parse URL to get pathname without query parameters
        const urlObj = new URL(url, 'http://localhost');
        const pathname = urlObj.pathname;

        if (pathname === '/shell') {
            handleShellConnection(ws);
        } else if (pathname === '/ws') {
            handleChatConnection(ws);
        } else {
            console.log('[WARN] Unknown WebSocket path:', pathname);
            ws.close();
        }
    });
}
