/**
 * useChatInput.js - Input state management extracted from ChatInterface.jsx
 *
 * Manages:
 * - Input text state with draft persistence to localStorage
 * - File @-mention autocomplete (dropdown, filtering, selection)
 * - Slash command menu (fetching, fuzzy search, selection, history)
 * - Image attachment state and handlers
 * - Textarea expansion tracking
 * - Debounced input
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Fuse from 'fuse.js';
import { api, authenticatedFetch } from '../utils/api';
import { safeLocalStorage, escapeRegExp } from '../utils/chatUtils';

/**
 * @param {Object} params
 * @param {Object|null} params.selectedProject - Currently selected project
 * @param {string} params.provider - Current provider ('claude' | 'cursor' | 'codex')
 */
export default function useChatInput({ selectedProject, provider }) {
  // ── Input text ───────────────────────────────────────────────────────
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [debouncedInput, setDebouncedInput] = useState('');
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────
  const textareaRef = useRef(null);
  const inputHighlightRef = useRef(null);
  const inputContainerRef = useRef(null);
  const commandQueryTimerRef = useRef(null);

  // ── File @-mention state ──────────────────────────────────────────────
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [fileMentions, setFileMentions] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);

  // ── Slash command state ───────────────────────────────────────────────
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [slashCommands, setSlashCommands] = useState([]);
  const [filteredCommands, setFilteredCommands] = useState([]);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  // ── Image attachment state ────────────────────────────────────────────
  const [attachedImages, setAttachedImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(new Map());
  const [imageErrors, setImageErrors] = useState(new Map());

  // ── Persist input draft to localStorage ───────────────────────────────
  useEffect(() => {
    if (selectedProject && input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Load saved draft when project changes
  useEffect(() => {
    if (selectedProject) {
      const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // ── Debounced input ───────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150);
    return () => clearTimeout(timer);
  }, [input]);

  // ── File list fetching ────────────────────────────────────────────────
  useEffect(() => {
    if (selectedProject) {
      fetchProjectFiles();
    }
  }, [selectedProject]);

  const fetchProjectFiles = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        const flatFiles = flattenFileTree(files);
        setFileList(flatFiles);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const flattenFileTree = (files, basePath = '') => {
    let result = [];
    for (const file of files) {
      const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
      if (file.type === 'directory' && file.children) {
        result = result.concat(flattenFileTree(file.children, fullPath));
      } else if (file.type === 'file') {
        result.push({
          name: file.name,
          path: fullPath,
          relativePath: file.path
        });
      }
    }
    return result;
  };

  // ── @ symbol detection and file filtering ─────────────────────────────
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);

        const filtered = fileList.filter(file =>
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10);

        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
        setAtSymbolPosition(-1);
      }
    } else {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
    }
  }, [input, cursorPosition, fileList]);

  // ── File mention highlighting helpers ─────────────────────────────────
  const activeFileMentions = useMemo(() => {
    if (!input || fileMentions.length === 0) return [];
    return fileMentions.filter(path => input.includes(path));
  }, [fileMentions, input]);

  const sortedFileMentions = useMemo(() => {
    if (activeFileMentions.length === 0) return [];
    const unique = Array.from(new Set(activeFileMentions));
    return unique.sort((a, b) => b.length - a.length);
  }, [activeFileMentions]);

  const fileMentionRegex = useMemo(() => {
    if (sortedFileMentions.length === 0) return null;
    const pattern = sortedFileMentions.map(escapeRegExp).join('|');
    return new RegExp(`(${pattern})`, 'g');
  }, [sortedFileMentions]);

  const fileMentionSet = useMemo(() => new Set(sortedFileMentions), [sortedFileMentions]);

  // ── Slash command fetching ────────────────────────────────────────────
  useEffect(() => {
    const fetchCommands = async () => {
      if (!selectedProject) return;

      try {
        const response = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath: selectedProject.path
          })
        });

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();

        const allCommands = [
          ...(data.builtIn || []).map(cmd => ({ ...cmd, type: 'built-in' })),
          ...(data.custom || []).map(cmd => ({ ...cmd, type: 'custom' }))
        ];

        setSlashCommands(allCommands);

        const historyKey = `command_history_${selectedProject.name}`;
        const history = safeLocalStorage.getItem(historyKey);
        if (history) {
          try {
            const parsedHistory = JSON.parse(history);
            const sortedCommands = allCommands.sort((a, b) => {
              const aCount = parsedHistory[a.name] || 0;
              const bCount = parsedHistory[b.name] || 0;
              return bCount - aCount;
            });
            setSlashCommands(sortedCommands);
          } catch (e) {
            console.error('Error parsing command history:', e);
          }
        }
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
      }
    };

    fetchCommands();
  }, [selectedProject]);

  // ── Fuzzy search for commands ─────────────────────────────────────────
  const fuse = useMemo(() => {
    if (!slashCommands.length) return null;

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 }
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1
    });
  }, [slashCommands]);

  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashCommands);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map(result => result.item));
  }, [commandQuery, slashCommands, fuse]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) return [];

    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);

    if (!history) return [];

    try {
      const parsedHistory = JSON.parse(history);

      const commandsWithUsage = slashCommands
        .map(cmd => ({
          ...cmd,
          usageCount: parsedHistory[cmd.name] || 0
        }))
        .filter(cmd => cmd.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 5);

      return commandsWithUsage;
    } catch (e) {
      console.error('Error parsing command history:', e);
      return [];
    }
  }, [selectedProject, slashCommands]);

  // ── Image handling ────────────────────────────────────────────────────
  const handleImageFiles = useCallback((files) => {
    const validFiles = files.filter(file => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          const fileName = file.name || 'Unknown file';
          setImageErrors(prev => {
            const newMap = new Map(prev);
            newMap.set(fileName, 'File too large (max 5MB)');
            return newMap;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages(prev => [...prev, ...validFiles].slice(0, 5));
    }
  }, []);

  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData.items);

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      }
    }

    // Fallback for some browsers/platforms
    if (items.length === 0 && e.clipboardData.files.length > 0) {
      const files = Array.from(e.clipboardData.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        handleImageFiles(imageFiles);
      }
    }
  }, [handleImageFiles]);

  // ── File selection ────────────────────────────────────────────────────
  const selectFile = useCallback((file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';

    const newInput = textBeforeAt + file.path + ' ' + textAfterQuery;
    const newCursorPos = textBeforeAt.length + file.path.length + 1;

    // Immediately ensure focus is maintained
    if (textareaRef.current && !textareaRef.current.matches(':focus')) {
      textareaRef.current.focus();
    }

    setInput(newInput);
    setCursorPosition(newCursorPos);
    setFileMentions(prev => (prev.includes(file.path) ? prev : [...prev, file.path]));

    setShowFileDropdown(false);
    setAtSymbolPosition(-1);

    if (textareaRef.current) {
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          if (!textareaRef.current.matches(':focus')) {
            textareaRef.current.focus();
          }
        }
      });
    }
  }, [input, atSymbolPosition]);

  // ── Input change handler ──────────────────────────────────────────────
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setInput(newValue);
    setCursorPosition(cursorPos);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    // Detect slash command at cursor position
    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Check if we're in a code block
    const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
    const inCodeBlock = backticksBefore % 2 === 1;

    if (inCodeBlock) {
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    // Find the last slash before cursor that could start a command
    const slashPattern = /(^|\s)\/(\S*)$/;
    const match = textBeforeCursor.match(slashPattern);

    if (match) {
      const slashPos = match.index + match[1].length;
      const query = match[2];

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }

      commandQueryTimerRef.current = setTimeout(() => {
        setCommandQuery(query);
      }, 150);
    } else {
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');

      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }
    }
  }, []);

  // ── Highlight rendering ───────────────────────────────────────────────
  const renderInputWithMentions = useCallback((text) => {
    if (!text) return '';
    if (!fileMentionRegex) return text;
    const parts = text.split(fileMentionRegex);
    return parts.map((part, index) => (
      fileMentionSet.has(part) ? (
        React.createElement('span', {
          key: `mention-${index}`,
          className: 'bg-blue-200/70 -ml-0.5 dark:bg-blue-300/40 px-0.5 rounded-md box-decoration-clone text-transparent',
        }, part)
      ) : (
        React.createElement('span', { key: `text-${index}` }, part)
      )
    ));
  }, [fileMentionRegex, fileMentionSet]);

  const syncInputOverlayScroll = useCallback((target) => {
    if (!inputHighlightRef.current || !target) return;
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleTextareaClick = useCallback((e) => {
    setCursorPosition(e.target.selectionStart);
  }, []);

  // ── Textarea setup ────────────────────────────────────────────────────
  // Initial textarea setup - set to 2 rows height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []);

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input]);

  // ── Transcript handler (for voice input) ──────────────────────────────
  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;

        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, []);

  // ── Command selection with history tracking ───────────────────────────
  const handleCommandSelect = useCallback((command, index, isHover) => {
    if (!command || !selectedProject) return;

    if (isHover) {
      setSelectedCommandIndex(index);
      return;
    }

    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);
    let parsedHistory = {};

    try {
      parsedHistory = history ? JSON.parse(history) : {};
    } catch (e) {
      console.error('Error parsing command history:', e);
    }

    parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
    safeLocalStorage.setItem(historyKey, JSON.stringify(parsedHistory));

    // The actual command execution is handled by the caller via the returned command
    return command;
  }, [selectedProject]);

  return {
    // Input state
    input,
    setInput,
    debouncedInput,
    isTextareaExpanded,
    setIsTextareaExpanded,
    cursorPosition,
    setCursorPosition,

    // Refs
    textareaRef,
    inputHighlightRef,
    inputContainerRef,
    commandQueryTimerRef,

    // File mention state
    showFileDropdown,
    setShowFileDropdown,
    fileList,
    filteredFiles,
    selectedFileIndex,
    setSelectedFileIndex,
    atSymbolPosition,
    fileMentions,

    // Slash command state
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

    // Image state
    attachedImages,
    setAttachedImages,
    uploadingImages,
    setUploadingImages,
    imageErrors,
    setImageErrors,

    // Handlers
    handleInputChange,
    handlePaste,
    handleImageFiles,
    selectFile,
    renderInputWithMentions,
    syncInputOverlayScroll,
    handleTextareaClick,
    handleTranscript,
    handleCommandSelect,
  };
}
