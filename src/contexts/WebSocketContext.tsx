import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';
import { refreshAccessToken, shouldRefreshToken } from '../utils/tokenRefresh';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => boolean;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (ticket: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!ticket) return null;
  // SEC-005: Use ticket-based auth instead of token in URL
  return `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`;
};

/**
 * Fetch a single-use ticket for WebSocket authentication
 * SEC-005: Tickets are short-lived (30s) and single-use
 */
const fetchTicket = async (token: string): Promise<string | null> => {
  try {
    const response = await fetch('/api/auth/ticket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ purpose: 'websocket' })
    });

    if (!response.ok) {
      console.error('[WebSocket] Failed to get ticket:', response.status);
      return null;
    }

    const data = await response.json();
    return data.ticket;
  } catch (error) {
    console.error('[WebSocket] Error fetching ticket:', error);
    return null;
  }
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const connectIdRef = useRef(0); // Monotonic ID to cancel stale connect() calls
  const { token } = useAuth();

  const connect = useCallback(async (myConnectId: number) => {
    // If a newer connect() was initiated, this one is stale — abort
    if (myConnectId !== connectIdRef.current) return;

    try {
      let wsUrl: string | null = null;

      if (IS_PLATFORM) {
        // Platform mode: no ticket needed
        wsUrl = buildWebSocketUrl(null);
      } else {
        // OSS mode: fetch ticket first
        if (!token) {
          console.warn('[WebSocket] No authentication token available');
          return;
        }

        // If token is near expiry or expired, try refreshing first
        let currentToken: string = token;
        if (shouldRefreshToken()) {
          try {
            const newToken = await refreshAccessToken();
            if (newToken) {
              currentToken = newToken;
            }
          } catch {
            // Fall through — try with existing token anyway
          }
        }

        if (myConnectId !== connectIdRef.current) return; // Stale after async

        const ticket = await fetchTicket(currentToken);
        if (!ticket) {
          console.warn('[WebSocket] Failed to get ticket, scheduling retry');
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current++;
            const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
            reconnectTimeoutRef.current = setTimeout(() => {
              if (myConnectId === connectIdRef.current) connect(myConnectId);
            }, delay);
          }
          return;
        }

        if (myConnectId !== connectIdRef.current) return; // Stale after async
        wsUrl = buildWebSocketUrl(ticket);
      }

      if (!wsUrl) return;

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        if (myConnectId !== connectIdRef.current) {
          websocket.close(); // Stale — close the orphaned socket
          return;
        }
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        setIsConnected(true);
        wsRef.current = websocket;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (myConnectId !== connectIdRef.current) return; // Stale — don't reconnect
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (myConnectId === connectIdRef.current) connect(myConnectId);
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token]); // everytime token changes, we reconnect

  useEffect(() => {
    const myId = ++connectIdRef.current; // Invalidate any previous connect()
    connect(myId);

    return () => {
      connectIdRef.current++; // Invalidate this connect() on cleanup
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const sendMessage = useCallback((message: any): boolean => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('[WebSocket] Send failed:', error);
        return false;
      }
    } else {
      console.warn('[WebSocket] Not connected, message dropped');
      return false;
    }
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
