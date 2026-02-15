import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Eye,
  Settings2,
  Moon,
  Sun,
  ArrowDown,
  Mic,
  Brain,
  Sparkles,
  FileText,
  Languages,
  GripVertical,
  X
} from 'lucide-react';
import DarkModeToggle from './DarkModeToggle';
import { useTheme } from '../contexts/ThemeContext';

const QuickSettingsPanel = ({
  isOpen,
  onToggle,
  autoExpandTools,
  onAutoExpandChange,
  showRawParameters,
  onShowRawParametersChange,
  showThinking,
  onShowThinkingChange,
  autoScrollToBottom,
  onAutoScrollChange,
  sendByCtrlEnter,
  onSendByCtrlEnterChange,
  isMobile
}) => {
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);
  const [whisperMode, setWhisperMode] = useState(() => {
    return localStorage.getItem('whisperMode') || 'default';
  });
  const { isDarkMode } = useTheme();

  // Draggable handle state (desktop only)
  const [handlePosition, setHandlePosition] = useState(() => {
    const saved = localStorage.getItem('quickSettingsHandlePosition');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.y ?? 50;
      } catch {
        // Remove corrupted data
        localStorage.removeItem('quickSettingsHandlePosition');
        return 50;
      }
    }
    return 50; // Default to 50% (middle of screen)
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartPosition, setDragStartPosition] = useState(0);
  const [hasMoved, setHasMoved] = useState(false); // Track if user has moved during drag
  const handleRef = useRef(null);
  const constraintsRef = useRef({ min: 10, max: 90 }); // Percentage constraints
  const dragThreshold = 5; // Pixels to move before it's considered a drag

  useEffect(() => {
    setLocalIsOpen(isOpen);
  }, [isOpen]);

  // Save handle position to localStorage when it changes (desktop only)
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem('quickSettingsHandlePosition', JSON.stringify({ y: handlePosition }));
    }
  }, [handlePosition, isMobile]);

  // Calculate position from percentage (desktop only)
  const getPositionStyle = useCallback(() => {
    // On desktop, use top with percentage
    return { top: `${handlePosition}%`, transform: 'translateY(-50%)' };
  }, [handlePosition]);

  // Handle mouse/touch start (desktop only)
  const handleDragStart = useCallback((e) => {
    if (isMobile) return; // No dragging on mobile

    // Don't prevent default yet - we want to allow click if no drag happens
    e.stopPropagation();

    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    setDragStartY(clientY);
    setDragStartPosition(handlePosition);
    setHasMoved(false);
    setIsDragging(false); // Don't set dragging until threshold is passed
  }, [handlePosition, isMobile]);

  // Handle mouse/touch move (desktop only)
  const handleDragMove = useCallback((e) => {
    if (isMobile) return; // No dragging on mobile
    if (dragStartY === 0) return; // Not in a potential drag

    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const deltaY = Math.abs(clientY - dragStartY);

    // Check if we've moved past threshold
    if (!isDragging && deltaY > dragThreshold) {
      setIsDragging(true);
      setHasMoved(true);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    if (!isDragging) return;

    const actualDeltaY = clientY - dragStartY;

    // On desktop, moving down should increase top position
    const percentageDelta = (actualDeltaY / window.innerHeight) * 100;

    let newPosition = dragStartPosition + percentageDelta;

    // Apply constraints
    newPosition = Math.max(constraintsRef.current.min, Math.min(constraintsRef.current.max, newPosition));

    setHandlePosition(newPosition);
  }, [isDragging, dragStartY, dragStartPosition, isMobile, dragThreshold]);

  // Handle mouse/touch end (desktop only)
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragStartY(0);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Cleanup body styles on unmount in case component unmounts while dragging
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // Set up global event listeners for drag (desktop only)
  useEffect(() => {
    if (isMobile) return; // No drag listeners on mobile
    if (dragStartY !== 0) {
      // Mouse events
      const handleMouseMove = (e) => handleDragMove(e);
      const handleMouseUp = () => handleDragEnd();

      // Touch events
      const handleTouchMove = (e) => handleDragMove(e);
      const handleTouchEnd = () => handleDragEnd();

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [dragStartY, handleDragMove, handleDragEnd, isMobile]);

  const handleToggle = (e) => {
    // Don't toggle if user was dragging (desktop only)
    if (!isMobile && hasMoved) {
      e.preventDefault();
      setHasMoved(false);
      return;
    }

    const newState = !localIsOpen;
    setLocalIsOpen(newState);
    onToggle(newState);
  };

  // Shared settings content - extracted to avoid duplication
  const settingsContent = (
    <>
      {/* Appearance Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Appearance</h4>

        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            {isDarkMode ? <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" /> : <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
            Dark Mode
          </span>
          <DarkModeToggle />
        </div>

      </div>

      {/* Tool Display Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Tool Display</h4>

        <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <Maximize2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            Auto-expand tools
          </span>
          <input
            type="checkbox"
            checked={autoExpandTools}
            onChange={(e) => onAutoExpandChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <Eye className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            Show raw parameters
          </span>
          <input
            type="checkbox"
            checked={showRawParameters}
            onChange={(e) => onShowRawParametersChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <Brain className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            Show thinking
          </span>
          <input
            type="checkbox"
            checked={showThinking}
            onChange={(e) => onShowThinkingChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
          />
        </label>
      </div>
      {/* View Options */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">View Options</h4>

        <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            Auto-scroll to bottom
          </span>
          <input
            type="checkbox"
            checked={autoScrollToBottom}
            onChange={(e) => onAutoScrollChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
          />
        </label>
      </div>

      {/* Input Settings */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Input Settings</h4>

        <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
          <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            Send by Ctrl+Enter
          </span>
          <input
            type="checkbox"
            checked={sendByCtrlEnter}
            onChange={(e) => onSendByCtrlEnterChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
          />
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 ml-3">
          When enabled, pressing Ctrl+Enter will send the message instead of just Enter. This is useful for IME users to avoid accidental sends.
        </p>
      </div>

      {/* Whisper Dictation Settings - HIDDEN */}
      <div className="space-y-2" style={{ display: 'none' }}>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Whisper Dictation</h4>

        <div className="space-y-2">
          <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
            <input
              type="radio"
              name="whisperMode"
              value="default"
              checked={whisperMode === 'default'}
              onChange={() => {
                setWhisperMode('default');
                localStorage.setItem('whisperMode', 'default');
                window.dispatchEvent(new Event('whisperModeChanged'));
              }}
              className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
            />
            <div className="ml-3 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <Mic className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                Default Mode
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Direct transcription of your speech
              </p>
            </div>
          </label>

          <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
            <input
              type="radio"
              name="whisperMode"
              value="prompt"
              checked={whisperMode === 'prompt'}
              onChange={() => {
                setWhisperMode('prompt');
                localStorage.setItem('whisperMode', 'prompt');
                window.dispatchEvent(new Event('whisperModeChanged'));
              }}
              className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
            />
            <div className="ml-3 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <Sparkles className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                Prompt Enhancement
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Transform rough ideas into clear, detailed AI prompts
              </p>
            </div>
          </label>

          <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
            <input
              type="radio"
              name="whisperMode"
              value="vibe"
              checked={whisperMode === 'vibe' || whisperMode === 'instructions' || whisperMode === 'architect'}
              onChange={() => {
                setWhisperMode('vibe');
                localStorage.setItem('whisperMode', 'vibe');
                window.dispatchEvent(new Event('whisperModeChanged'));
              }}
              className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
            />
            <div className="ml-3 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                Vibe Mode
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Format ideas as clear agent instructions with details
              </p>
            </div>
          </label>
        </div>
      </div>
    </>
  );

  // Mobile layout: bottom sheet pattern
  if (isMobile) {
    return (
      <>
        {/* Mobile toggle button - fixed at bottom-right, above MobileNav (z-[60] to beat MobileNav z-50) */}
        <button
          onClick={handleToggle}
          className="fixed right-3 z-[60] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-11 h-11 flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors touch-manipulation"
          style={{ bottom: 'calc(var(--mobile-nav-total) + 12px)' }}
          aria-label={localIsOpen ? "Close settings panel" : "Open settings panel"}
        >
          <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </button>

        {/* Mobile bottom sheet */}
        <div
          className={`fixed left-0 right-0 bg-background border-t border-border rounded-t-2xl shadow-2xl transform transition-transform duration-300 ease-out z-[55] ${
            localIsOpen ? 'translate-y-0 pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{
            bottom: 'var(--mobile-nav-total)',
            maxHeight: '50vh',
            ...(!localIsOpen && { transform: 'translateY(calc(100% + var(--mobile-nav-total)))' }),
          }}
        >
          {/* Bottom sheet drag indicator */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-12 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
          </div>

          {/* Header with close button */}
          <div className="px-4 pb-3 pt-1 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              Quick Settings
            </h3>
            <button
              onClick={handleToggle}
              className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors touch-manipulation"
              aria-label="Close settings"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          {/* Scrollable settings content */}
          <div className="overflow-y-auto p-4 space-y-6 bg-background" style={{ maxHeight: 'calc(50vh - 80px)' }}>
            {settingsContent}
          </div>
        </div>

        {/* Backdrop */}
        {localIsOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-[52] transition-opacity duration-150 ease-out"
            onClick={handleToggle}
          />
        )}
      </>
    );
  }

  // Desktop layout: right-side panel with draggable handle
  return (
    <>
      {/* Pull Tab - Combined drag handle and toggle button */}
      <button
        ref={handleRef}
        onClick={handleToggle}
        onMouseDown={(e) => {
          // Start drag on mousedown
          handleDragStart(e);
        }}
        onTouchStart={(e) => {
          // Start drag on touchstart
          handleDragStart(e);
        }}
        className={`fixed ${
          localIsOpen ? 'right-64' : 'right-0'
        } z-50 ${isDragging ? '' : 'transition-all duration-150 ease-out'} bg-white dark:bg-gray-800 border ${
          isDragging ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'
        } rounded-l-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-lg ${
          isDragging ? 'cursor-grabbing' : 'cursor-pointer'
        } touch-none`}
        style={{ ...getPositionStyle(), touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        aria-label={isDragging ? "Dragging handle" : localIsOpen ? "Close settings panel" : "Open settings panel"}
        title={isDragging ? "Dragging..." : "Click to toggle, drag to move"}
      >
        {isDragging ? (
          <GripVertical className="h-5 w-5 text-blue-500 dark:text-blue-400" />
        ) : localIsOpen ? (
          <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        ) : (
          <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        )}
      </button>

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-background border-l border-border shadow-xl transform transition-transform duration-150 ease-out z-40 ${
          localIsOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              Quick Settings
            </h3>
          </div>

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6 bg-background">
            {settingsContent}
          </div>
        </div>
      </div>

      {/* Backdrop */}
      {localIsOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity duration-150 ease-out"
          onClick={handleToggle}
        />
      )}
    </>
  );
};

export default QuickSettingsPanel;
