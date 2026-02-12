/**
 * useToolPermissions.js - Permission mode and tool approval state management
 *
 * Extracted from ChatInterface.jsx.
 *
 * Manages:
 * - permissionMode state with localStorage persistence per session
 * - pendingPermissionRequests queue (transient, not persisted)
 * - handlePermissionDecision (sends allow/deny to backend)
 * - handleGrantToolPermission (persists an allow rule locally)
 * - handleModeSwitch (cycles through permission modes)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { grantClaudeToolPermission } from '../utils/chatUtils';

/**
 * @param {Object} params
 * @param {string|null} params.sessionId - Currently selected session ID
 * @param {string} params.provider - Current provider ('claude' | 'cursor' | 'codex')
 * @param {Function} params.sendMessage - WebSocket sendMessage function
 * @param {Function} params.setClaudeStatus - Setter for Claude status indicator
 */
export default function useToolPermissions({ sessionId, provider, sendMessage, setClaudeStatus }) {
  const [permissionMode, setPermissionMode] = useState('default');
  // In-memory queue of tool permission prompts for the current UI view.
  // These are not persisted and do not survive a page refresh; introduced so
  // the UI can present pending approvals while the SDK waits.
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState([]);

  // Track provider transitions so we only clear approvals when provider truly changes.
  // This does not sync with the backend; it just prevents UI prompts from disappearing.
  const lastProviderRef = useRef(provider);

  // Load permission mode for the current session
  useEffect(() => {
    if (sessionId) {
      const savedMode = localStorage.getItem(`permissionMode-${sessionId}`);
      if (savedMode) {
        setPermissionMode(savedMode);
      } else {
        setPermissionMode('default');
      }
    }
  }, [sessionId]);

  // Clear pending permission prompts when switching providers
  useEffect(() => {
    if (lastProviderRef.current !== provider) {
      setPendingPermissionRequests([]);
      lastProviderRef.current = provider;
    }
  }, [provider]);

  // When the selected session changes, drop prompts that belong to other sessions.
  useEffect(() => {
    setPendingPermissionRequests(prev =>
      prev.filter(req => !req.sessionId || req.sessionId === sessionId)
    );
  }, [sessionId]);

  const handleGrantToolPermission = useCallback((suggestion) => {
    if (!suggestion || provider !== 'claude') {
      return { success: false };
    }
    return grantClaudeToolPermission(suggestion.entry);
  }, [provider]);

  // Send a UI decision back to the server (single or batched request IDs).
  // This does not validate tool inputs or permissions; the backend enforces rules.
  // It exists so "Allow & remember" can resolve multiple queued prompts at once.
  const handlePermissionDecision = useCallback((requestIds, decision) => {
    const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
    const validIds = ids.filter(Boolean);
    if (validIds.length === 0) {
      return;
    }

    validIds.forEach((requestId) => {
      sendMessage({
        type: 'claude-permission-response',
        requestId,
        allow: Boolean(decision?.allow),
        updatedInput: decision?.updatedInput,
        message: decision?.message,
        rememberEntry: decision?.rememberEntry
      });
    });

    setPendingPermissionRequests(prev => {
      const next = prev.filter(req => !validIds.includes(req.requestId));
      if (next.length === 0) {
        setClaudeStatus(null);
      }
      return next;
    });
  }, [sendMessage, setClaudeStatus]);

  const handleModeSwitch = useCallback(() => {
    // Codex doesn't support plan mode
    const modes = provider === 'codex'
      ? ['default', 'acceptEdits', 'bypassPermissions']
      : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const newMode = modes[nextIndex];
    setPermissionMode(newMode);

    // Save mode for this session
    if (sessionId) {
      localStorage.setItem(`permissionMode-${sessionId}`, newMode);
    }
  }, [provider, permissionMode, sessionId]);

  return {
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleModeSwitch,
  };
}
