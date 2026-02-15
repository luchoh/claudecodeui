/**
 * ChatInput.jsx - Chat input area extracted from ChatInterface.jsx
 *
 * Contains:
 * - Status bar (ClaudeStatus)
 * - ToolApproval banner
 * - Permission mode selector, thinking mode, token usage, commands button
 * - Textarea with file @-mention overlay, dropzone, image attachments
 * - Command menu, file dropdown
 * - Send button, image upload button
 */

import React from 'react';
import { useDropzone } from 'react-dropzone';
import ClaudeStatus from '../ClaudeStatus.jsx';
import ThinkingModeSelector from '../ThinkingModeSelector.jsx';
import TokenUsagePie from '../TokenUsagePie.jsx';
import CommandMenu from '../CommandMenu.jsx';
import { MicButton } from '../MicButton.jsx';
import { ImageAttachment } from './MessageItem';
import ToolApproval from './ToolApproval';

function ChatInput({
  // Input state (from useChatInput)
  input,
  setInput,
  isTextareaExpanded,
  setIsTextareaExpanded,
  setCursorPosition,
  textareaRef,
  inputHighlightRef,
  inputContainerRef,
  handleInputChange,
  handlePaste,
  handleImageFiles,
  handleTextareaClick,
  handleTranscript,
  syncInputOverlayScroll,
  renderInputWithMentions,
  selectFile,

  // File dropdown
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,

  // Command menu
  showCommandMenu,
  setShowCommandMenu,
  slashCommands,
  filteredCommands,
  setFilteredCommands,
  commandQuery,
  setCommandQuery,
  selectedCommandIndex,
  setSelectedCommandIndex,
  slashPosition,
  setSlashPosition,
  frequentCommands,
  handleCommandSelect,

  // Image attachments
  attachedImages,
  setAttachedImages,
  uploadingImages,
  imageErrors,

  // Permission state (from useToolPermissions)
  permissionMode,
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  handleModeSwitch,

  // Other ChatInterface state
  isLoading,
  isInputFocused,
  setIsInputFocused,
  isUserScrolledUp,
  chatMessagesLength,
  claudeStatus,
  tokenBudget,
  provider,
  thinkingMode,
  setThinkingMode,
  showThinking,
  sendByCtrlEnter,
  scrollToBottom,
  handleAbortSession,
  handleSubmit,
  handleKeyDown,
}) {
  // Setup dropzone
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    },
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDrop: handleImageFiles,
  });

  return (
    <div className={`chat-input-mobile p-2 sm:p-4 md:p-4 flex-shrink-0 ${
      isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-2 sm:pb-4 md:pb-6'
    }`}>

      <div className="flex-1">
        <ClaudeStatus
          status={claudeStatus}
          isLoading={isLoading}
          onAbort={handleAbortSession}
          provider={provider}
          showThinking={showThinking}
        />
      </div>
      {/* Permission Mode Selector with scroll to bottom button - Above input, clickable for mobile */}
      <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3">
        <ToolApproval
          pendingPermissionRequests={pendingPermissionRequests}
          onPermissionDecision={handlePermissionDecision}
          onGrantToolPermission={handleGrantToolPermission}
        />

        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleModeSwitch}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
              permissionMode === 'default'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                : permissionMode === 'acceptEdits'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                : permissionMode === 'bypassPermissions'
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            }`}
            title={`Permission mode: ${permissionMode === 'default' ? 'Default' : permissionMode === 'acceptEdits' ? 'Accept Edits' : permissionMode === 'bypassPermissions' ? 'Bypass Permissions' : 'Plan'} - Click to change (or press Tab in input)`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                permissionMode === 'default'
                  ? 'bg-gray-500'
                  : permissionMode === 'acceptEdits'
                  ? 'bg-green-500'
                  : permissionMode === 'bypassPermissions'
                  ? 'bg-orange-500'
                  : 'bg-blue-500'
              }`} />
              <span>
                {permissionMode === 'default' && "Default Mode"}
                {permissionMode === 'acceptEdits' && "Accept Edits"}
                {permissionMode === 'bypassPermissions' && "Bypass Permissions"}
                {permissionMode === 'plan' && "Plan Mode"}
              </span>
            </div>
          </button>

          {/* Thinking Mode Selector */}
          {provider === 'claude' && (
            <ThinkingModeSelector
              selectedMode={thinkingMode}
              onModeChange={setThinkingMode}
              className=""
            />
          )}
          {/* Token usage pie chart - positioned next to mode indicator */}
          <TokenUsagePie
            used={tokenBudget?.used || 0}
            total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000}
          />

          {/* Slash commands button */}
          <button
            type="button"
            onClick={() => {
              const isOpening = !showCommandMenu;
              setShowCommandMenu(isOpening);
              setCommandQuery('');
              setSelectedCommandIndex(-1);

              // When opening, ensure all commands are shown
              if (isOpening) {
                setFilteredCommands(slashCommands);
              }

              if (textareaRef.current) {
                textareaRef.current.focus();
              }
            }}
            className="relative flex items-center gap-1.5 px-2 py-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
            title={`${slashCommands.length} slash commands available`}
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            {/* Command count with label */}
            {slashCommands.length > 0 && (
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                <span className="hidden sm:inline">Cmds: </span>{slashCommands.length}
              </span>
            )}
          </button>

          {/* Clear input button */}
          {input.trim() && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInput('');
                if (textareaRef.current) {
                  textareaRef.current.style.height = 'auto';
                  textareaRef.current.focus();
                }
                setIsTextareaExpanded(false);
              }}
              className="w-8 h-8 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group shadow-sm"
              title="Clear input"
            >
              <svg
                className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}

          {/* Scroll to bottom button */}
          {isUserScrolledUp && chatMessagesLength > 0 && (
            <button
              onClick={scrollToBottom}
              className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
              title="Scroll to bottom"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
        {/* Drag overlay */}
        {isDragActive && (
          <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
              <svg className="w-8 h-8 text-blue-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium">Drop images here</p>
            </div>
          </div>
        )}

        {/* Image attachments preview */}
        {attachedImages.length > 0 && (
          <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex flex-wrap gap-2">
              {attachedImages.map((file, index) => (
                <ImageAttachment
                  key={index}
                  file={file}
                  onRemove={() => {
                    setAttachedImages(prev => prev.filter((_, i) => i !== index));
                  }}
                  uploadProgress={uploadingImages.get(file.name)}
                  error={imageErrors.get(file.name)}
                />
              ))}
            </div>
          </div>
        )}

        {/* File dropdown */}
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 backdrop-blur-sm">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectFile(file);
                }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {file.path}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Command Menu */}
        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={handleCommandSelect}
          onClose={() => {
            setShowCommandMenu(false);
            setSlashPosition(-1);
            setCommandQuery('');
            setSelectedCommandIndex(-1);
          }}
          position={{
            top: textareaRef.current
              ? Math.max(16, textareaRef.current.getBoundingClientRect().top - 316)
              : 0,
            left: textareaRef.current
              ? textareaRef.current.getBoundingClientRect().left
              : 16,
            bottom: textareaRef.current
              ? window.innerHeight - textareaRef.current.getBoundingClientRect().top + 8
              : 90
          }}
          isOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
        />

        <div {...getRootProps()} className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 overflow-hidden ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
          <input {...getInputProps()} />
          <div
            ref={inputHighlightRef}
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
          >
            <div className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 text-transparent text-base leading-6 whitespace-pre-wrap break-words">
              {renderInputWithMentions(input)}
            </div>
          </div>
          <div className="relative z-10">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onClick={handleTextareaClick}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={(e) => syncInputOverlayScroll(e.target)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
              setCursorPosition(e.target.selectionStart);
              syncInputOverlayScroll(e.target);

              const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
              const isExpanded = e.target.scrollHeight > lineHeight * 2;
              setIsTextareaExpanded(isExpanded);
            }}
            placeholder={`Type / for commands, @ for files, or ask ${provider === 'cursor' ? 'Cursor' : provider === 'codex' ? 'Codex' : 'Claude'} anything...`}
            disabled={isLoading}
            className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-base leading-6 transition-all duration-200"
            style={{ height: '50px' }}
          />
          {/* Image upload button */}
          <button
            type="button"
            onClick={open}
            className="absolute left-2 top-1/2 transform -translate-y-1/2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Attach images"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

          {/* Mic button - HIDDEN */}
          <div className="absolute right-16 sm:right-16 top-1/2 transform -translate-y-1/2" style={{ display: 'none' }}>
            <MicButton
              onTranscript={handleTranscript}
              className="w-10 h-10 sm:w-10 sm:h-10"
            />
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSubmit(e);
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              handleSubmit(e);
            }}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
          >
            <svg
              className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>

          {/* Hint text inside input box at bottom - Desktop only */}
          <div className={`absolute bottom-1 left-12 right-14 sm:right-40 text-xs text-gray-400 dark:text-gray-500 pointer-events-none hidden sm:block transition-opacity duration-200 ${
            input.trim() ? 'opacity-0' : 'opacity-100'
          }`}>
            {sendByCtrlEnter
              ? "Ctrl+Enter to send \u2022 Shift+Enter for new line \u2022 Tab to change modes \u2022 / for slash commands"
              : "Enter to send \u2022 Shift+Enter for new line \u2022 Tab to change modes \u2022 / for slash commands"}
          </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default React.memo(ChatInput);
