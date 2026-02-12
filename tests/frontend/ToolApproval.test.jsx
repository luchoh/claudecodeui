// @vitest-environment jsdom
/**
 * Tests for ToolApproval component
 * src/components/chat/ToolApproval.jsx
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the chatUtils module before importing the component
vi.mock('../../src/utils/chatUtils', () => ({
  getClaudeSettings: vi.fn(() => ({
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false,
    projectSortOrder: 'name',
  })),
  buildClaudeToolPermissionEntry: vi.fn((toolName, _input) => {
    if (!toolName) return null;
    if (toolName === 'Bash') return 'Bash(git:*)';
    return toolName;
  }),
  formatToolInputForDisplay: vi.fn((input) => {
    if (input === undefined || input === null) return '';
    if (typeof input === 'string') return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }),
}));

import ToolApproval from '../../src/components/chat/ToolApproval.jsx';
import {
  getClaudeSettings,
  buildClaudeToolPermissionEntry,
} from '../../src/utils/chatUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides = {}) {
  return {
    requestId: 'req-1',
    toolName: 'Read',
    input: '{"file_path": "/tmp/foo.txt"}',
    ...overrides,
  };
}

function renderToolApproval(propOverrides = {}) {
  const defaultProps = {
    pendingPermissionRequests: [],
    onPermissionDecision: vi.fn(),
    onGrantToolPermission: vi.fn(),
    ...propOverrides,
  };
  return { ...render(<ToolApproval {...defaultProps} />), props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mock behaviour
    getClaudeSettings.mockReturnValue({
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    });
    buildClaudeToolPermissionEntry.mockImplementation((toolName) => {
      if (!toolName) return null;
      if (toolName === 'Bash') return 'Bash(git:*)';
      return toolName;
    });
  });

  it('renders nothing when pendingPermissionRequests is an empty array', () => {
    const { container } = renderToolApproval({ pendingPermissionRequests: [] });
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when pendingPermissionRequests is null', () => {
    const { container } = renderToolApproval({ pendingPermissionRequests: null });
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when pendingPermissionRequests is undefined', () => {
    const { container } = renderToolApproval({ pendingPermissionRequests: undefined });
    expect(container.innerHTML).toBe('');
  });

  it('renders a permission request banner when a request is pending', () => {
    const request = makeRequest();
    renderToolApproval({ pendingPermissionRequests: [request] });

    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(screen.getByText('Allow once')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('displays the tool name correctly', () => {
    const request = makeRequest({ toolName: 'Write' });
    renderToolApproval({ pendingPermissionRequests: [request] });

    // The tool name appears in both the "Tool:" line and the "Allow rule:" line.
    // Query within the "Tool:" container specifically.
    const toolLabels = screen.getAllByText('Write');
    expect(toolLabels.length).toBeGreaterThanOrEqual(1);
    // Verify the "Tool: <toolName>" line is present
    expect(screen.getByText(/^Tool:/)).toBeInTheDocument();
  });

  it('displays the allow rule from buildClaudeToolPermissionEntry', () => {
    const request = makeRequest({ toolName: 'Bash', input: '{"command": "git status"}' });
    renderToolApproval({ pendingPermissionRequests: [request] });

    // buildClaudeToolPermissionEntry mock returns 'Bash(git:*)' for 'Bash'
    expect(screen.getByText('Bash(git:*)')).toBeInTheDocument();
  });

  it('calls onPermissionDecision with allow:true when Allow once is clicked', () => {
    const request = makeRequest({ requestId: 'req-42' });
    const { props } = renderToolApproval({ pendingPermissionRequests: [request] });

    fireEvent.click(screen.getByText('Allow once'));
    expect(props.onPermissionDecision).toHaveBeenCalledTimes(1);
    expect(props.onPermissionDecision).toHaveBeenCalledWith('req-42', { allow: true });
  });

  it('calls onPermissionDecision with allow:false when Deny is clicked', () => {
    const request = makeRequest({ requestId: 'req-99' });
    const { props } = renderToolApproval({ pendingPermissionRequests: [request] });

    fireEvent.click(screen.getByText('Deny'));
    expect(props.onPermissionDecision).toHaveBeenCalledTimes(1);
    expect(props.onPermissionDecision).toHaveBeenCalledWith('req-99', {
      allow: false,
      message: 'User denied tool use',
    });
  });

  it('calls onGrantToolPermission and onPermissionDecision when "Allow & remember" is clicked', () => {
    const request = makeRequest({ requestId: 'req-7', toolName: 'Read' });
    const { props } = renderToolApproval({ pendingPermissionRequests: [request] });

    fireEvent.click(screen.getByText('Allow & remember'));

    // Should grant the tool permission
    expect(props.onGrantToolPermission).toHaveBeenCalledWith({
      entry: 'Read',
      toolName: 'Read',
    });
    // Should also call onPermissionDecision with all matching request IDs
    expect(props.onPermissionDecision).toHaveBeenCalledWith(
      ['req-7'],
      { allow: true, rememberEntry: 'Read' },
    );
  });

  it('shows "Allow (saved)" label when tool is already in allowedTools', () => {
    getClaudeSettings.mockReturnValue({
      allowedTools: ['Read'],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    });

    const request = makeRequest({ toolName: 'Read' });
    renderToolApproval({ pendingPermissionRequests: [request] });

    expect(screen.getByText('Allow (saved)')).toBeInTheDocument();
  });

  it('renders multiple banners for multiple pending requests', () => {
    const requests = [
      makeRequest({ requestId: 'req-1', toolName: 'Read' }),
      makeRequest({ requestId: 'req-2', toolName: 'Write' }),
      makeRequest({ requestId: 'req-3', toolName: 'Bash' }),
    ];
    renderToolApproval({ pendingPermissionRequests: requests });

    const permissionLabels = screen.getAllByText('Permission required');
    expect(permissionLabels).toHaveLength(3);
  });

  it('shows tool input in a collapsible details section', () => {
    const request = makeRequest({ input: 'some raw input text' });
    renderToolApproval({ pendingPermissionRequests: [request] });

    expect(screen.getByText('View tool input')).toBeInTheDocument();
    expect(screen.getByText('some raw input text')).toBeInTheDocument();
  });

  it('batches matching request IDs for the "Allow & remember" button', () => {
    // Two requests that map to the same permission entry
    buildClaudeToolPermissionEntry.mockReturnValue('Read');
    const requests = [
      makeRequest({ requestId: 'req-a', toolName: 'Read', input: 'file1' }),
      makeRequest({ requestId: 'req-b', toolName: 'Read', input: 'file2' }),
    ];
    const { props } = renderToolApproval({ pendingPermissionRequests: requests });

    // Click the first "Allow & remember" button
    const rememberButtons = screen.getAllByText('Allow & remember');
    fireEvent.click(rememberButtons[0]);

    // Should batch both request IDs
    expect(props.onPermissionDecision).toHaveBeenCalledWith(
      ['req-a', 'req-b'],
      { allow: true, rememberEntry: 'Read' },
    );
  });
});
