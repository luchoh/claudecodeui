// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decodeHtmlEntities,
  normalizeInlineCodeFences,
  unescapeWithMathProtection,
  escapeRegExp,
  formatUsageLimitText,
  safeLocalStorage,
  CLAUDE_SETTINGS_KEY,
  getClaudeSettings,
  buildClaudeToolPermissionEntry,
  formatToolInputForDisplay,
  getClaudePermissionSuggestion,
  grantClaudeToolPermission,
} from '../../src/utils/chatUtils.js';

// ---------------------------------------------------------------------------
// decodeHtmlEntities
// ---------------------------------------------------------------------------
describe('decodeHtmlEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
  });

  it('decodes &lt; and &gt; to < and >', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &quot; to "', () => {
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  it('decodes &#39; to single quote', () => {
    expect(decodeHtmlEntities('it&#39;s')).toBe("it's");
  });

  it('decodes multiple mixed entities in one string', () => {
    expect(decodeHtmlEntities('&lt;a href=&quot;/&amp;x&quot;&gt;'))
      .toBe('<a href="/&x">');
  });

  it('returns the same string when there are no entities', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world');
  });

  it('returns falsy values as-is', () => {
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities(null)).toBe(null);
    expect(decodeHtmlEntities(undefined)).toBe(undefined);
  });

  it('handles &amp; appearing before other entities (order matters)', () => {
    // &amp;lt; should become &lt; (not <) because &amp; is decoded last
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });
});

// ---------------------------------------------------------------------------
// normalizeInlineCodeFences
// ---------------------------------------------------------------------------
describe('normalizeInlineCodeFences', () => {
  it('converts single-line triple fences to single backticks', () => {
    expect(normalizeInlineCodeFences('```code```')).toBe('`code`');
  });

  it('trims whitespace inside the fences', () => {
    expect(normalizeInlineCodeFences('```  some code  ```')).toBe('`some code`');
  });

  it('does NOT convert multi-line fences (real code blocks)', () => {
    const block = '```\nline1\nline2\n```';
    expect(normalizeInlineCodeFences(block)).toBe(block);
  });

  it('handles multiple inline fences in the same string', () => {
    expect(normalizeInlineCodeFences('Use ```foo``` and ```bar```'))
      .toBe('Use `foo` and `bar`');
  });

  it('returns non-string values as-is', () => {
    expect(normalizeInlineCodeFences(null)).toBe(null);
    expect(normalizeInlineCodeFences(undefined)).toBe(undefined);
    expect(normalizeInlineCodeFences(42)).toBe(42);
  });

  it('returns empty string as-is', () => {
    expect(normalizeInlineCodeFences('')).toBe('');
  });

  it('leaves already-correct single-backtick inline code alone', () => {
    expect(normalizeInlineCodeFences('`code`')).toBe('`code`');
  });
});

// ---------------------------------------------------------------------------
// unescapeWithMathProtection
// ---------------------------------------------------------------------------
describe('unescapeWithMathProtection', () => {
  it('unescapes \\n to newline', () => {
    expect(unescapeWithMathProtection('hello\\nworld')).toBe('hello\nworld');
  });

  it('unescapes \\t to tab', () => {
    expect(unescapeWithMathProtection('col1\\tcol2')).toBe('col1\tcol2');
  });

  it('unescapes \\r to carriage return', () => {
    expect(unescapeWithMathProtection('line\\r')).toBe('line\r');
  });

  it('handles multiple escape sequences', () => {
    expect(unescapeWithMathProtection('a\\nb\\tc\\r'))
      .toBe('a\nb\tc\r');
  });

  it('protects inline math ($...$) from unescaping', () => {
    const input = 'See $x\\neq y$ here';
    const result = unescapeWithMathProtection(input);
    expect(result).toContain('$x\\neq y$');
  });

  it('protects display math ($$...$$) from unescaping', () => {
    const input = 'Formula: $$a\\nb$$';
    const result = unescapeWithMathProtection(input);
    expect(result).toContain('$$a\\nb$$');
  });

  it('unescapes text outside math but preserves math blocks', () => {
    const input = 'before\\nmath $x\\ny$ after\\nend';
    const result = unescapeWithMathProtection(input);
    expect(result).toBe('before\nmath $x\\ny$ after\nend');
  });

  it('handles multiple math blocks', () => {
    const input = '$a\\nb$ text\\n $c\\nd$';
    const result = unescapeWithMathProtection(input);
    expect(result).toBe('$a\\nb$ text\n $c\\nd$');
  });

  it('returns falsy values as-is', () => {
    expect(unescapeWithMathProtection('')).toBe('');
    expect(unescapeWithMathProtection(null)).toBe(null);
    expect(unescapeWithMathProtection(undefined)).toBe(undefined);
  });

  it('returns non-string values as-is', () => {
    expect(unescapeWithMathProtection(123)).toBe(123);
  });

  it('handles text with no escape sequences', () => {
    expect(unescapeWithMathProtection('plain text')).toBe('plain text');
  });
});

