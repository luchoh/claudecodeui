/*
 * ChatInterface.jsx - Chat Component with Session Protection Integration
 * 
 * SESSION PROTECTION INTEGRATION:
 * ===============================
 * 
 * This component integrates with the Session Protection System to prevent project updates
 * from interrupting active conversations:
 * 
 * Key Integration Points:
 * 1. handleSubmit() - Marks session as active when user sends message (including temp ID for new sessions)
 * 2. session-created handler - Replaces temporary session ID with real WebSocket session ID  
 * 3. claude-complete handler - Marks session as inactive when conversation finishes
 * 4. session-aborted handler - Marks session as inactive when conversation is aborted
 * 
 * This ensures uninterrupted chat experience by coordinating with App.jsx to pause sidebar updates.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import ClaudeLogo from './ClaudeLogo.jsx';
import CursorLogo from './CursorLogo.jsx';
import CodexLogo from './CodexLogo.jsx';
import { useTasksSettings } from '../contexts/TasksSettingsContext';

import { api, authenticatedFetch } from '../utils/api';
import { thinkingModes } from './ThinkingModeSelector.jsx';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS } from '../../shared/modelConstants';

// ── Extracted modules ────────────────────────────────────────────────
import MessageComponent from './chat/MessageItem';
import {
  decodeHtmlEntities,
  unescapeWithMathProtection,
  formatUsageLimitText,
  safeLocalStorage,
} from '../utils/chatUtils';
import useChatInput from '../hooks/useChatInput';
import useToolPermissions from '../hooks/useToolPermissions';
import useWebSocketHandler from '../hooks/useWebSocketHandler';
import { useChatContext } from '../contexts/ChatContext';
import { convertSessionMessages, convertCursorBlobs, calculateDiff } from '../utils/messageConverters';
import WelcomeScreen from './chat/WelcomeScreen';
import ChatInput from './chat/ChatInput';


// ChatInterface: Main chat component with Session Protection System integration
// 
// Session Protection System prevents automatic project updates from interrupting active conversations:
// - onSessionActive: Called when user sends message to mark session as protected
// - onSessionInactive: Called when conversation completes/aborts to re-enable updates
// - onReplaceTemporarySession: Called to replace temporary session ID with real WebSocket session ID
//
// This ensures uninterrupted chat experience by pausing sidebar refreshes during conversations.
function ChatInterface({ selectedProject, selectedSession, ws, sendMessage, latestMessage, onFileOpen, onInputFocusChange, onShowAllTasks }) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();

  // Session protection callbacks and display settings from context
  const {
    onSessionActive,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    processingSessions,
    onReplaceTemporarySession,
    onNavigateToSession,
    onShowSettings,
    autoExpandTools,
    showRawParameters,
    showThinking,
    autoScrollToBottom,
    sendByCtrlEnter,
    externalMessageUpdate,
  } = useChatContext();

  // ── Non-input state ─────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [messagesOffset, setMessagesOffset] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const MESSAGES_PER_PAGE = 20;
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'claude';
  });
  const [cursorModel, setCursorModel] = useState(() => {
    return localStorage.getItem('cursor-model') || CURSOR_MODELS.DEFAULT;
  });
  const [claudeModel, setClaudeModel] = useState(() => {
    return localStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT;
  });
  const [codexModel, setCodexModel] = useState(() => {
    return localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  });

  // ── Refs ────────────────────────────────────────────────────────────
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef(null);
  const pendingViewSessionRef = useRef(null);
  const scrollPositionRef = useRef({ height: 0, top: 0 });

  // ── Chat input (extracted hook) ─────────────────────────────────────
  const {
    input, setInput,
    debouncedInput,
    isTextareaExpanded, setIsTextareaExpanded,
    cursorPosition, setCursorPosition,
    textareaRef, inputHighlightRef, inputContainerRef, commandQueryTimerRef,
    showFileDropdown, setShowFileDropdown,
    fileList, filteredFiles,
    selectedFileIndex, setSelectedFileIndex,
    atSymbolPosition, fileMentions,
    showCommandMenu, setShowCommandMenu,
    slashCommands,
    filteredCommands, setFilteredCommands,
    commandQuery, setCommandQuery,
    selectedCommandIndex, setSelectedCommandIndex,
    slashPosition, setSlashPosition,
    frequentCommands,
    attachedImages, setAttachedImages,
    uploadingImages, setUploadingImages,
    imageErrors, setImageErrors,
    handleInputChange, handlePaste, handleImageFiles,
    selectFile, renderInputWithMentions, syncInputOverlayScroll,
    handleTextareaClick, handleTranscript,
    handleCommandSelect: handleCommandSelectBase,
  } = useChatInput({ selectedProject, provider });
  // ── Tool permissions (extracted hook) ──────────────────────────────
  const {
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleModeSwitch,
  } = useToolPermissions({
    sessionId: selectedSession?.id,
    provider,
    sendMessage,
    setClaudeStatus,
  });

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  // When selecting a session from Sidebar, auto-switch provider to match session's origin
  useEffect(() => {
    if (selectedSession && selectedSession.__provider && selectedSession.__provider !== provider) {
      setProvider(selectedSession.__provider);
      localStorage.setItem('selected-provider', selectedSession.__provider);
    }
  }, [selectedSession]);
  
  // Load Cursor default model from config
  useEffect(() => {
    if (provider === 'cursor') {
      authenticatedFetch('/api/cursor/config')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.config?.model?.modelId) {
          // Use the model from config directly
          const modelId = data.config.model.modelId;
          if (!localStorage.getItem('cursor-model')) {
            setCursorModel(modelId);
          }
        }
      })
      .catch(err => console.error('Error loading Cursor config:', err));
    }
  }, [provider]);

  // Wrap the base command select handler with command execution
  const handleCommandSelect = useCallback((command, index, isHover) => {
    if (isHover) {
      handleCommandSelectBase(command, index, isHover);
      return;
    }
    handleCommandSelectBase(command, index, isHover);
    if (command) {
      executeCommand(command);
    }
  }, [handleCommandSelectBase]);

  // Execute a command
  const handleBuiltInCommand = useCallback((result) => {
    const { action, data } = result;

    switch (action) {
      case 'clear':
        // Clear conversation history
        setChatMessages([]);
        setSessionMessages([]);
        break;

      case 'help':
        // Show help content
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content,
          timestamp: Date.now()
        }]);
        break;

      case 'model':
        // Show model information
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
          timestamp: Date.now()
        }]);
        break;

      case 'cost': {
        const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: costMessage, timestamp: Date.now() }]);
        break;
      }

      case 'status': {
        const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: statusMessage, timestamp: Date.now() }]);
        break;
      }
      case 'memory':
        // Show memory file info
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
            timestamp: Date.now()
          }]);
          // Optionally open file in editor
          if (data.exists && onFileOpen) {
            onFileOpen(data.path);
          }
        }
        break;

      case 'config':
        // Open settings
        if (onShowSettings) {
          onShowSettings();
        }
        break;

      case 'rewind':
        // Rewind conversation
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          // Remove last N messages
          setChatMessages(prev => prev.slice(0, -data.steps * 2)); // Remove user + assistant pairs
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⏪ ${data.message}`,
            timestamp: Date.now()
          }]);
        }
        break;

      default:
        console.warn('Unknown built-in command action:', action);
    }
  }, [onFileOpen, onShowSettings]);

  // Ref to store handleSubmit so we can call it from handleCustomCommand
  const handleSubmitRef = useRef(null);

  // Handle custom command execution
  const handleCustomCommand = useCallback(async (result, args) => {
    const { content, hasBashCommands, hasFileIncludes } = result;

    // Show confirmation for bash commands
    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?'
      );
      if (!confirmed) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '❌ Command execution cancelled',
          timestamp: Date.now()
        }]);
        return;
      }
    }

    // Set the input to the command content
    setInput(content);

    // Wait for state to update, then directly call handleSubmit
    setTimeout(() => {
      if (handleSubmitRef.current) {
        // Create a fake event to pass to handleSubmit
        const fakeEvent = { preventDefault: () => {} };
        handleSubmitRef.current(fakeEvent);
      }
    }, 50);
  }, []);
  const executeCommand = useCallback(async (command) => {
    if (!command || !selectedProject) return;

    try {
      // Parse command and arguments from current input
      const commandMatch = input.match(new RegExp(`${command.name}\\s*(.*)`));
      const args = commandMatch && commandMatch[1]
        ? commandMatch[1].trim().split(/\s+/)
        : [];

      // Prepare context for command execution
      const context = {
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
        sessionId: currentSessionId,
        provider,
        model: provider === 'cursor' ? cursorModel : claudeModel,
        tokenUsage: tokenBudget
      };

      // Call the execute endpoint
      const response = await authenticatedFetch('/api/commands/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commandName: command.name,
          commandPath: command.path,
          args,
          context
        })
      });

      if (!response.ok) {
        throw new Error('Failed to execute command');
      }

      const result = await response.json();

      // Handle built-in commands
      if (result.type === 'builtin') {
        handleBuiltInCommand(result);
      } else if (result.type === 'custom') {
        // Handle custom commands - inject as system message
        await handleCustomCommand(result, args);
      }

      // Clear the input after successful execution
      setInput('');
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      setSelectedCommandIndex(-1);

    } catch (error) {
      console.error('Error executing command:', error);
      // Show error message to user
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error executing command: ${error.message}`,
        timestamp: Date.now()
      }]);
    }
  }, [input, selectedProject, currentSessionId, provider, cursorModel, tokenBudget]);

  // Handle built-in command actions


  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => {
    const cache = new Map();
    return (oldStr, newStr) => {
      const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
      if (cache.has(key)) {
        return cache.get(key);
      }
      
      const result = calculateDiff(oldStr, newStr);
      cache.set(key, result);
      if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      return result;
    };
  }, []);

  // Load session messages from API with pagination
  const loadSessionMessages = useCallback(async (projectName, sessionId, loadMore = false, provider = 'claude') => {
    if (!projectName || !sessionId) return [];

    const isInitialLoad = !loadMore;
    if (isInitialLoad) {
      setIsLoadingSessionMessages(true);
    } else {
      setIsLoadingMoreMessages(true);
    }

    try {
      const currentOffset = loadMore ? messagesOffset : 0;
      const response = await api.sessionMessages(projectName, sessionId, MESSAGES_PER_PAGE, currentOffset, provider);
      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }
      const data = await response.json();

      // Extract token usage if present (Codex includes it in messages response)
      if (isInitialLoad && data.tokenUsage) {
        setTokenBudget(data.tokenUsage);
      }

      // Handle paginated response
      if (data.hasMore !== undefined) {
        setHasMoreMessages(data.hasMore);
        setTotalMessages(data.total);
        setMessagesOffset(currentOffset + (data.messages?.length || 0));
        return data.messages || [];
      } else {
        // Backward compatibility for non-paginated response
        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        return messages;
      }
    } catch (error) {
      console.error('Error loading session messages:', error);
      return [];
    } finally {
      if (isInitialLoad) {
        setIsLoadingSessionMessages(false);
      } else {
        setIsLoadingMoreMessages(false);
      }
    }
  }, [messagesOffset]);

  // Load Cursor session messages from SQLite via backend
  const loadCursorSessionMessages = useCallback(async (projectPath, sessionId) => {
    if (!projectPath || !sessionId) return [];
    setIsLoadingSessionMessages(true);
    try {
      const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
      const res = await authenticatedFetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const blobs = data?.session?.messages || [];
      return convertCursorBlobs(blobs, projectPath);
    } catch (e) {
      console.error('Error loading Cursor session messages:', e);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  // Memoize expensive convertSessionMessages operation
  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  // Note: Token budgets are not saved to JSONL files, only sent via WebSocket
  // So we don't try to extract them from loaded sessionMessages

  // Define scroll functions early to avoid hoisting issues in useEffect dependencies
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      // Don't reset isUserScrolledUp here - let the scroll handler manage it
      // This prevents fighting with user's scroll position during streaming
    }
  }, []);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Consider "near bottom" if within 50px of the bottom
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(async (container) => {
    if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return false;
    if (!hasMoreMessages || !selectedSession || !selectedProject) return false;

    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider === 'cursor') return false;

    isLoadingMoreRef.current = true;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;

    try {
      const moreMessages = await loadSessionMessages(
        selectedProject.name,
        selectedSession.id,
        true,
        sessionProvider
      );

      if (moreMessages.length > 0) {
        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop
        };
        // Prepend new messages to the existing ones
        setSessionMessages(prev => [...moreMessages, ...prev]);
      }
      return true;
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [hasMoreMessages, isLoadingMoreMessages, selectedSession, selectedProject, loadSessionMessages]);

  // Handle scroll events to detect when user manually scrolls up and load more messages
  const handleScroll = useCallback(async () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);
      
      // Check if we should load more messages (scrolled near top)
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
      } else if (!topLoadLockRef.current) {
        const didLoad = await loadOlderMessages(container);
        if (didLoad) {
          topLoadLockRef.current = true;
        }
      }
    }
  }, [isNearBottom, loadOlderMessages]);

  // Restore scroll position after paginated messages render
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - height;

    container.scrollTop = top + Math.max(scrollDiff, 0);
    pendingScrollRestoreRef.current = null;
  }, [chatMessages.length]);

  useEffect(() => {
    // Load session messages when session changes
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const provider = localStorage.getItem('selected-provider') || 'claude';

        // Mark that we're loading a session to prevent multiple scroll triggers
        isLoadingSessionRef.current = true;

        // Only reset state if the session ID actually changed (not initial load)
        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        if (sessionChanged) {
          if (!isSystemSessionChange) {
            // Clear any streaming leftovers from the previous session
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
          }
          // Reset pagination state when switching sessions
          setMessagesOffset(0);
          setHasMoreMessages(false);
          setTotalMessages(0);
          // Reset token budget when switching sessions
          // It will update when user sends a message and receives new budget from WebSocket
          setTokenBudget(null);
          // Reset loading state when switching sessions (unless the new session is processing)
          // The restore effect will set it back to true if needed
          setIsLoading(false);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider
            });
          }
        } else if (currentSessionId === null) {
          // Initial load - reset pagination but not token budget
          setMessagesOffset(0);
          setHasMoreMessages(false);
          setTotalMessages(0);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider
            });
          }
        }
        
        if (provider === 'cursor') {
          // For Cursor, set the session ID for resuming
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);
          
          // Only load messages from SQLite if this is NOT a system-initiated session change
          // For system-initiated changes, preserve existing messages
          if (!isSystemSessionChange) {
            // Load historical messages for Cursor session from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        } else {
          // For Claude, load messages normally with pagination
          setCurrentSessionId(selectedSession.id);
          
          // Only load messages from API if this is a user-initiated session change
          // For system-initiated changes, preserve existing messages and rely on WebSocket
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false, selectedSession.__provider || 'claude');
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo
            // Scroll will be handled by the main scroll useEffect after messages are rendered
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        }
      } else {
        // New session view (no selected session) - always reset UI state
        if (!isSystemSessionChange) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
          setSessionMessages([]);
          setClaudeStatus(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        setMessagesOffset(0);
        setHasMoreMessages(false);
        setTotalMessages(0);
        setTokenBudget(null);
      }

      // Mark loading as complete after messages are set
      // Use setTimeout to ensure state updates and DOM rendering are complete
      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [selectedSession, selectedProject, loadCursorSessionMessages, scrollToBottom, isSystemSessionChange, resetStreamingState]);

  // External Message Update Handler: Reload messages when external CLI modifies current session
  // This triggers when App.jsx detects a JSONL file change for the currently-viewed session
  // Only reloads if the session is NOT active (respecting Session Protection System)
  useEffect(() => {
    if (externalMessageUpdate > 0 && selectedSession && selectedProject) {
      const reloadExternalMessages = async () => {
        try {
          const provider = localStorage.getItem('selected-provider') || 'claude';

          if (provider === 'cursor') {
            // Reload Cursor messages from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reload Claude/Codex messages from API/JSONL
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false, selectedSession.__provider || 'claude');
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo

            // Smart scroll behavior: only auto-scroll if user is near bottom
            const shouldAutoScroll = autoScrollToBottom && isNearBottom();
            if (shouldAutoScroll) {
              setTimeout(() => scrollToBottom(), 200);
            }
            // If user scrolled up, preserve their position (they're reading history)
          }
        } catch (error) {
          console.error('Error reloading messages from external update:', error);
        }
      };

      reloadExternalMessages();
    }
  }, [externalMessageUpdate, selectedSession, selectedProject, loadCursorSessionMessages, loadSessionMessages, isNearBottom, autoScrollToBottom, scrollToBottom]);

  // When the user navigates to a specific session, clear any pending "new session" marker.
  useEffect(() => {
    if (selectedSession?.id) {
      pendingViewSessionRef.current = null;
    }
  }, [selectedSession?.id]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
    }
  }, [convertedMessages, sessionMessages]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  // Track processing state: notify parent when isLoading becomes true
  // Note: onSessionNotProcessing is called directly in completion message handlers
  useEffect(() => {
    if (currentSessionId && isLoading && onSessionProcessing) {
      onSessionProcessing(currentSessionId);
    }
  }, [isLoading, currentSessionId, onSessionProcessing]);

  // Restore processing state when switching to a processing session
  useEffect(() => {
    if (currentSessionId && processingSessions) {
      const shouldBeProcessing = processingSessions.has(currentSessionId);
      if (shouldBeProcessing && !isLoading) {
        setIsLoading(true);
        setCanAbortSession(true); // Assume processing sessions can be aborted
      }
    }
  }, [currentSessionId, processingSessions]);

  // ── WebSocket message handler (extracted hook) ────────────────────
  useWebSocketHandler({
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
    // Session protection callbacks (from ChatContext)
    onSessionInactive,
    onSessionNotProcessing,
    onSessionProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
  });

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop
      };
    }
  });

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollContainerRef.current && chatMessages.length > 0) {
      if (autoScrollToBottom) {
        // If auto-scroll is enabled, always scroll to bottom unless user has manually scrolled up
        if (!isUserScrolledUp) {
          setTimeout(() => scrollToBottom(), 50); // Small delay to ensure DOM is updated
        }
      } else {
        // When auto-scroll is disabled, preserve the visual position
        const container = scrollContainerRef.current;
        const prevHeight = scrollPositionRef.current.height;
        const prevTop = scrollPositionRef.current.top;
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - prevHeight;

        // If content was added above the current view, adjust scroll position
        if (heightDiff > 0 && prevTop > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      }
    }
  }, [chatMessages.length, isUserScrolledUp, scrollToBottom, autoScrollToBottom]);

  // Scroll to bottom when messages first load after session switch
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0 && !isLoadingSessionRef.current) {
      // Only scroll if we're not in the middle of loading a session
      // This prevents the "double scroll" effect during session switching
      // Reset scroll state when switching sessions
      setIsUserScrolledUp(false);
      setTimeout(() => {
        scrollToBottom();
        // After scrolling, the scroll event handler will naturally set isUserScrolledUp based on position
      }, 200); // Delay to ensure full rendering
    }
  }, [selectedSession?.id, selectedProject?.name]); // Only trigger when session/project changes

  // Add scroll event listener to detect user scrolling
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Load token usage when session changes for Claude sessions only
  // (Codex token usage is included in messages response, Cursor doesn't support it)
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = selectedSession.__provider || 'claude';

    // Skip for Codex (included in messages) and Cursor (not supported)
    if (sessionProvider !== 'claude') {
      return;
    }

    // Fetch token usage for Claude sessions
    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedSession?.id, selectedSession?.__provider, selectedProject?.path]);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedProject) return;

    // Apply thinking mode prefix if selected
    let messageContent = input;
    const selectedThinkingMode = thinkingModes.find(mode => mode.id === thinkingMode);
    if (selectedThinkingMode && selectedThinkingMode.prefix) {
      messageContent = `${selectedThinkingMode.prefix}: ${input}`;
    }

    // Upload images first if any
    let uploadedImages = [];
    if (attachedImages.length > 0) {
      const formData = new FormData();
      attachedImages.forEach(file => {
        formData.append('images', file);
      });
      
      try {
        const response = await authenticatedFetch(`/api/projects/${selectedProject.name}/upload-images`, {
          method: 'POST',
          headers: {}, // Let browser set Content-Type for FormData
          body: formData
        });
        
        if (!response.ok) {
          throw new Error('Failed to upload images');
        }
        
        const result = await response.json();
        uploadedImages = result.images;
      } catch (error) {
        console.error('Image upload failed:', error);
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Failed to upload images: ${error.message}`,
          timestamp: new Date()
        }]);
        return;
      }
    }

    const userMessage = {
      type: 'user',
      content: input,
      images: uploadedImages,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setCanAbortSession(true);
    // Set a default status when starting
    setClaudeStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true
    });
    
    // Always scroll to bottom when user sends a message and reset scroll state
    setIsUserScrolledUp(false); // Reset scroll state so auto-scroll works for Claude's response
    setTimeout(() => scrollToBottom(), 100); // Longer delay to ensure message is rendered

    // Determine effective session id for replies to avoid race on state updates
    const effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');

    // Session Protection: Mark session as active to prevent automatic project updates during conversation
    // Use existing session if available; otherwise a temporary placeholder until backend provides real ID
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    if (!effectiveSessionId && !selectedSession?.id) {
      // We are starting a brand-new session in this view. Track it so we only
      // accept streaming updates for this run.
      pendingViewSessionRef.current = { sessionId: null, startedAt: Date.now() };
    }
    if (onSessionActive) {
      onSessionActive(sessionToActivate);
    }

    // Get tools settings from localStorage based on provider
    const getToolsSettings = () => {
      try {
        const settingsKey = provider === 'cursor' ? 'cursor-tools-settings' : provider === 'codex' ? 'codex-settings' : 'claude-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }
      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
      };
    };

    const toolsSettings = getToolsSettings();

    // Send command based on provider
    let sent = false;
    if (provider === 'cursor') {
      // Send Cursor command (always use cursor-command; include resume/sessionId when replying)
      const msg = {
        type: 'cursor-command',
        command: messageContent,
        options: {
          // Prefer fullPath (actual cwd for project), fallback to path
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          resume: !!effectiveSessionId,
          model: cursorModel,
          skipPermissions: toolsSettings?.skipPermissions || false,
          toolsSettings: toolsSettings
        }
      };
      if (effectiveSessionId) {
        msg.sessionId = effectiveSessionId;
        msg.options.sessionId = effectiveSessionId;
      }
      sent = sendMessage(msg);
    } else if (provider === 'codex') {
      // Send Codex command
      const msg = {
        type: 'codex-command',
        command: messageContent,
        options: {
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          resume: !!effectiveSessionId,
          model: codexModel,
          permissionMode: permissionMode === 'plan' ? 'default' : permissionMode
        }
      };
      if (effectiveSessionId) {
        msg.sessionId = effectiveSessionId;
        msg.options.sessionId = effectiveSessionId;
      }
      sent = sendMessage(msg);
    } else {
      // Send Claude command
      const msg = {
        type: 'claude-command',
        command: messageContent,
        options: {
          projectPath: selectedProject.path,
          cwd: selectedProject.fullPath,
          resume: !!currentSessionId,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          model: claudeModel,
          images: uploadedImages
        }
      };
      if (currentSessionId) {
        msg.options.sessionId = currentSessionId;
      }
      sent = sendMessage(msg);
    }

    if (!sent) {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setChatMessages(prev => [...prev, {
        type: 'error',
        content: 'Message could not be sent — connection lost. Please try again or refresh the page.',
        timestamp: new Date()
      }]);
      return;
    }

    setInput('');
    setAttachedImages([]);
    setUploadingImages(new Map());
    setImageErrors(new Map());
    setIsTextareaExpanded(false);
    setThinkingMode('none'); // Reset thinking mode after sending

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Clear the saved draft since message was sent
    if (selectedProject) {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, isLoading, selectedProject, attachedImages, currentSessionId, selectedSession, provider, permissionMode, onSessionActive, cursorModel, claudeModel, codexModel, sendMessage, setInput, setAttachedImages, setUploadingImages, setImageErrors, setIsTextareaExpanded, textareaRef, setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setIsUserScrolledUp, scrollToBottom, thinkingMode]);

  // Store handleSubmit in ref so handleCustomCommand can access it
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const selectCommand = (command) => {
    if (!command) return;

    // Prepare the input with command name and any arguments that were already typed
    const textBeforeSlash = input.slice(0, slashPosition);
    const textAfterSlash = input.slice(slashPosition);
    const spaceIndex = textAfterSlash.indexOf(' ');
    const textAfterQuery = spaceIndex !==-1 ? textAfterSlash.slice(spaceIndex) : '';

    const newInput = textBeforeSlash + command.name + ' ' + textAfterQuery;

    // Update input temporarily so executeCommand can parse arguments
    setInput(newInput);

    // Hide command menu
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    // Clear debounce timer
    if (commandQueryTimerRef.current) {
      clearTimeout(commandQueryTimerRef.current);
    }

    // Execute the command (which will load its content and send to Claude)
    executeCommand(command);
  };

  const handleKeyDown = (e) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommand(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommand(filteredCommands[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandMenu(false);
        setSlashPosition(-1);
        setCommandQuery('');
        setSelectedCommandIndex(-1);
        if (commandQueryTimerRef.current) {
          clearTimeout(commandQueryTimerRef.current);
        }
        return;
      }
    }

    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }
    
    // Handle Tab key for mode switching (only when dropdowns are not showing)
    if (e.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
      e.preventDefault();
      handleModeSwitch();
      return;
    }
    
    // Handle Enter key: Ctrl+Enter (Cmd+Enter on Mac) sends, Shift+Enter creates new line
    if (e.key === 'Enter') {
      // If we're in composition, don't send message
      if (e.nativeEvent.isComposing) {
        return; // Let IME handle the Enter key
      }
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Plain Enter: Send message only if not in IME composition
        if (!sendByCtrlEnter) {
          e.preventDefault();
          handleSubmit(e);
        }
      }
      // Shift+Enter: Allow default behavior (new line)
    }
  };

  const handleAbortSession = () => {
    if (currentSessionId && canAbortSession) {
      sendMessage({
        type: 'abort-session',
        sessionId: currentSessionId,
        provider: provider
      });
    }
  };

  // Don't render if no project is selected
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Claude</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area - Scrollable Middle Section */}
      <div 
        ref={scrollContainerRef}
        onWheel={handleScroll}
        onTouchMove={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
      >
        {isLoadingSessionMessages && chatMessages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
              <p>Loading session messages...</p>
            </div>
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            {(!selectedSession && !currentSessionId) && (
              <WelcomeScreen
                hasSession={false}
                provider={provider}
                setProvider={setProvider}
                claudeModel={claudeModel}
                setClaudeModel={setClaudeModel}
                cursorModel={cursorModel}
                setCursorModel={setCursorModel}
                codexModel={codexModel}
                setCodexModel={setCodexModel}
                tasksEnabled={tasksEnabled}
                isTaskMasterInstalled={isTaskMasterInstalled}
                onSetInput={setInput}
                onShowAllTasks={onShowAllTasks}
                textareaRef={textareaRef}
              />
            )}
            {selectedSession && (
              <WelcomeScreen
                hasSession={true}
                tasksEnabled={tasksEnabled}
                isTaskMasterInstalled={isTaskMasterInstalled}
                onSetInput={setInput}
                onShowAllTasks={onShowAllTasks}
              />
            )}
          </div>
        ) : (
          <>
            {/* Loading indicator for older messages */}
            {isLoadingMoreMessages && (
              <div className="text-center text-gray-500 dark:text-gray-400 py-3">
                <div className="flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                  <p className="text-sm">Loading older messages...</p>
                </div>
              </div>
            )}
            
            {/* Indicator showing there are more messages to load */}
            {hasMoreMessages && !isLoadingMoreMessages && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                {totalMessages > 0 && (
                  <span>
                    {`Showing ${sessionMessages.length} of ${totalMessages} messages`} •
                    <span className="text-xs">Scroll up to load more</span>
                  </span>
                )}
              </div>
            )}
            
            {/* Legacy message count indicator (for non-paginated view) */}
            {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                {`Showing last ${visibleMessageCount} messages (${chatMessages.length} total)`} •
                <button
                  className="ml-1 text-blue-600 hover:text-blue-700 underline"
                  onClick={loadEarlierMessages}
                >
                  Load earlier messages
                </button>
              </div>
            )}
            
            {visibleMessages.map((message, index) => {
              const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
              
              return (
                <MessageComponent
                  key={index}
                  message={message}
                  index={index}
                  prevMessage={prevMessage}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={handleGrantToolPermission}
                  autoExpandTools={autoExpandTools}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                />
              );
            })}
          </>
        )}
        
        {isLoading && (
          <div className="chat-message assistant">
            <div className="w-full">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1 bg-transparent">
                  {(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? (
                    <CursorLogo className="w-full h-full" />
                  ) : (localStorage.getItem('selected-provider') || 'claude') === 'codex' ? (
                    <CodexLogo className="w-full h-full" />
                  ) : (
                    <ClaudeLogo className="w-full h-full" />
                  )}
                </div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? 'Cursor' : (localStorage.getItem('selected-provider') || 'claude') === 'codex' ? 'Codex' : 'Claude'}</div>
                {/* Abort button removed - functionality not yet implemented at backend */}
              </div>
              <div className="w-full text-sm text-gray-500 dark:text-gray-400 pl-3 sm:pl-0">
                <div className="flex items-center space-x-1">
                  <div className="animate-pulse">●</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</div>
                  <span className="ml-2">Thinking...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>


      {/* Input Area - Fixed Bottom */}
      <ChatInput
        // Input state (from useChatInput)
        input={input}
        setInput={setInput}
        isTextareaExpanded={isTextareaExpanded}
        setIsTextareaExpanded={setIsTextareaExpanded}
        setCursorPosition={setCursorPosition}
        textareaRef={textareaRef}
        inputHighlightRef={inputHighlightRef}
        inputContainerRef={inputContainerRef}
        handleInputChange={handleInputChange}
        handlePaste={handlePaste}
        handleImageFiles={handleImageFiles}
        handleTextareaClick={handleTextareaClick}
        handleTranscript={handleTranscript}
        syncInputOverlayScroll={syncInputOverlayScroll}
        renderInputWithMentions={renderInputWithMentions}
        selectFile={selectFile}
        // File dropdown
        showFileDropdown={showFileDropdown}
        filteredFiles={filteredFiles}
        selectedFileIndex={selectedFileIndex}
        // Command menu
        showCommandMenu={showCommandMenu}
        setShowCommandMenu={setShowCommandMenu}
        slashCommands={slashCommands}
        filteredCommands={filteredCommands}
        setFilteredCommands={setFilteredCommands}
        commandQuery={commandQuery}
        setCommandQuery={setCommandQuery}
        selectedCommandIndex={selectedCommandIndex}
        setSelectedCommandIndex={setSelectedCommandIndex}
        slashPosition={slashPosition}
        setSlashPosition={setSlashPosition}
        frequentCommands={frequentCommands}
        handleCommandSelect={handleCommandSelect}
        // Image attachments
        attachedImages={attachedImages}
        setAttachedImages={setAttachedImages}
        uploadingImages={uploadingImages}
        imageErrors={imageErrors}
        // Permission state
        permissionMode={permissionMode}
        pendingPermissionRequests={pendingPermissionRequests}
        handlePermissionDecision={handlePermissionDecision}
        handleGrantToolPermission={handleGrantToolPermission}
        handleModeSwitch={handleModeSwitch}
        // Other state
        isLoading={isLoading}
        isInputFocused={isInputFocused}
        setIsInputFocused={setIsInputFocused}
        isUserScrolledUp={isUserScrolledUp}
        chatMessagesLength={chatMessages.length}
        claudeStatus={claudeStatus}
        tokenBudget={tokenBudget}
        provider={provider}
        thinkingMode={thinkingMode}
        setThinkingMode={setThinkingMode}
        showThinking={showThinking}
        sendByCtrlEnter={sendByCtrlEnter}
        scrollToBottom={scrollToBottom}
        handleAbortSession={handleAbortSession}
        handleSubmit={handleSubmit}
        handleKeyDown={handleKeyDown}
      />
    </div>
    </>
  );
}

export default React.memo(ChatInterface);
