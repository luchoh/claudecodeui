/*
 * useWebSocketHandler.js - WebSocket Message Processing Hook
 *
 * Extracted from ChatInterface.jsx to reduce file size.
 * Handles all incoming WebSocket messages (latestMessage) and dispatches
 * side-effects: updating chat messages, session state, streaming buffers,
 * permission requests, and session protection callbacks.
 *
 * This is a pure side-effect hook; it returns nothing.
 */

import { useEffect } from 'react';
import {
  decodeHtmlEntities,
  formatUsageLimitText,
  safeLocalStorage,
} from '../utils/chatUtils';

/**
 * @param {object} params
 * @param {any}      params.latestMessage         - Latest WebSocket message from context
 * @param {string|null} params.currentSessionId   - Active session ID
 * @param {object|null} params.selectedSession    - Currently selected session object
 * @param {object|null} params.selectedProject    - Currently selected project object
 * @param {string}   params.provider              - Current provider ('claude' | 'cursor' | 'codex')
 *
 * State setters:
 * @param {Function} params.setChatMessages
 * @param {Function} params.setIsLoading
 * @param {Function} params.setCanAbortSession
 * @param {Function} params.setClaudeStatus
 * @param {Function} params.setCurrentSessionId
 * @param {Function} params.setIsSystemSessionChange
 * @param {Function} params.setTokenBudget
 * @param {Function} params.setPendingPermissionRequests
 *
 * Refs:
 * @param {object}   params.streamBufferRef
 * @param {object}   params.streamTimerRef
 * @param {object}   params.pendingViewSessionRef
 *
 * Session protection callbacks (from ChatContext):
 * @param {Function} params.onSessionInactive
 * @param {Function} params.onSessionNotProcessing
 * @param {Function} params.onSessionProcessing
 * @param {Function} params.onReplaceTemporarySession
 * @param {Function} params.onNavigateToSession
 */
