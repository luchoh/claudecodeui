import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, authenticatedFetch } from '../utils/api';
import { useAuth } from './AuthContext';
import { useWebSocket } from './WebSocketContext';

const ACSContext = createContext({
  enabled: false,
  status: null,
  projectConnections: {},
  bridges: [],
  latestNotification: null,
  isLoading: false,
  error: null,
  refreshStatus: () => {},
  refreshAgents: () => {},
  refreshInbox: () => {},
  sendMessage: () => {},
  replyToMessage: () => {},
  acknowledgeMessage: () => {},
  refreshBridges: () => {},
  createBridge: () => {},
  updateBridge: () => {},
  deleteBridge: () => {},
  loadBridgeOutput: () => {},
  markThreadRead: () => {},
  getThread: () => null,
  addLocalMessage: () => {},
});

export const useACS = () => {
  const context = useContext(ACSContext);
  if (!context) {
    throw new Error('useACS must be used within an ACSProvider');
  }
  return context;
};

const normalizeMessage = (message) => {
  if (!message || typeof message !== 'object') {
    return {
      id: 'unknown',
      threadId: 'unknown',
      from: 'unknown',
      subject: '',
      body: '',
      timestamp: new Date().toISOString(),
      raw: message
    };
  }

  const timestamp =
    message.timestamp ||
    message.createdAt ||
    message.created_at ||
    message.time ||
    new Date().toISOString();

  const from =
    message.from ||
    message.sender ||
    message.agentId ||
    message.agent ||
    message.vendor ||
    message.name ||
    'unknown';

  const subject =
    message.subject ||
    message.title ||
    message.summary ||
    message.topic ||
    '';

  const body =
    message.body ||
    message.content ||
    message.text ||
    message.message ||
    '';

  const threadId =
    message.threadId ||
    message.thread_id ||
    message.thread ||
    message.conversationId ||
    message.conversation_id ||
    message.id ||
    `${from}-${subject || 'message'}`;

  const id =
    message.id ||
    message.messageId ||
    message.message_id ||
    threadId;

  return {
    id,
    threadId,
    from,
    subject,
    body,
    timestamp,
    raw: message
  };
};

const buildThreadsFromMessages = (messages) => {
  const threadsById = new Map();

  messages.forEach((message) => {
    const normalized = normalizeMessage(message);
    const existing = threadsById.get(normalized.threadId);
    const base = existing || {
      id: normalized.threadId,
      agentId: normalized.from,
      subject: normalized.subject || 'Message',
      preview: normalized.body?.slice(0, 160) || '',
      lastMessageAt: normalized.timestamp,
      messages: [],
      unreadCount: 0
    };

    base.messages = [...base.messages, normalized];
    base.preview = normalized.body?.slice(0, 160) || base.preview;
    base.lastMessageAt = normalized.timestamp;
    base.unreadCount += 1;
    threadsById.set(normalized.threadId, base);
  });

  const threads = Array.from(threadsById.values()).sort((a, b) => {
    return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
  });

  const unreadCount = threads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0);
  return { threads, unreadCount };
};

