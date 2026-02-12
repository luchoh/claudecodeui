// @vitest-environment jsdom
/**
 * Tests for useToolPermissions hook
 *
 * Covers:
 * - Initial state defaults
 * - localStorage-based permission mode persistence per session
 * - handleModeSwitch cycling through modes (with codex provider variant)
 * - handlePermissionDecision (single and batched)
 * - handleGrantToolPermission delegation to chatUtils
 * - pendingPermissionRequests management across session/provider changes
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chatUtils before importing the hook
vi.mock('../../src/utils/chatUtils', () => ({
  grantClaudeToolPermission: vi.fn(() => ({ success: true })),
  safeLocalStorage: {
    getItem: vi.fn((key) => {
      try { return localStorage.getItem(key); } catch { return null; }
    }),
    setItem: vi.fn((key, value) => {
      try { localStorage.setItem(key, value); } catch { /* noop */ }
    }),
    removeItem: vi.fn((key) => {
      try { localStorage.removeItem(key); } catch { /* noop */ }
    }),
  },
  escapeRegExp: vi.fn((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
}));

import useToolPermissions from '../../src/hooks/useToolPermissions';
import { grantClaudeToolPermission } from '../../src/utils/chatUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides = {}) {
  return {
    sessionId: 'session-1',
    provider: 'claude',
    sendMessage: vi.fn(),
    setClaudeStatus: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useToolPermissions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────

  describe('initial state', () => {
    it('returns default permission mode when localStorage is empty', () => {
      const { result } = renderHook(() => useToolPermissions(defaultProps()));

      expect(result.current.permissionMode).toBe('default');
      expect(result.current.pendingPermissionRequests).toEqual([]);
    });

    it('loads saved permission mode from localStorage for the session', () => {
      localStorage.setItem('permissionMode-session-1', 'acceptEdits');

      const { result } = renderHook(() => useToolPermissions(defaultProps()));

      expect(result.current.permissionMode).toBe('acceptEdits');
    });

    it('falls back to default when sessionId is null', () => {
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sessionId: null }))
      );

      expect(result.current.permissionMode).toBe('default');
    });
  });

  // ── handleModeSwitch ───────────────────────────────────────────────

  describe('handleModeSwitch', () => {
    it('cycles through all 4 modes for non-codex providers', () => {
      const { result } = renderHook(() => useToolPermissions(defaultProps()));

      // default -> acceptEdits
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('acceptEdits');

      // acceptEdits -> bypassPermissions
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('bypassPermissions');

      // bypassPermissions -> plan
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('plan');

      // plan -> default (wraps around)
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('default');
    });

    it('cycles through only 3 modes for codex provider (no plan)', () => {
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ provider: 'codex' }))
      );

      // default -> acceptEdits
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('acceptEdits');

      // acceptEdits -> bypassPermissions
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('bypassPermissions');

      // bypassPermissions -> default (wraps, no plan)
      act(() => result.current.handleModeSwitch());
      expect(result.current.permissionMode).toBe('default');
    });

    it('persists the new mode to localStorage', () => {
      const { result } = renderHook(() => useToolPermissions(defaultProps()));

      act(() => result.current.handleModeSwitch());

      expect(localStorage.getItem('permissionMode-session-1')).toBe('acceptEdits');
    });

    it('does not write to localStorage when sessionId is null', () => {
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sessionId: null }))
      );

      act(() => result.current.handleModeSwitch());

      // No key should have been written
      expect(localStorage.length).toBe(0);
    });
  });

  // ── Permission mode persistence across session changes ─────────────

  describe('session-based persistence', () => {
    it('loads the correct mode when sessionId changes', () => {
      localStorage.setItem('permissionMode-session-A', 'bypassPermissions');
      localStorage.setItem('permissionMode-session-B', 'plan');

      const props = defaultProps({ sessionId: 'session-A' });
      const { result, rerender } = renderHook(
        (p) => useToolPermissions(p),
        { initialProps: props }
      );

      expect(result.current.permissionMode).toBe('bypassPermissions');

      // Switch to session B
      rerender({ ...props, sessionId: 'session-B' });
      expect(result.current.permissionMode).toBe('plan');
    });

    it('resets to default when switching to a session with no saved mode', () => {
      localStorage.setItem('permissionMode-session-A', 'acceptEdits');

      const props = defaultProps({ sessionId: 'session-A' });
      const { result, rerender } = renderHook(
        (p) => useToolPermissions(p),
        { initialProps: props }
      );

      expect(result.current.permissionMode).toBe('acceptEdits');

      rerender({ ...props, sessionId: 'session-NEW' });
      expect(result.current.permissionMode).toBe('default');
    });
  });

  // ── handlePermissionDecision ───────────────────────────────────────

  describe('handlePermissionDecision', () => {
    it('sends a permission response message for a single requestId', () => {
      const sendMessage = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage }))
      );

      act(() => {
        result.current.handlePermissionDecision('req-1', { allow: true });
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'claude-permission-response',
        requestId: 'req-1',
        allow: true,
        updatedInput: undefined,
        message: undefined,
        rememberEntry: undefined,
      });
    });

    it('handles batched requestIds', () => {
      const sendMessage = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage }))
      );

      act(() => {
        result.current.handlePermissionDecision(
          ['req-1', 'req-2', 'req-3'],
          { allow: false, message: 'denied' }
        );
      });

      expect(sendMessage).toHaveBeenCalledTimes(3);
      expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: 'req-1', allow: false }));
      expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: 'req-2', allow: false }));
      expect(sendMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({ requestId: 'req-3', allow: false }));
    });

    it('filters out falsy requestIds', () => {
      const sendMessage = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage }))
      );

      act(() => {
        result.current.handlePermissionDecision(
          [null, undefined, '', 'req-valid'],
          { allow: true }
        );
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-valid' }));
    });

    it('does nothing when all requestIds are empty/falsy', () => {
      const sendMessage = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage }))
      );

      act(() => {
        result.current.handlePermissionDecision([null, ''], { allow: true });
      });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('removes resolved requests from pendingPermissionRequests', () => {
      const sendMessage = vi.fn();
      const setClaudeStatus = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage, setClaudeStatus }))
      );

      // Manually add pending requests
      act(() => {
        result.current.setPendingPermissionRequests([
          { requestId: 'req-1', toolName: 'bash' },
          { requestId: 'req-2', toolName: 'write' },
          { requestId: 'req-3', toolName: 'read' },
        ]);
      });

      expect(result.current.pendingPermissionRequests).toHaveLength(3);

      // Resolve req-1 and req-2
      act(() => {
        result.current.handlePermissionDecision(['req-1', 'req-2'], { allow: true });
      });

      expect(result.current.pendingPermissionRequests).toHaveLength(1);
      expect(result.current.pendingPermissionRequests[0].requestId).toBe('req-3');
    });

    it('clears claudeStatus when all pending requests are resolved', () => {
      const sendMessage = vi.fn();
      const setClaudeStatus = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage, setClaudeStatus }))
      );

      act(() => {
        result.current.setPendingPermissionRequests([
          { requestId: 'req-1', toolName: 'bash' },
        ]);
      });

      act(() => {
        result.current.handlePermissionDecision('req-1', { allow: true });
      });

      expect(setClaudeStatus).toHaveBeenCalledWith(null);
    });

    it('does not clear claudeStatus when pending requests remain', () => {
      const sendMessage = vi.fn();
      const setClaudeStatus = vi.fn();
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ sendMessage, setClaudeStatus }))
      );

      act(() => {
        result.current.setPendingPermissionRequests([
          { requestId: 'req-1', toolName: 'bash' },
          { requestId: 'req-2', toolName: 'write' },
        ]);
      });

      act(() => {
        result.current.handlePermissionDecision('req-1', { allow: true });
      });

      expect(setClaudeStatus).not.toHaveBeenCalled();
    });
  });

  // ── handleGrantToolPermission ──────────────────────────────────────

  describe('handleGrantToolPermission', () => {
    it('delegates to grantClaudeToolPermission for claude provider', () => {
      grantClaudeToolPermission.mockReturnValue({ success: true, alreadyAllowed: false });

      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ provider: 'claude' }))
      );

      let returnValue;
      act(() => {
        returnValue = result.current.handleGrantToolPermission({ entry: 'Bash(*)' });
      });

      expect(grantClaudeToolPermission).toHaveBeenCalledWith('Bash(*)');
      expect(returnValue).toEqual({ success: true, alreadyAllowed: false });
    });

    it('returns failure for non-claude providers', () => {
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ provider: 'cursor' }))
      );

      let returnValue;
      act(() => {
        returnValue = result.current.handleGrantToolPermission({ entry: 'Bash(*)' });
      });

      expect(grantClaudeToolPermission).not.toHaveBeenCalled();
      expect(returnValue).toEqual({ success: false });
    });

    it('returns failure when suggestion is null', () => {
      const { result } = renderHook(() =>
        useToolPermissions(defaultProps({ provider: 'claude' }))
      );

      let returnValue;
      act(() => {
        returnValue = result.current.handleGrantToolPermission(null);
      });

      expect(grantClaudeToolPermission).not.toHaveBeenCalled();
      expect(returnValue).toEqual({ success: false });
    });
  });

  // ── pendingPermissionRequests management ───────────────────────────

  describe('pendingPermissionRequests', () => {
    it('clears pending requests when provider changes', () => {
      const props = defaultProps({ provider: 'claude' });
      const { result, rerender } = renderHook(
        (p) => useToolPermissions(p),
        { initialProps: props }
      );

      // Add a pending request
      act(() => {
        result.current.setPendingPermissionRequests([
          { requestId: 'req-1', toolName: 'bash' },
        ]);
      });

      expect(result.current.pendingPermissionRequests).toHaveLength(1);

      // Switch provider
      rerender({ ...props, provider: 'cursor' });

      expect(result.current.pendingPermissionRequests).toEqual([]);
    });

    it('filters out requests from other sessions when sessionId changes', () => {
      const props = defaultProps({ sessionId: 'session-A' });
      const { result, rerender } = renderHook(
        (p) => useToolPermissions(p),
        { initialProps: props }
      );

      // Add requests - some tagged with sessionId, some without
      act(() => {
        result.current.setPendingPermissionRequests([
          { requestId: 'req-1', toolName: 'bash', sessionId: 'session-A' },
          { requestId: 'req-2', toolName: 'write', sessionId: 'session-B' },
          { requestId: 'req-3', toolName: 'read' }, // no sessionId - kept
        ]);
      });

      // Switch session
      rerender({ ...props, sessionId: 'session-B' });

      // req-1 (session-A) should be filtered out; req-2 (session-B) and req-3 (no session) stay
      const remaining = result.current.pendingPermissionRequests;
      expect(remaining).toHaveLength(2);
      expect(remaining.map(r => r.requestId)).toEqual(['req-2', 'req-3']);
    });
  });
});