// ---------------------------------------------------------------------------
// escapeRegExp
// ---------------------------------------------------------------------------
describe('escapeRegExp', () => {
  it('escapes dots', () => {
    expect(escapeRegExp('file.txt')).toBe('file\\.txt');
  });

  it('escapes asterisks and plus', () => {
    expect(escapeRegExp('a*b+c')).toBe('a\\*b\\+c');
  });

  it('escapes question marks and carets', () => {
    expect(escapeRegExp('a?b^c')).toBe('a\\?b\\^c');
  });

  it('escapes dollar signs', () => {
    expect(escapeRegExp('$100')).toBe('\\$100');
  });

  it('escapes curly braces', () => {
    expect(escapeRegExp('{a}')).toBe('\\{a\\}');
  });

  it('escapes parentheses', () => {
    expect(escapeRegExp('(group)')).toBe('\\(group\\)');
  });

  it('escapes square brackets', () => {
    expect(escapeRegExp('[set]')).toBe('\\[set\\]');
  });

  it('escapes pipes', () => {
    expect(escapeRegExp('a|b')).toBe('a\\|b');
  });

  it('escapes backslashes', () => {
    expect(escapeRegExp('path\\to')).toBe('path\\\\to');
  });

  it('produces a pattern that can be used safely in RegExp', () => {
    const dangerous = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(dangerous);
    const re = new RegExp(escaped);
    expect(re.test(dangerous)).toBe(true);
  });

  it('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });

  it('handles strings with no special characters', () => {
    expect(escapeRegExp('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// formatUsageLimitText
// ---------------------------------------------------------------------------
describe('formatUsageLimitText', () => {
  it('formats a usage limit message with epoch-seconds timestamp', () => {
    const ts = Math.floor(Date.now() / 1000);
    const input = `Claude AI usage limit reached|${ts}`;
    const result = formatUsageLimitText(input);
    expect(result).toContain('Claude usage limit reached');
    expect(result).toContain('GMT');
    expect(result).not.toContain('|');
  });

  it('formats a usage limit message with epoch-milliseconds timestamp', () => {
    const ts = Date.now();
    const input = `Claude AI usage limit reached|${ts}`;
    const result = formatUsageLimitText(input);
    expect(result).toContain('Claude usage limit reached');
    expect(result).toContain('**');
  });

  it('returns non-matching text unchanged', () => {
    const input = 'Just a regular message';
    expect(formatUsageLimitText(input)).toBe(input);
  });

  it('returns non-string values as-is', () => {
    expect(formatUsageLimitText(42)).toBe(42);
    expect(formatUsageLimitText(null)).toBe(null);
    expect(formatUsageLimitText(undefined)).toBe(undefined);
  });

  it('includes a human-readable date in the output', () => {
    // Use a known timestamp: 2025-06-08 12:00:00 UTC
    const ts = 1749384000;
    const input = `Claude AI usage limit reached|${ts}`;
    const result = formatUsageLimitText(input);
    expect(result).toMatch(/\d{1,2}\s\w{3}\s\d{4}/); // e.g. "8 Jun 2025"
  });

  it('handles multiple occurrences in the same string', () => {
    const ts1 = Math.floor(Date.now() / 1000);
    const ts2 = ts1 + 3600;
    const input = `Claude AI usage limit reached|${ts1} and Claude AI usage limit reached|${ts2}`;
    const result = formatUsageLimitText(input);
    // Both should be replaced
    const matches = result.match(/Claude usage limit reached/g);
    expect(matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// safeLocalStorage
// ---------------------------------------------------------------------------
describe('safeLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getItem', () => {
    it('returns the stored value', () => {
      localStorage.setItem('test-key', 'test-value');
      expect(safeLocalStorage.getItem('test-key')).toBe('test-value');
    });

    it('returns null for a missing key', () => {
      expect(safeLocalStorage.getItem('nonexistent')).toBe(null);
    });

    it('returns null if localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(safeLocalStorage.getItem('key')).toBe(null);
      spy.mockRestore();
    });
  });

  describe('setItem', () => {
    it('stores a value in localStorage', () => {
      safeLocalStorage.setItem('key', 'value');
      expect(localStorage.getItem('key')).toBe('value');
    });

    it('truncates chat_messages_ arrays longer than 50 items', () => {
      const longArray = Array.from({ length: 80 }, (_, i) => ({ id: i }));
      safeLocalStorage.setItem('chat_messages_proj1', JSON.stringify(longArray));
      const stored = JSON.parse(localStorage.getItem('chat_messages_proj1'));
      expect(stored).toHaveLength(50);
      // Should keep the LAST 50 items
      expect(stored[0].id).toBe(30);
      expect(stored[49].id).toBe(79);
    });

    it('does not truncate chat_messages_ arrays with 50 or fewer items', () => {
      const shortArray = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      safeLocalStorage.setItem('chat_messages_proj1', JSON.stringify(shortArray));
      const stored = JSON.parse(localStorage.getItem('chat_messages_proj1'));
      expect(stored).toHaveLength(50);
    });

    it('handles QuotaExceededError by clearing old chat data and retrying', () => {
      // Pre-populate with "old" chat data
      localStorage.setItem('chat_messages_a', 'data_a');
      localStorage.setItem('chat_messages_b', 'data_b');
      localStorage.setItem('chat_messages_c', 'data_c');
      localStorage.setItem('chat_messages_d', 'data_d');
      localStorage.setItem('chat_messages_e', 'data_e');

      let callCount = 0;
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
        callCount++;
        if (callCount === 1) {
          const err = new DOMException('quota exceeded', 'QuotaExceededError');
          throw err;
        }
        // Let subsequent calls use real implementation
        spy.mockRestore();
        localStorage.setItem(key, value);
      });

      safeLocalStorage.setItem('new-key', 'new-value');
      // The function should have attempted cleanup; we verify it didn't throw
      spy.mockRestore();
    });
  });

  describe('removeItem', () => {
    it('removes a key from localStorage', () => {
      localStorage.setItem('key', 'value');
      safeLocalStorage.removeItem('key');
      expect(localStorage.getItem('key')).toBe(null);
    });

    it('does not throw when localStorage.removeItem throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => safeLocalStorage.removeItem('key')).not.toThrow();
      spy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// getClaudeSettings
// ---------------------------------------------------------------------------
describe('getClaudeSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when nothing is stored', () => {
    const settings = getClaudeSettings();
    expect(settings).toEqual({
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    });
  });

  it('returns stored settings when valid JSON exists', () => {
    const stored = {
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash(rm:*)'],
      skipPermissions: true,
      projectSortOrder: 'recent',
    };
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify(stored));
    const settings = getClaudeSettings();
    expect(settings.allowedTools).toEqual(['Read', 'Write']);
    expect(settings.disallowedTools).toEqual(['Bash(rm:*)']);
    expect(settings.skipPermissions).toBe(true);
    expect(settings.projectSortOrder).toBe('recent');
  });

  it('returns defaults when stored value is invalid JSON', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, 'not-json{');
    const settings = getClaudeSettings();
    expect(settings).toEqual({
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    });
  });

  it('normalises missing or non-array allowedTools to empty array', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      allowedTools: 'not-an-array',
      disallowedTools: null,
    }));
    const settings = getClaudeSettings();
    expect(settings.allowedTools).toEqual([]);
    expect(settings.disallowedTools).toEqual([]);
  });

  it('defaults projectSortOrder to "name" when missing', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({}));
    const settings = getClaudeSettings();
    expect(settings.projectSortOrder).toBe('name');
  });

  it('coerces skipPermissions to boolean', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      skipPermissions: 1,
    }));
    const settings = getClaudeSettings();
    expect(settings.skipPermissions).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildClaudeToolPermissionEntry
// ---------------------------------------------------------------------------
describe('buildClaudeToolPermissionEntry', () => {
  it('returns null for falsy toolName', () => {
    expect(buildClaudeToolPermissionEntry(null)).toBe(null);
    expect(buildClaudeToolPermissionEntry('')).toBe(null);
    expect(buildClaudeToolPermissionEntry(undefined)).toBe(null);
  });

  it('returns the toolName as-is for non-Bash tools', () => {
    expect(buildClaudeToolPermissionEntry('Read', '{}')).toBe('Read');
    expect(buildClaudeToolPermissionEntry('Write', '{}')).toBe('Write');
    expect(buildClaudeToolPermissionEntry('Edit', '{}')).toBe('Edit');
  });

  it('returns Bash(command:*) for Bash with simple commands', () => {
    const input = JSON.stringify({ command: 'npm install' });
    expect(buildClaudeToolPermissionEntry('Bash', input)).toBe('Bash(npm:*)');
  });

  it('returns Bash(git subcommand:*) for git commands', () => {
    const input = JSON.stringify({ command: 'git status' });
    expect(buildClaudeToolPermissionEntry('Bash', input)).toBe('Bash(git status:*)');
  });

  it('returns Bash(git subcommand:*) for git with additional args', () => {
    const input = JSON.stringify({ command: 'git commit -m "message"' });
    expect(buildClaudeToolPermissionEntry('Bash', input)).toBe('Bash(git commit:*)');
  });

  it('returns "Bash" when Bash tool input has no parseable command', () => {
    expect(buildClaudeToolPermissionEntry('Bash', undefined)).toBe('Bash');
    expect(buildClaudeToolPermissionEntry('Bash', '')).toBe('Bash');
    expect(buildClaudeToolPermissionEntry('Bash', 'not-json')).toBe('Bash');
  });

  it('returns "Bash" when command is empty string', () => {
    const input = JSON.stringify({ command: '' });
    expect(buildClaudeToolPermissionEntry('Bash', input)).toBe('Bash');
  });

  it('returns "Bash" when command is whitespace only', () => {
    const input = JSON.stringify({ command: '   ' });
    expect(buildClaudeToolPermissionEntry('Bash', input)).toBe('Bash');
  });
});

// ---------------------------------------------------------------------------
// formatToolInputForDisplay
// ---------------------------------------------------------------------------
describe('formatToolInputForDisplay', () => {
  it('returns empty string for null', () => {
    expect(formatToolInputForDisplay(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatToolInputForDisplay(undefined)).toBe('');
  });

  it('returns strings as-is', () => {
    expect(formatToolInputForDisplay('hello')).toBe('hello');
  });

  it('returns empty string for empty string input', () => {
    expect(formatToolInputForDisplay('')).toBe('');
  });

  it('pretty-prints objects', () => {
    const obj = { command: 'ls -la', timeout: 5000 };
    const result = formatToolInputForDisplay(obj);
    expect(result).toBe(JSON.stringify(obj, null, 2));
  });

  it('pretty-prints arrays', () => {
    const arr = [1, 2, 3];
    const result = formatToolInputForDisplay(arr);
    expect(result).toBe(JSON.stringify(arr, null, 2));
  });

  it('converts numbers to string via JSON.stringify', () => {
    const result = formatToolInputForDisplay(42);
    expect(result).toBe('42');
  });

  it('converts booleans to string via JSON.stringify', () => {
    expect(formatToolInputForDisplay(true)).toBe('true');
  });

  it('handles objects with circular references gracefully', () => {
    const obj = {};
    obj.self = obj;
    // JSON.stringify will throw, so it falls back to String()
    const result = formatToolInputForDisplay(obj);
    expect(result).toBe('[object Object]');
  });
});

// ---------------------------------------------------------------------------
// getClaudePermissionSuggestion
// ---------------------------------------------------------------------------
describe('getClaudePermissionSuggestion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when provider is not "claude"', () => {
    const message = { toolResult: { isError: true }, toolName: 'Read' };
    expect(getClaudePermissionSuggestion(message, 'codex')).toBe(null);
    expect(getClaudePermissionSuggestion(message, 'openai')).toBe(null);
  });

  it('returns null when toolResult is not an error', () => {
    const message = { toolResult: { isError: false }, toolName: 'Read' };
    expect(getClaudePermissionSuggestion(message, 'claude')).toBe(null);
  });

  it('returns null when toolResult is missing', () => {
    const message = { toolName: 'Read' };
    expect(getClaudePermissionSuggestion(message, 'claude')).toBe(null);
  });

  it('returns null when message is null', () => {
    expect(getClaudePermissionSuggestion(null, 'claude')).toBe(null);
  });

  it('returns a suggestion for a non-Bash tool with an error', () => {
    const message = {
      toolResult: { isError: true },
      toolName: 'Read',
      toolInput: '{}',
    };
    const result = getClaudePermissionSuggestion(message, 'claude');
    expect(result).toEqual({
      toolName: 'Read',
      entry: 'Read',
      isAllowed: false,
    });
  });

  it('returns isAllowed: true if the tool is already in allowedTools', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      allowedTools: ['Read'],
      disallowedTools: [],
    }));
    const message = {
      toolResult: { isError: true },
      toolName: 'Read',
      toolInput: '{}',
    };
    const result = getClaudePermissionSuggestion(message, 'claude');
    expect(result.isAllowed).toBe(true);
  });

  it('builds a Bash permission entry for Bash tools', () => {
    const message = {
      toolResult: { isError: true },
      toolName: 'Bash',
      toolInput: JSON.stringify({ command: 'npm test' }),
    };
    const result = getClaudePermissionSuggestion(message, 'claude');
    expect(result.entry).toBe('Bash(npm:*)');
  });
});