export default function useWebSocketHandler({
  latestMessage,
  currentSessionId,
  selectedSession,
  selectedProject,
  provider,
  // State setters
  setChatMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setCurrentSessionId,
  setIsSystemSessionChange,
  setTokenBudget,
  setPendingPermissionRequests,
  // Refs
  streamBufferRef,
  streamTimerRef,
  pendingViewSessionRef,
  // Session protection callbacks
  onSessionInactive,
  onSessionNotProcessing,
  onSessionProcessing,
  onReplaceTemporarySession,
  onNavigateToSession,
}) {
  useEffect(() => {
    // Handle WebSocket messages
    if (!latestMessage) return;

    const messageData = latestMessage.data?.message || latestMessage.data;

    // Filter messages by session ID to prevent cross-session interference
    // Skip filtering for global messages that apply to all sessions
    const globalMessageTypes = [
      'projects_updated',
      'taskmaster-project-updated',
      'session-created',
      'acs-message-received',
      'acs-agent-changed',
      'acs-bridge-status',
      'acs-connection-changed',
      'acs-notification'
    ];
    const isGlobalMessage = globalMessageTypes.includes(latestMessage.type);
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'cursor-result',
      'session-aborted',
      'claude-error',
      'cursor-error',
      'codex-error'
    ]);

    const isClaudeSystemInit = latestMessage.type === 'claude-response' &&
      messageData &&
      messageData.type === 'system' &&
      messageData.subtype === 'init';
    const isCursorSystemInit = latestMessage.type === 'cursor-system' &&
      latestMessage.data &&
      latestMessage.data.type === 'system' &&
      latestMessage.data.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit
      ? messageData?.session_id
      : isCursorSystemInit
        ? latestMessage.data?.session_id
        : null;

    const activeViewSessionId = selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const isSystemInitForView = systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || isSystemInitForView;
    const isUnscopedError = !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' || latestMessage.type === 'cursor-error' || latestMessage.type === 'codex-error');

    const handleBackgroundLifecycle = (sessionId) => {
      if (!sessionId) return;
      if (onSessionInactive) {
        onSessionInactive(sessionId);
      }
      if (onSessionNotProcessing) {
        onSessionNotProcessing(sessionId);
      }
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        // No session in view; ignore session-scoped traffic.
        if (latestMessage.sessionId && lifecycleMessageTypes.has(latestMessage.type)) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        if (!isUnscopedError) {
          return;
        }
      }
      if (!latestMessage.sessionId && !isUnscopedError) {
        // Drop unscoped messages to prevent cross-session bleed.
        return;
      }
      if (latestMessage.sessionId !== activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(latestMessage.type)) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        // Message is for a different session, ignore it
        console.log('??-?,? Skipping message for different session:', latestMessage.sessionId, 'current:', activeViewSessionId);
        return;
      }
    }

    switch (latestMessage.type) {
      case 'session-created':
        // New session created by Claude CLI - we receive the real session ID here
        // Store it temporarily until conversation completes (prevents premature session association)
        if (latestMessage.sessionId && !currentSessionId) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          // Mark as system change to prevent clearing messages when session ID updates
          setIsSystemSessionChange(true);

          // Session Protection: Replace temporary "new-session-*" identifier with real session ID
          if (onReplaceTemporarySession) {
            onReplaceTemporarySession(latestMessage.sessionId);
          }

          // Attach the real session ID to any pending permission requests
          setPendingPermissionRequests(prev => prev.map(req => (
            req.sessionId ? req : { ...req, sessionId: latestMessage.sessionId }
          )));
        }
        break;

      case 'token-budget':
        // Use token budget from WebSocket for active sessions
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response':

        // Handle Cursor streaming format (content_block_delta / content_block_stop)
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            // Decode HTML entities and buffer deltas
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                if (!chunk) return;
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = (last.content || '') + chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }, 100);
            }
            return;
          }
          if (messageData.type === 'content_block_stop') {
            // Flush any buffered text and mark streaming message complete
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            if (chunk) {
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                  last.content = (last.content || '') + chunk;
                } else {
                  updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                }
                return updated;
              });
            }
            setChatMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && last.isStreaming) {
                last.isStreaming = false;
              }
              return updated;
            });
            return;
          }
        }

        // Handle Claude CLI session duplication bug workaround
        if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            currentSessionId &&
            latestMessage.data.session_id !== currentSessionId &&
            isSystemInitForView) {

          console.log('Session duplication detected:', {
            originalSession: currentSessionId,
            newSession: latestMessage.data.session_id
          });

          setIsSystemSessionChange(true);

          if (onNavigateToSession) {
            onNavigateToSession(latestMessage.data.session_id);
          }
          return;
        }

        // Handle system/init for new sessions (when currentSessionId is null)
        if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            !currentSessionId &&
            isSystemInitForView) {

          console.log('New session init detected:', {
            newSession: latestMessage.data.session_id
          });

          setIsSystemSessionChange(true);

          if (onNavigateToSession) {
            onNavigateToSession(latestMessage.data.session_id);
          }
          return;
        }

        // For system/init messages that match current session, just ignore them
        if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            currentSessionId &&
            latestMessage.data.session_id === currentSessionId &&
            isSystemInitForView) {
          console.log('System init message for current session, ignoring');
          return;
        }

        // Handle different types of content in the response
        if (Array.isArray(messageData.content)) {
          for (const part of messageData.content) {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: part.name,
                toolInput: toolInput,
                toolId: part.id,
                toolResult: null
              }]);
            } else if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setChatMessages(prev => [...prev, {
                type: 'assistant',
                content: content,
                timestamp: new Date()
              }]);
            }
          }
        } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
          let content = decodeHtmlEntities(messageData.content);
          content = formatUsageLimitText(content);
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: content,
            timestamp: new Date()
          }]);
        }

        // Handle tool results from user messages (these come separately)
        if (messageData.role === 'user' && Array.isArray(messageData.content)) {
          for (const part of messageData.content) {
            if (part.type === 'tool_result') {
              setChatMessages(prev => prev.map(msg => {
                if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                  return {
                    ...msg,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date()
                    }
                  };
                }
                return msg;
              }));
            }
          }
        }
        break;

      case 'claude-output':
        {
          const cleaned = String(latestMessage.data || '');
          if (cleaned.trim()) {
            streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
            if (!streamTimerRef.current) {
              streamTimerRef.current = setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                if (!chunk) return;
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }, 100);
            }
          }
        }
        break;

      case 'claude-interactive-prompt':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: latestMessage.data,
          timestamp: new Date(),
          isInteractivePrompt: true
        }]);
        break;

      case 'claude-permission-request': {
        if (provider !== 'claude' || !latestMessage.requestId) {
          break;
        }

        setPendingPermissionRequests(prev => {
          if (prev.some(req => req.requestId === latestMessage.requestId)) {
            return prev;
          }
          return [
            ...prev,
            {
              requestId: latestMessage.requestId,
              toolName: latestMessage.toolName || 'UnknownTool',
              input: latestMessage.input,
              context: latestMessage.context,
              sessionId: latestMessage.sessionId || null,
              receivedAt: new Date()
            }
          ];
        });

        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({
          text: 'Waiting for permission',
          tokens: 0,
          can_interrupt: true
        });
        break;
      }

      case 'claude-permission-cancelled': {
        if (!latestMessage.requestId) {
          break;
        }
        setPendingPermissionRequests(prev => prev.filter(req => req.requestId !== latestMessage.requestId));
        break;
      }

      case 'claude-error':
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Error: ${latestMessage.error}`,
          timestamp: new Date()
        }]);
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        break;

      case 'cursor-system':
        // Handle Cursor system/init messages similar to Claude
        try {
          const cdata = latestMessage.data;
          if (cdata && cdata.type === 'system' && cdata.subtype === 'init' && cdata.session_id) {
            if (!isSystemInitForView) {
              return;
            }
            if (currentSessionId && cdata.session_id !== currentSessionId) {
              console.log('Cursor session switch detected:', { originalSession: currentSessionId, newSession: cdata.session_id });
              setIsSystemSessionChange(true);
              if (onNavigateToSession) {
                onNavigateToSession(cdata.session_id);
              }
              return;
            }
            if (!currentSessionId) {
              console.log('Cursor new session init detected:', { newSession: cdata.session_id });
              setIsSystemSessionChange(true);
              if (onNavigateToSession) {
                onNavigateToSession(cdata.session_id);
              }
              return;
            }
          }
        } catch (e) {
          console.warn('Error handling cursor-system message:', e);
        }
        break;

      case 'cursor-user':
        // Handle Cursor user messages (usually echoes)
        break;

      case 'cursor-tool-use':
        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''}`,
          timestamp: new Date(),
          isToolUse: true,
          toolName: latestMessage.tool,
          toolInput: latestMessage.input
        }]);
        break;

      case 'cursor-error':
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
          timestamp: new Date()
        }]);
        break;

      case 'cursor-result': {
        const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;

        if (cursorCompletedSessionId === currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (cursorCompletedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(cursorCompletedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(cursorCompletedSessionId);
          }
        }

        if (cursorCompletedSessionId === currentSessionId) {
          try {
            const r = latestMessage.data || {};
            const textResult = typeof r.result === 'string' ? r.result : '';
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const pendingChunk = streamBufferRef.current;
            streamBufferRef.current = '';

            setChatMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                last.content = finalContent;
                last.isStreaming = false;
              } else if (textResult && textResult.trim()) {
                updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
              }
              return updated;
            });
          } catch (e) {
            console.warn('Error handling cursor-result message:', e);
          }
        }

        const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');
        if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
          setCurrentSessionId(cursorCompletedSessionId);
          sessionStorage.removeItem('pendingSessionId');

          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects(), 500);
          }
        }
        break;
      }

      case 'cursor-output':
        try {
          const raw = String(latestMessage.data ?? '');
          const cleaned = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
          if (cleaned) {
            streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
            if (!streamTimerRef.current) {
              streamTimerRef.current = setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                if (!chunk) return;
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }, 100);
            }
          }
        } catch (e) {
          console.warn('Error handling cursor-output message:', e);
        }
        break;

      case 'claude-complete': {
        const completedSessionId = latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');

        if (completedSessionId === currentSessionId || !currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (completedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(completedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(completedSessionId);
          }
        }

        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (codexData) {
          if (codexData.type === 'item') {
            switch (codexData.itemType) {
              case 'agent_message':
                if (codexData.message?.content?.trim()) {
                  const content = decodeHtmlEntities(codexData.message.content);
                  setChatMessages(prev => [...prev, {
                    type: 'assistant',
                    content: content,
                    timestamp: new Date()
                  }]);
                }
                break;

              case 'reasoning':
                if (codexData.message?.content?.trim()) {
                  const content = decodeHtmlEntities(codexData.message.content);
                  setChatMessages(prev => [...prev, {
                    type: 'assistant',
                    content: content,
                    timestamp: new Date(),
                    isThinking: true
                  }]);
                }
                break;

              case 'command_execution':
                if (codexData.command) {
                  setChatMessages(prev => [...prev, {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'Bash',
                    toolInput: codexData.command,
                    toolResult: codexData.output || null,
                    exitCode: codexData.exitCode
                  }]);
                }
                break;

              case 'file_change':
                if (codexData.changes?.length > 0) {
                  const changesList = codexData.changes.map(c => `${c.kind}: ${c.path}`).join('\n');
                  setChatMessages(prev => [...prev, {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'FileChanges',
                    toolInput: changesList,
                    toolResult: `Status: ${codexData.status}`
                  }]);
                }
                break;

              case 'mcp_tool_call':
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: `${codexData.server}:${codexData.tool}`,
                  toolInput: JSON.stringify(codexData.arguments, null, 2),
                  toolResult: codexData.result ? JSON.stringify(codexData.result, null, 2) : (codexData.error?.message || null)
                }]);
                break;

              case 'error':
                if (codexData.message?.content) {
                  setChatMessages(prev => [...prev, {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date()
                  }]);
                }
                break;

              default:
                console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
            }
          }

          if (codexData.type === 'turn_complete') {
            setIsLoading(false);
          }

          if (codexData.type === 'turn_failed') {
            setIsLoading(false);
            setChatMessages(prev => [...prev, {
              type: 'error',
              content: codexData.error?.message || 'Turn failed',
              timestamp: new Date()
            }]);
          }
        }
        break;
      }

      case 'codex-complete': {
        const codexCompletedSessionId = latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');

        if (codexCompletedSessionId === currentSessionId || !currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (codexCompletedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(codexCompletedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(codexCompletedSessionId);
          }
        }

        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (onNavigateToSession) {
            onNavigateToSession(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
          console.log('Codex session complete, ID set to:', codexPendingSessionId);
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        break;
      }

      case 'codex-error':
        setIsLoading(false);
        setCanAbortSession(false);
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: latestMessage.error || 'An error occurred with Codex',
          timestamp: new Date()
        }]);
        break;

      case 'session-aborted': {
        const abortedSessionId = latestMessage.sessionId || currentSessionId;

        if (abortedSessionId === currentSessionId) {
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
        }

        if (abortedSessionId) {
          if (onSessionInactive) {
            onSessionInactive(abortedSessionId);
          }
          if (onSessionNotProcessing) {
            onSessionNotProcessing(abortedSessionId);
          }
        }

        setPendingPermissionRequests([]);

        setChatMessages(prev => [...prev, {
          type: 'assistant',
          content: 'Session interrupted by user.',
          timestamp: new Date()
        }]);
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        const isCurrentSession = statusSessionId === currentSessionId ||
                                 (selectedSession && statusSessionId === selectedSession.id);
        if (isCurrentSession && latestMessage.isProcessing) {
          setIsLoading(true);
          setCanAbortSession(true);
          if (onSessionProcessing) {
            onSessionProcessing(statusSessionId);
          }
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (statusData) {
          let statusInfo = {
            text: 'Working...',
            tokens: 0,
            can_interrupt: true
          };

          if (statusData.message) {
            statusInfo.text = statusData.message;
          } else if (statusData.status) {
            statusInfo.text = statusData.status;
          } else if (typeof statusData === 'string') {
            statusInfo.text = statusData;
          }

          if (statusData.tokens) {
            statusInfo.tokens = statusData.tokens;
          } else if (statusData.token_count) {
            statusInfo.tokens = statusData.token_count;
          }

          if (statusData.can_interrupt !== undefined) {
            statusInfo.can_interrupt = statusData.can_interrupt;
          }

          setClaudeStatus(statusInfo);
          setIsLoading(true);
          setCanAbortSession(statusInfo.can_interrupt);
        }
        break;
      }
    }
  }, [latestMessage]);
}
