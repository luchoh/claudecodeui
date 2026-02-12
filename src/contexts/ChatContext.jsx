/*
 * ChatContext.jsx - Session Protection & Display Settings Context
 *
 * Eliminates prop drilling through MainContent for values that originate
 * in App.jsx (or AppContent) and are consumed only by ChatInterface.
 *
 * Values provided:
 *   Session Protection callbacks:
 *     onSessionActive, onSessionInactive, onSessionProcessing,
 *     onSessionNotProcessing, onReplaceTemporarySession
 *   Session Protection state:
 *     processingSessions
 *   Navigation:
 *     onNavigateToSession
 *   Display settings:
 *     onShowSettings, autoExpandTools, showRawParameters,
 *     showThinking, autoScrollToBottom, sendByCtrlEnter
 *   External update trigger:
 *     externalMessageUpdate
 */

import React, { createContext, useContext } from 'react';

const ChatContext = createContext(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}

export function ChatProvider({
  // Session protection callbacks
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceTemporarySession,
  // Session protection state
  processingSessions,
  // Navigation
  onNavigateToSession,
  // Display settings
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  // External update trigger
  externalMessageUpdate,
  children,
}) {
  // Value object is intentionally not memoised here because every prop
  // already comes from useCallback / useLocalStorage in AppContent,
  // so reference equality is preserved across renders.
  const value = {
    onSessionActive,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    processingSessions,
    onNavigateToSession,
    onShowSettings,
    autoExpandTools,
    showRawParameters,
    showThinking,
    autoScrollToBottom,
    sendByCtrlEnter,
    externalMessageUpdate,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export default ChatContext;