// ---------------------------------------------------------------------------
// grantClaudeToolPermission
// ---------------------------------------------------------------------------
describe('grantClaudeToolPermission', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns { success: false } for falsy entry', () => {
    expect(grantClaudeToolPermission(null)).toEqual({ success: false });
    expect(grantClaudeToolPermission('')).toEqual({ success: false });
    expect(grantClaudeToolPermission(undefined)).toEqual({ success: false });
  });

  it('adds a new tool to allowedTools and persists to localStorage', () => {
    const result = grantClaudeToolPermission('Read');
    expect(result.success).toBe(true);
    expect(result.alreadyAllowed).toBe(false);
    expect(result.updatedSettings.allowedTools).toContain('Read');

    // Verify it was persisted
    const stored = JSON.parse(localStorage.getItem(CLAUDE_SETTINGS_KEY));
    expect(stored.allowedTools).toContain('Read');
  });

  it('does not duplicate an already-allowed tool', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      allowedTools: ['Read'],
      disallowedTools: [],
    }));

    const result = grantClaudeToolPermission('Read');
    expect(result.success).toBe(true);
    expect(result.alreadyAllowed).toBe(true);
    expect(result.updatedSettings.allowedTools.filter(t => t === 'Read')).toHaveLength(1);
  });

  it('removes the tool from disallowedTools when granting', () => {
    localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify({
      allowedTools: [],
      disallowedTools: ['Bash(npm:*)'],
    }));

    const result = grantClaudeToolPermission('Bash(npm:*)');
    expect(result.success).toBe(true);
    expect(result.updatedSettings.disallowedTools).not.toContain('Bash(npm:*)');
    expect(result.updatedSettings.allowedTools).toContain('Bash(npm:*)');
  });

  it('includes a lastUpdated timestamp in the persisted settings', () => {
    const before = new Date().toISOString();
    grantClaudeToolPermission('Write');
    const stored = JSON.parse(localStorage.getItem(CLAUDE_SETTINGS_KEY));
    expect(stored.lastUpdated).toBeDefined();
    // Timestamp should be at or after when we started
    expect(new Date(stored.lastUpdated).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
  });
});
