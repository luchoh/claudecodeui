/**
 * chatUtils.js - Pure utility functions extracted from ChatInterface.jsx
 *
 * Contains helpers for HTML entity decoding, markdown normalisation,
 * math-aware unescaping, localStorage quota handling, Claude settings
 * management, and tool permission helpers.
 */

import { safeJsonParse } from '../lib/utils.js';

// ── HTML / Markdown helpers ────────────────────────────────────────────

/** Decode common HTML entities in text */
export function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Normalise markdown text where providers mistakenly wrap short inline code
 * with single-line triple fences.
 * Only converts fences that do NOT contain any newline to avoid touching
 * real code blocks.
 */
export function normalizeInlineCodeFences(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    // ```code``` -> `code`
    return text.replace(/```\s*([^\n\r]+?)\s*```/g, '`$1`');
  } catch {
    return text;
  }
}

/**
 * Unescape \n, \t, \r while protecting LaTeX formulas ($...$ and $$...$$)
 * from being corrupted.
 */
export function unescapeWithMathProtection(text) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks = [];
  const PLACEHOLDER_PREFIX = '__MATH_BLOCK_';
  const PLACEHOLDER_SUFFIX = '__';

  // Extract and protect math formulas
  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
  });

  // Process escape sequences on non-math content
  processedText = processedText.replace(/\\n/g, '\n')
                               .replace(/\\t/g, '\t')
                               .replace(/\\r/g, '\r');

  // Restore math formulas
  processedText = processedText.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index)];
    }
  );

  return processedText;
}

/** Escape a string for safe use inside a RegExp */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Usage limit formatting ────────────────────────────────────────────

/** Format "Claude AI usage limit reached|<epoch>" into a local time string */
export function formatUsageLimitText(text) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000; // seconds -> ms
      const reset = new Date(timestampMs);

      // Time HH:mm in local time
      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(reset);

      // Human-readable timezone: GMT+HH[:MM] (City)
      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      // Readable date like "8 Jun 2025"
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}

// ── Safe localStorage wrapper ─────────────────────────────────────────

/** Safe localStorage utility to handle quota exceeded errors */
export const safeLocalStorage = {
  setItem: (key, value) => {
    try {
      // For chat messages, implement compression and size limits
      if (key.startsWith('chat_messages_') && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          // Limit to last 50 messages to prevent storage bloat
          if (Array.isArray(parsed) && parsed.length > 50) {
            console.warn(`Truncating chat history for ${key} from ${parsed.length} to 50 messages`);
            const truncated = parsed.slice(-50);
            value = JSON.stringify(truncated);
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }

      localStorage.setItem(key, value);
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');
        // Clear old chat messages to free up space
        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter(k => k.startsWith('chat_messages_')).sort();

        // Remove oldest chat data first, keeping only the 3 most recent projects
        if (chatKeys.length > 3) {
          chatKeys.slice(0, chatKeys.length - 3).forEach(k => {
            localStorage.removeItem(k);
            console.log(`Removed old chat data: ${k}`);
          });
        }

        // If still failing, clear draft inputs too
        const draftKeys = keys.filter(k => k.startsWith('draft_input_'));
        draftKeys.forEach(k => {
          localStorage.removeItem(k);
        });

        // Try again with reduced data
        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
          // Last resort: Try to save just the last 10 messages
          if (key.startsWith('chat_messages_') && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed) && parsed.length > 10) {
                const minimal = parsed.slice(-10);
                localStorage.setItem(key, JSON.stringify(minimal));
                console.warn('Saved only last 10 messages due to quota constraints');
              }
            } catch (finalError) {
              console.error('Final save attempt failed:', finalError);
            }
          }
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  }
};

// ── Claude settings / permissions ─────────────────────────────────────

export const CLAUDE_SETTINGS_KEY = 'claude-settings';

export function getClaudeSettings() {
  const raw = safeLocalStorage.getItem(CLAUDE_SETTINGS_KEY);
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name'
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: Boolean(parsed.skipPermissions),
      projectSortOrder: parsed.projectSortOrder || 'name'
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name'
    };
  }
}

export function buildClaudeToolPermissionEntry(toolName, toolInput) {
  if (!toolName) return null;
  if (toolName !== 'Bash') return toolName;

  const parsed = safeJsonParse(toolInput);
  const command = typeof parsed?.command === 'string' ? parsed.command.trim() : '';
  if (!command) return toolName;

  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return toolName;

  // For Bash, allow the command family instead of every Bash invocation.
  if (tokens[0] === 'git' && tokens[1]) {
    return `Bash(${tokens[0]} ${tokens[1]}:*)`;
  }
  return `Bash(${tokens[0]}:*)`;
}

/**
 * Normalise tool inputs for display in the permission banner.
 * This does not sanitise/redact secrets; it is strictly formatting so users
 * can see the raw input that triggered the permission prompt.
 */
export function formatToolInputForDisplay(input) {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function getClaudePermissionSuggestion(message, provider) {
  if (provider !== 'claude') return null;
  if (!message?.toolResult?.isError) return null;

  const toolName = message?.toolName;
  const entry = buildClaudeToolPermissionEntry(toolName, message.toolInput);

  if (!entry) return null;

  const settings = getClaudeSettings();
  const isAllowed = settings.allowedTools.includes(entry);
  return { toolName, entry, isAllowed };
}

export function grantClaudeToolPermission(entry) {
  if (!entry) return { success: false };

  const settings = getClaudeSettings();
  const alreadyAllowed = settings.allowedTools.includes(entry);
  const nextAllowed = alreadyAllowed ? settings.allowedTools : [...settings.allowedTools, entry];
  const nextDisallowed = settings.disallowedTools.filter(tool => tool !== entry);
  const updatedSettings = {
    ...settings,
    allowedTools: nextAllowed,
    disallowedTools: nextDisallowed,
    lastUpdated: new Date().toISOString()
  };

  safeLocalStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify(updatedSettings));
  return { success: true, alreadyAllowed, updatedSettings };
}