export const ACSProvider = ({ children }) => {
  const { user, token, isLoading: authLoading } = useAuth();
  const { latestMessage } = useWebSocket();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState(null);
  const [projectConnections, setProjectConnections] = useState({});
  const [bridges, setBridges] = useState([]);
  const [latestNotification, setLatestNotification] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const notificationRequestedRef = useRef(false);

  const updateProjectConnection = useCallback((repo, updater) => {
    setProjectConnections((prev) => {
      const existing = prev[repo] || {
        connected: false,
        agents: [],
        threads: [],
        unreadCount: 0
      };
      const updated = updater(existing);
      return {
        ...prev,
        [repo]: updated
      };
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!user || !token) {
      setEnabled(false);
      setStatus(null);
      setProjectConnections({});
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get('/acs/status');
      if (!response.ok) {
        throw new Error(`ACS status failed: ${response.status}`);
      }
      const data = await response.json();
      setStatus(data);
      setEnabled(Boolean(data?.enabled));
      if (data?.connections) {
        const connections = {};
        Object.entries(data.connections).forEach(([repo, connection]) => {
          connections[repo] = {
            connected: Boolean(connection.connected),
            agentId: connection.agentId,
            repoPath: connection.repoPath,
            agents: [],
            threads: [],
            unreadCount: 0
          };
        });
        setProjectConnections((prev) => ({ ...prev, ...connections }));
      }
    } catch (err) {
      console.error('ACS status error:', err);
      setError(err);
      setEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }, [user, token]);

  const refreshAgents = useCallback(async (repo) => {
    if (!enabled || !repo) return;
    try {
      const response = await api.get(`/acs/projects/${encodeURIComponent(repo)}/agents`);
      if (!response.ok) {
        throw new Error(`Failed to load agents: ${response.status}`);
      }
      const data = await response.json();
      const agents = data?.agents || data?.content?.agents || data?.content || data || [];
      updateProjectConnection(repo, (existing) => ({
        ...existing,
        agents
      }));
    } catch (err) {
      console.error('ACS agents error:', err);
    }
  }, [enabled, updateProjectConnection]);

  const refreshInbox = useCallback(async (repo) => {
    if (!enabled || !repo) return;
    try {
      const response = await api.get(`/acs/projects/${encodeURIComponent(repo)}/inbox`);
      if (!response.ok) {
        throw new Error(`Failed to load inbox: ${response.status}`);
      }
      const data = await response.json();
      const messages = data?.messages || data?.content?.messages || data?.content || data || [];
      const { threads, unreadCount } = buildThreadsFromMessages(Array.isArray(messages) ? messages : []);
      updateProjectConnection(repo, (existing) => ({
        ...existing,
        threads,
        unreadCount
      }));
    } catch (err) {
      console.error('ACS inbox error:', err);
    }
  }, [enabled, updateProjectConnection]);

  const sendMessage = useCallback(async (repo, payload) => {
    if (!enabled || !repo) return null;
    const response = await authenticatedFetch(`/api/acs/projects/${encodeURIComponent(repo)}/send`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to send ACS message');
    }
    return response.json();
  }, [enabled]);

  const replyToMessage = useCallback(async (repo, payload) => {
    if (!enabled || !repo) return null;
    const response = await authenticatedFetch(`/api/acs/projects/${encodeURIComponent(repo)}/reply`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to reply to ACS message');
    }
    return response.json();
  }, [enabled]);

  const acknowledgeMessage = useCallback(async (repo, payload) => {
    if (!enabled || !repo) return null;
    const response = await authenticatedFetch(`/api/acs/projects/${encodeURIComponent(repo)}/ack`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to acknowledge ACS message');
    }
    return response.json();
  }, [enabled]);

  const refreshBridges = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await api.get('/acs/bridges');
      if (!response.ok) {
        throw new Error(`Failed to load bridges: ${response.status}`);
      }
      const data = await response.json();
      setBridges(Array.isArray(data) ? data : data?.bridges || []);
    } catch (err) {
      console.error('ACS bridges error:', err);
    }
  }, [enabled]);

  const createBridge = useCallback(async (payload) => {
    const response = await authenticatedFetch('/api/acs/bridges', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to create bridge');
    }
    const data = await response.json();
    await refreshBridges();
    return data;
  }, [refreshBridges]);

  const updateBridge = useCallback(async (repo, payload) => {
    const response = await authenticatedFetch(`/api/acs/bridges/${encodeURIComponent(repo)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to update bridge');
    }
    const data = await response.json();
    await refreshBridges();
    return data;
  }, [refreshBridges]);

  const deleteBridge = useCallback(async (repo) => {
    const response = await authenticatedFetch(`/api/acs/bridges/${encodeURIComponent(repo)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to delete bridge');
    }
    const data = await response.json();
    await refreshBridges();
    return data;
  }, [refreshBridges]);

  const loadBridgeOutput = useCallback(async (repo, limit = 100) => {
    const response = await api.get(`/acs/bridges/${encodeURIComponent(repo)}/output?limit=${limit}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to load bridge output');
    }
    return response.json();
  }, []);

  const markThreadRead = useCallback((repo, threadId) => {
    if (!repo || !threadId) return;
    updateProjectConnection(repo, (existing) => {
      const threads = existing.threads.map((thread) =>
        thread.id === threadId ? { ...thread, unreadCount: 0 } : thread
      );
      const unreadCount = threads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0);
      return {
        ...existing,
        threads,
        unreadCount
      };
    });
  }, [updateProjectConnection]);

  const addLocalMessage = useCallback((repo, threadId, message) => {
    if (!repo) return;
    updateProjectConnection(repo, (existing) => {
      const normalized = normalizeMessage(message);
      const threadKey = threadId || normalized.threadId;
      const existingThread = existing.threads.find((thread) => thread.id === threadKey);
      const baseThread = existingThread || {
        id: threadKey,
        agentId: normalized.from,
        subject: normalized.subject || 'Message',
        preview: '',
        lastMessageAt: normalized.timestamp,
        messages: [],
        unreadCount: 0
      };
      const updatedThread = {
        ...baseThread,
        messages: [...baseThread.messages, normalized],
        preview: normalized.body?.slice(0, 160) || baseThread.preview,
        lastMessageAt: normalized.timestamp
      };
      const threads = existing.threads.filter((thread) => thread.id !== threadKey);
      threads.unshift(updatedThread);
      return {
        ...existing,
        threads
      };
    });
  }, [updateProjectConnection]);

  const getThread = useCallback((repo, threadId) => {
    const connection = projectConnections[repo];
    if (!connection) return null;
    return connection.threads.find((thread) => thread.id === threadId) || null;
  }, [projectConnections]);

  const maybeNotifyBrowser = useCallback((payload) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default' && !notificationRequestedRef.current) {
      notificationRequestedRef.current = true;
      Notification.requestPermission().catch(() => {});
    }
    if (document.hidden && Notification.permission === 'granted') {
      try {
        const title = payload.agentId || payload.from || 'ACS Message';
        const body = payload.subject ? `${payload.subject}\n${payload.preview || ''}` : payload.preview || 'New message';
        new Notification(title, { body });
      } catch (err) {
        console.warn('ACS notification error:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user && token) {
      refreshStatus();
    }
  }, [authLoading, user, token, refreshStatus, refreshBridges]);

  useEffect(() => {
    if (enabled) {
      refreshBridges();
    }
  }, [enabled, refreshBridges]);

  useEffect(() => {
    if (!latestMessage) return;
    if (!latestMessage.type || !latestMessage.type.startsWith('acs-')) return;

    const repo = latestMessage.repo;
    if (!repo) return;

    if (latestMessage.type === 'acs-message-received') {
      const message = latestMessage.params || {};
      const normalized = normalizeMessage(message);
      updateProjectConnection(repo, (existing) => {
        const existingThread = existing.threads.find((thread) => thread.id === normalized.threadId);
        const baseThread = existingThread || {
          id: normalized.threadId,
          agentId: normalized.from,
          subject: normalized.subject || 'Message',
          preview: '',
          lastMessageAt: normalized.timestamp,
          messages: [],
          unreadCount: 0
        };
        const updatedThread = {
          ...baseThread,
          messages: [...baseThread.messages, normalized],
          preview: normalized.body?.slice(0, 160) || baseThread.preview,
          lastMessageAt: normalized.timestamp,
          unreadCount: (baseThread.unreadCount || 0) + 1
        };
        const threads = existing.threads.filter((thread) => thread.id !== normalized.threadId);
        threads.unshift(updatedThread);
        const unreadCount = threads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0);
        return {
          ...existing,
          threads,
          unreadCount
        };
      });

      const notificationPayload = {
        repo,
        threadId: normalized.threadId,
        agentId: normalized.from,
        subject: normalized.subject,
        preview: normalized.body?.slice(0, 160) || '',
        timestamp: normalized.timestamp
      };
      setLatestNotification(notificationPayload);
      maybeNotifyBrowser(notificationPayload);
    }

    if (latestMessage.type === 'acs-connection-changed') {
      updateProjectConnection(repo, (existing) => ({
        ...existing,
        connected: Boolean(latestMessage.connected)
      }));
    }

    if (latestMessage.type === 'acs-agent-changed') {
      const agents = latestMessage.params?.agents || latestMessage.params || [];
      updateProjectConnection(repo, (existing) => ({
        ...existing,
        agents
      }));
    }

    if (latestMessage.type === 'acs-bridge-status') {
      refreshBridges();
    }
  }, [latestMessage, updateProjectConnection, maybeNotifyBrowser, refreshBridges]);

  const contextValue = {
    enabled,
    status,
    projectConnections,
    bridges,
    latestNotification,
    isLoading,
    error,
    refreshStatus,
    refreshAgents,
    refreshInbox,
    sendMessage,
    replyToMessage,
    acknowledgeMessage,
    refreshBridges,
    createBridge,
    updateBridge,
    deleteBridge,
    loadBridgeOutput,
    markThreadRead,
    getThread,
    addLocalMessage
  };

  return (
    <ACSContext.Provider value={contextValue}>
      {children}
    </ACSContext.Provider>
  );
};

export default ACSContext;
