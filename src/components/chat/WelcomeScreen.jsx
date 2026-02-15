/**
 * WelcomeScreen.jsx - Provider selection and empty state UI
 *
 * Extracted from ChatInterface.jsx.
 * Renders the provider picker when no messages exist
 * and the "Continue your conversation" prompt for existing sessions.
 */

import React from 'react';
import ClaudeLogo from '../ClaudeLogo.jsx';
import CursorLogo from '../CursorLogo.jsx';
import CodexLogo from '../CodexLogo.jsx';
import NextTaskBanner from '../NextTaskBanner.jsx';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS } from '../../../shared/modelConstants';

/**
 * @param {Object} props
 * @param {boolean} props.hasSession - Whether a session is selected
 * @param {string} props.provider - Current provider
 * @param {Function} props.setProvider - Provider setter
 * @param {string} props.claudeModel - Current Claude model
 * @param {Function} props.setClaudeModel - Claude model setter
 * @param {string} props.cursorModel - Current Cursor model
 * @param {Function} props.setCursorModel - Cursor model setter
 * @param {string} props.codexModel - Current Codex model
 * @param {Function} props.setCodexModel - Codex model setter
 * @param {boolean} props.tasksEnabled - Whether tasks feature is enabled
 * @param {boolean} props.isTaskMasterInstalled - Whether TaskMaster is installed
 * @param {Function} props.onSetInput - Set input value (for NextTaskBanner)
 * @param {Function} props.onShowAllTasks - Show all tasks handler
 * @param {Object} props.textareaRef - Ref to textarea for focus after selection
 */
function WelcomeScreen({
  hasSession,
  provider,
  setProvider,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  tasksEnabled,
  isTaskMasterInstalled,
  onSetInput,
  onShowAllTasks,
  textareaRef,
}) {
  if (hasSession) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
        <p className="font-bold text-lg sm:text-xl mb-3">Continue your conversation</p>
        <p className="text-sm sm:text-base leading-relaxed">
          Ask questions about your code, request changes, or get help with development tasks
        </p>

        {tasksEnabled && isTaskMasterInstalled && (
          <div className="mt-4 px-4 sm:px-0">
            <NextTaskBanner
              onStartTask={() => onSetInput('Start the next task')}
              onShowAllTasks={onShowAllTasks}
            />
          </div>
        )}
      </div>
    );
  }

  const handleProviderSelect = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('selected-provider', newProvider);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleStartChat = () => {
    const nextProvider = provider || 'claude';
    if (!provider) {
      setProvider(nextProvider);
      localStorage.setItem('selected-provider', nextProvider);
    }
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const modelOptions = provider === 'claude' ? CLAUDE_MODELS.OPTIONS
    : provider === 'codex' ? CODEX_MODELS.OPTIONS
    : CURSOR_MODELS.OPTIONS;

  const currentModel = provider === 'claude' ? claudeModel
    : provider === 'codex' ? codexModel
    : cursorModel;

  const setCurrentModel = (val) => {
    if (provider === 'claude') { setClaudeModel(val); localStorage.setItem('claude-model', val); }
    else if (provider === 'codex') { setCodexModel(val); localStorage.setItem('codex-model', val); }
    else { setCursorModel(val); localStorage.setItem('cursor-model', val); }
  };

  return (
    <div className="text-center px-4 py-3 w-full max-w-md mx-auto">
      {/* Provider selection — horizontal row */}
      <div className="flex gap-2 justify-center mb-3">
        <ProviderPill
          name="Claude"
          isSelected={provider === 'claude'}
          color="blue"
          onClick={() => handleProviderSelect('claude')}
          Logo={ClaudeLogo}
        />
        <ProviderPill
          name="Cursor"
          isSelected={provider === 'cursor'}
          color="purple"
          onClick={() => handleProviderSelect('cursor')}
          Logo={CursorLogo}
        />
        <ProviderPill
          name="Codex"
          isSelected={provider === 'codex'}
          color="gray"
          onClick={() => handleProviderSelect('codex')}
          Logo={CodexLogo}
        />
      </div>

      {/* Model selector + Start button */}
      <div className={`transition-all duration-200 ${provider ? 'opacity-100 max-h-24' : 'opacity-0 max-h-0 overflow-hidden pointer-events-none'}`}>
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Model</label>
            <select
              value={currentModel}
              onChange={(e) => setCurrentModel(e.target.value)}
              className="pl-3 pr-8 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-primary/50 focus:border-primary min-w-[120px]"
            >
              {modelOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleStartChat}
            className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-semibold transition-all duration-150 active:scale-[0.97]"
          >
            Start
          </button>
        </div>
      </div>

      {provider && tasksEnabled && isTaskMasterInstalled && (
        <div className="mt-3 px-4 sm:px-0">
          <NextTaskBanner
            onStartTask={() => onSetInput('Start the next task')}
            onShowAllTasks={onShowAllTasks}
          />
        </div>
      )}
    </div>
  );
}

// ── Helper: Compact provider pill ─────────────────────────────────
const pillColors = {
  blue: {
    selected: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-blue-400 bg-white dark:bg-gray-800',
    check: 'text-blue-500',
  },
  purple: {
    selected: 'border-purple-500 bg-purple-50 dark:bg-purple-950/30 ring-2 ring-purple-500/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-purple-400 bg-white dark:bg-gray-800',
    check: 'text-purple-500',
  },
  gray: {
    selected: 'border-gray-800 dark:border-gray-300 bg-gray-50 dark:bg-gray-800/50 ring-2 ring-gray-800/20 dark:ring-gray-300/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-gray-500 dark:hover:border-gray-400 bg-white dark:bg-gray-800',
    check: 'text-gray-800 dark:text-gray-300',
  },
};

function ProviderPill({ name, isSelected, color, onClick, Logo }) {
  const colors = pillColors[color] || pillColors.blue;
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl border-2 transition-all duration-150 active:scale-[0.97] min-w-[100px] ${
        isSelected ? colors.selected : colors.hover
      }`}
    >
      <Logo className="w-8 h-8" />
      <span className="text-xs font-medium text-gray-900 dark:text-white">{name}</span>
      {isSelected && (
        <svg className={`absolute top-1.5 right-1.5 w-4 h-4 ${colors.check}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

export default React.memo(WelcomeScreen);
