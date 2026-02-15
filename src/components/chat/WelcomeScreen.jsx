/**
 * WelcomeScreen.jsx - Provider selection and empty state UI
 *
 * Extracted from ChatInterface.jsx.
 * Renders the "Choose Your AI Assistant" screen when no messages exist
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

  return (
    <div className="text-center px-6 sm:px-4 py-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Choose Your AI Assistant</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Select a provider to start a new conversation
      </p>

      <div className="mb-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleStartChat}
          className="w-full sm:w-auto px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-base font-semibold shadow-sm transition-all duration-150 active:scale-[0.98]"
        >
          {"Start Chat"}
        </button>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {"Pick a provider below or start with your default."}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
        {/* Claude Button */}
        <ProviderButton
          name="Claude Code"
          subtitle="by Anthropic"
          isSelected={provider === 'claude'}
          color="blue"
          onClick={() => handleProviderSelect('claude')}
          Logo={ClaudeLogo}
        />

        {/* Cursor Button */}
        <ProviderButton
          name="Cursor"
          subtitle="AI Code Editor"
          isSelected={provider === 'cursor'}
          color="purple"
          onClick={() => handleProviderSelect('cursor')}
          Logo={CursorLogo}
        />

        {/* Codex Button */}
        <ProviderButton
          name="Codex"
          subtitle="by OpenAI"
          isSelected={provider === 'codex'}
          color="gray"
          onClick={() => handleProviderSelect('codex')}
          Logo={CodexLogo}
        />
      </div>

      {/* Model Selection */}
      <div className={`mb-6 transition-opacity duration-200 ${provider ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select Model
        </label>
        {provider === 'claude' ? (
          <select
            value={claudeModel}
            onChange={(e) => {
              const newModel = e.target.value;
              setClaudeModel(newModel);
              localStorage.setItem('claude-model', newModel);
            }}
            className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
          >
            {CLAUDE_MODELS.OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : provider === 'codex' ? (
          <select
            value={codexModel}
            onChange={(e) => {
              const newModel = e.target.value;
              setCodexModel(newModel);
              localStorage.setItem('codex-model', newModel);
            }}
            className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 min-w-[140px]"
          >
            {CODEX_MODELS.OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <select
            value={cursorModel}
            onChange={(e) => {
              const newModel = e.target.value;
              setCursorModel(newModel);
              localStorage.setItem('cursor-model', newModel);
            }}
            className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
            disabled={provider !== 'cursor'}
          >
            {CURSOR_MODELS.OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {provider === 'claude'
          ? `Ready to use Claude with ${claudeModel}. Start typing your message below.`
          : provider === 'cursor'
          ? `Ready to use Cursor with ${cursorModel}. Start typing your message below.`
          : provider === 'codex'
          ? `Ready to use Codex with ${codexModel}. Start typing your message below.`
          : "Select a provider above to begin"
        }
      </p>

      {provider && tasksEnabled && isTaskMasterInstalled && (
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

// ── Helper: Provider selection button ─────────────────────────────────
const colorMap = {
  blue: {
    selected: 'border-blue-500 shadow-lg ring-2 ring-blue-500/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-blue-400',
    check: 'bg-blue-500',
    checkText: 'text-white',
  },
  purple: {
    selected: 'border-purple-500 shadow-lg ring-2 ring-purple-500/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-purple-400',
    check: 'bg-purple-500',
    checkText: 'text-white',
  },
  gray: {
    selected: 'border-gray-800 dark:border-gray-300 shadow-lg ring-2 ring-gray-800/20 dark:ring-gray-300/20',
    hover: 'border-gray-200 dark:border-gray-700 hover:border-gray-500 dark:hover:border-gray-400',
    check: 'bg-gray-800 dark:bg-gray-300',
    checkText: 'text-white dark:text-gray-800',
  },
};

function ProviderButton({ name, subtitle, isSelected, color, onClick, Logo }) {
  const colors = colorMap[color] || colorMap.blue;
  return (
    <button
      onClick={onClick}
      className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
        isSelected ? colors.selected : colors.hover
      }`}
    >
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Logo className="w-10 h-10" />
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2">
          <div className={`w-5 h-5 ${colors.check} rounded-full flex items-center justify-center`}>
            <svg className={`w-3 h-3 ${colors.checkText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
    </button>
  );
}

export default React.memo(WelcomeScreen);
