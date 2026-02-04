import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
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
  const unmountedRef = useRef(false); // Track if component is unmounted
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  const connect = useCallback(async () => {
    if (unmountedRef.current) return; // Prevent connection if unmounted

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

        const ticket = await fetchTicket(token);
        if (!ticket) {
          console.warn('[WebSocket] Failed to get WebSocket ticket');
          return;
        }

        if (unmountedRef.current) return; // Check again after async operation
        wsUrl = buildWebSocketUrl(ticket);
      }

      if (!wsUrl) return;

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
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
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
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
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]); // everytime token changes, we reconnect

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && isConnected) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, [isConnected]);

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
