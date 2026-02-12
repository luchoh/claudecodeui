// @vitest-environment jsdom
/**
 * Tests for WelcomeScreen component
 * src/components/chat/WelcomeScreen.jsx
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child logo components — they use ThemeContext which we don't want to set up
vi.mock('../../src/components/ClaudeLogo.jsx', () => ({
  default: ({ className }) => <div data-testid="claude-logo" className={className}>Claude Logo</div>,
}));

vi.mock('../../src/components/CursorLogo.jsx', () => ({
  default: ({ className }) => <div data-testid="cursor-logo" className={className}>Cursor Logo</div>,
}));

vi.mock('../../src/components/CodexLogo.jsx', () => ({
  default: ({ className }) => <div data-testid="codex-logo" className={className}>Codex Logo</div>,
}));

// Mock NextTaskBanner — it depends on TaskMasterContext and heavy API logic
vi.mock('../../src/components/NextTaskBanner.jsx', () => ({
  default: ({ onStartTask, onShowAllTasks }) => (
    <div data-testid="next-task-banner">
      <button onClick={onStartTask}>Start Next Task</button>
      <button onClick={onShowAllTasks}>Show All Tasks</button>
    </div>
  ),
}));

// Mock modelConstants
vi.mock('../../../shared/modelConstants', () => ({
  CLAUDE_MODELS: {
    OPTIONS: [
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
      { value: 'haiku', label: 'Haiku' },
    ],
    DEFAULT: 'sonnet',
  },
  CURSOR_MODELS: {
    OPTIONS: [
      { value: 'gpt-5.2', label: 'GPT-5.2' },
      { value: 'auto', label: 'Auto' },
    ],
    DEFAULT: 'gpt-5',
  },
  CODEX_MODELS: {
    OPTIONS: [
      { value: 'gpt-5.2', label: 'GPT-5.2' },
      { value: 'o3', label: 'O3' },
    ],
    DEFAULT: 'gpt-5.2',
  },
}));

import WelcomeScreen from '../../src/components/chat/WelcomeScreen.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWelcomeScreen(overrides = {}) {
  const defaultProps = {
    hasSession: false,
    provider: '',
    setProvider: vi.fn(),
    claudeModel: 'sonnet',
    setClaudeModel: vi.fn(),
    cursorModel: 'gpt-5.2',
    setCursorModel: vi.fn(),
    codexModel: 'gpt-5.2',
    setCodexModel: vi.fn(),
    tasksEnabled: false,
    isTaskMasterInstalled: false,
    onSetInput: vi.fn(),
    onShowAllTasks: vi.fn(),
    textareaRef: { current: { focus: vi.fn() } },
    ...overrides,
  };
  return { ...render(<WelcomeScreen {...defaultProps} />), props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests — provider selection (no session)
// ---------------------------------------------------------------------------

describe('WelcomeScreen — provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub localStorage.setItem so the component doesn't throw
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  it('renders the heading and provider buttons', () => {
    renderWelcomeScreen();

    expect(screen.getByText('Choose Your AI Assistant')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
  });

  it('renders the provider subtitles', () => {
    renderWelcomeScreen();

    expect(screen.getByText('by Anthropic')).toBeInTheDocument();
    expect(screen.getByText('AI Code Editor')).toBeInTheDocument();
    expect(screen.getByText('by OpenAI')).toBeInTheDocument();
  });

  it('calls setProvider when clicking Claude Code', () => {
    const { props } = renderWelcomeScreen();

    fireEvent.click(screen.getByText('Claude Code'));
    expect(props.setProvider).toHaveBeenCalledWith('claude');
  });

  it('calls setProvider when clicking Cursor', () => {
    const { props } = renderWelcomeScreen();

    fireEvent.click(screen.getByText('Cursor'));
    expect(props.setProvider).toHaveBeenCalledWith('cursor');
  });

  it('calls setProvider when clicking Codex', () => {
    const { props } = renderWelcomeScreen();

    fireEvent.click(screen.getByText('Codex'));
    expect(props.setProvider).toHaveBeenCalledWith('codex');
  });

  it('saves selected provider to localStorage', () => {
    renderWelcomeScreen();

    fireEvent.click(screen.getByText('Claude Code'));
    expect(localStorage.setItem).toHaveBeenCalledWith('selected-provider', 'claude');
  });

  it('shows "Select a provider above to begin" when no provider selected', () => {
    renderWelcomeScreen({ provider: '' });
    expect(screen.getByText('Select a provider above to begin')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — model selector
// ---------------------------------------------------------------------------

describe('WelcomeScreen — model selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  it('shows Claude model selector when provider is claude', () => {
    renderWelcomeScreen({ provider: 'claude' });

    expect(screen.getByText('Select Model')).toBeInTheDocument();
    // Should contain Claude model options
    expect(screen.getByText('Sonnet')).toBeInTheDocument();
    expect(screen.getByText('Opus')).toBeInTheDocument();
    expect(screen.getByText('Haiku')).toBeInTheDocument();
  });

  it('shows Cursor model selector when provider is cursor', () => {
    renderWelcomeScreen({ provider: 'cursor' });

    expect(screen.getByText('Select Model')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.2')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('shows Codex model selector when provider is codex', () => {
    renderWelcomeScreen({ provider: 'codex' });

    expect(screen.getByText('Select Model')).toBeInTheDocument();
    expect(screen.getByText('O3')).toBeInTheDocument();
  });

  it('calls setClaudeModel when changing Claude model', () => {
    const { props } = renderWelcomeScreen({ provider: 'claude' });

    const select = screen.getByDisplayValue('Sonnet');
    fireEvent.change(select, { target: { value: 'opus' } });
    expect(props.setClaudeModel).toHaveBeenCalledWith('opus');
  });

  it('shows ready message with selected model', () => {
    renderWelcomeScreen({ provider: 'claude', claudeModel: 'sonnet' });
    expect(
      screen.getByText('Ready to use Claude with sonnet. Start typing your message below.'),
    ).toBeInTheDocument();
  });

  it('shows ready message for Cursor provider', () => {
    renderWelcomeScreen({ provider: 'cursor', cursorModel: 'gpt-5.2' });
    expect(
      screen.getByText('Ready to use Cursor with gpt-5.2. Start typing your message below.'),
    ).toBeInTheDocument();
  });

  it('shows ready message for Codex provider', () => {
    renderWelcomeScreen({ provider: 'codex', codexModel: 'gpt-5.2' });
    expect(
      screen.getByText('Ready to use Codex with gpt-5.2. Start typing your message below.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — existing session ("Continue your conversation")
// ---------------------------------------------------------------------------

describe('WelcomeScreen — existing session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Continue your conversation" when hasSession is true', () => {
    renderWelcomeScreen({ hasSession: true });

    expect(screen.getByText('Continue your conversation')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ask questions about your code, request changes, or get help with development tasks',
      ),
    ).toBeInTheDocument();
  });

  it('does not show provider selection when hasSession is true', () => {
    renderWelcomeScreen({ hasSession: true });

    expect(screen.queryByText('Choose Your AI Assistant')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
  });

  it('shows NextTaskBanner when session exists with tasks enabled and TaskMaster installed', () => {
    renderWelcomeScreen({
      hasSession: true,
      tasksEnabled: true,
      isTaskMasterInstalled: true,
    });

    expect(screen.getByTestId('next-task-banner')).toBeInTheDocument();
  });

  it('does not show NextTaskBanner when tasksEnabled is false', () => {
    renderWelcomeScreen({
      hasSession: true,
      tasksEnabled: false,
      isTaskMasterInstalled: true,
    });

    expect(screen.queryByTestId('next-task-banner')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — NextTaskBanner in provider selection mode
// ---------------------------------------------------------------------------

describe('WelcomeScreen — NextTaskBanner in selection mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  it('shows NextTaskBanner when provider is selected and tasks are enabled', () => {
    renderWelcomeScreen({
      hasSession: false,
      provider: 'claude',
      tasksEnabled: true,
      isTaskMasterInstalled: true,
    });

    expect(screen.getByTestId('next-task-banner')).toBeInTheDocument();
  });

  it('does not show NextTaskBanner when no provider selected', () => {
    renderWelcomeScreen({
      hasSession: false,
      provider: '',
      tasksEnabled: true,
      isTaskMasterInstalled: true,
    });

    expect(screen.queryByTestId('next-task-banner')).not.toBeInTheDocument();
  });
});
