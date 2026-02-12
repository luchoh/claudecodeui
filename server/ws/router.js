import { handleChatConnection } from './chatHandler.js';
import { handleShellConnection } from './shellHandler.js';

// WebSocket connection handler that routes based on URL path
export function setupWebSocketRouting(wss) {
    wss.on('connection', (ws, request) => {
        const url = request.url;
        console.log('[INFO] Client connected to:', url);

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
