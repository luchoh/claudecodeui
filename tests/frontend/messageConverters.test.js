// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  convertSessionMessages,
  convertCursorBlobs,
  calculateDiff,
} from '../../src/utils/messageConverters.js';

// ---------------------------------------------------------------------------
// convertSessionMessages
// ---------------------------------------------------------------------------
describe('convertSessionMessages', () => {
  it('returns an empty array for empty input', () => {
    expect(convertSessionMessages([])).toEqual([]);
  });

  // ── User messages ──────────────────────────────────────────────────────

  describe('user messages', () => {
    it('converts a simple string user message', () => {
      const raw = [{
        message: { role: 'user', content: 'Hello, Claude!' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('user');
      expect(result[0].content).toBe('Hello, Claude!');
      expect(result[0].timestamp).toBe('2025-01-01T00:00:00Z');
    });

    it('converts a user message with array content (text parts)', () => {
      const raw = [{
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Part one' },
            { type: 'text', text: 'Part two' },
          ],
        },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Part one\nPart two');
    });

    it('decodes HTML entities in user messages', () => {
      const raw = [{
        message: { role: 'user', content: 'a &amp; b &lt; c' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result[0].content).toBe('a & b < c');
    });

    it('skips user messages starting with system markers', () => {
      const markers = [
        '<command-name>test',
        '<command-message>info',
        '<command-args>args',
        '<local-command-stdout>output',
        '<system-reminder>reminder',
        'Caveat: something',
        'This session is being continued from a previous context',
        '[Request interrupted by user]',
      ];

      for (const marker of markers) {
        const raw = [{
          message: { role: 'user', content: marker },
          timestamp: '2025-01-01T00:00:00Z',
        }];
        const result = convertSessionMessages(raw);
        expect(result).toHaveLength(0);
      }
    });

    it('skips user messages with empty content', () => {
      const raw = [{
        message: { role: 'user', content: '' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      expect(convertSessionMessages(raw)).toHaveLength(0);
    });

    it('unescapes \\n in user messages while protecting math', () => {
      const raw = [{
        message: { role: 'user', content: 'line1\\nline2 $x\\ny$' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result[0].content).toBe('line1\nline2 $x\\ny$');
    });

    it('handles non-text parts in array content (e.g. tool_result)', () => {
      const raw = [{
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'some text' },
            { type: 'tool_result', tool_use_id: 'abc', content: 'result' },
          ],
        },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      // Only the text part appears in converted output
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('some text');
    });

    it('converts non-string, non-array content by casting to string', () => {
      const raw = [{
        message: { role: 'user', content: 42 },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('42');
    });
  });

  // ── Assistant messages ─────────────────────────────────────────────────

  describe('assistant messages', () => {
    it('converts a simple string assistant message', () => {
      const raw = [{
        message: { role: 'assistant', content: 'Hello!' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('assistant');
      expect(result[0].content).toBe('Hello!');
    });

    it('converts assistant messages with array content and text parts', () => {
      const raw = [{
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part A' },
            { type: 'text', text: 'Part B' },
          ],
        },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Part A');
      expect(result[1].content).toBe('Part B');
    });

    it('unescapes \\n in assistant message strings', () => {
      const raw = [{
        message: { role: 'assistant', content: 'line1\\nline2' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result[0].content).toBe('line1\nline2');
    });
  });

  // ── Tool use + tool result ─────────────────────────────────────────────

  describe('tool_use and tool_result', () => {
    it('converts assistant content with tool_use and attaches tool_result', () => {
      const raw = [
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool_123',
                name: 'Read',
                input: { file_path: '/tmp/test.txt' },
              },
            ],
          },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_123',
                content: 'file contents here',
                is_error: false,
              },
            ],
          },
          timestamp: '2025-01-01T00:00:01Z',
        },
      ];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].isToolUse).toBe(true);
      expect(result[0].toolName).toBe('Read');
      expect(result[0].toolResult).toBeDefined();
      expect(result[0].toolResult.content).toBe('file contents here');
      expect(result[0].toolResult.isError).toBe(false);
    });

    it('handles tool_result with is_error: true', () => {
      const raw = [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool_err', name: 'Bash', input: { command: 'fail' } },
            ],
          },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool_err', content: 'error!', is_error: true },
            ],
          },
          timestamp: '2025-01-01T00:00:01Z',
        },
      ];
      const result = convertSessionMessages(raw);
      expect(result[0].toolResult.isError).toBe(true);
      expect(result[0].toolError).toBe(true);
    });

    it('handles tool_use with no matching tool_result', () => {
      const raw = [{
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_orphan', name: 'Write', input: {} },
          ],
        },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].toolResult).toBe(null);
    });

    it('serialises tool_use input as JSON string', () => {
      const raw = [{
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/a.txt' } },
          ],
        },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(JSON.parse(result[0].toolInput)).toEqual({ file_path: '/a.txt' });
    });
  });

  // ── Thinking messages ──────────────────────────────────────────────────

  describe('thinking messages', () => {
    it('converts thinking messages with isThinking flag', () => {
      const raw = [{
        type: 'thinking',
        message: { content: 'Let me think about this...' },
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('assistant');
      expect(result[0].isThinking).toBe(true);
      expect(result[0].content).toBe('Let me think about this...');
    });
  });

  // ── Codex-style tool_use / tool_result messages ────────────────────────

  describe('Codex-style tool messages', () => {
    it('converts type=tool_use messages', () => {
      const raw = [{
        type: 'tool_use',
        toolName: 'Read',
        toolInput: '{"file_path":"/test.txt"}',
        toolCallId: 'tc_1',
        timestamp: '2025-01-01T00:00:00Z',
      }];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].isToolUse).toBe(true);
      expect(result[0].toolName).toBe('Read');
      expect(result[0].toolCallId).toBe('tc_1');
    });

    it('attaches tool_result to the most recent matching tool_use', () => {
      const raw = [
        {
          type: 'tool_use',
          toolName: 'Bash',
          toolInput: '{"command":"ls"}',
          toolCallId: 'tc_2',
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          type: 'tool_result',
          output: 'file1.txt\nfile2.txt',
          toolCallId: 'tc_2',
          timestamp: '2025-01-01T00:00:01Z',
        },
      ];
      const result = convertSessionMessages(raw);
      expect(result).toHaveLength(1);
      expect(result[0].toolResult.content).toBe('file1.txt\nfile2.txt');
    });
  });

  // ── Mixed conversation ─────────────────────────────────────────────────

  describe('mixed conversation', () => {
    it('handles a realistic multi-turn conversation', () => {
      const raw = [
        {
          message: { role: 'user', content: 'Read the file' },
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Sure, reading the file.' },
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'Read',
                input: { file_path: '/test.txt' },
              },
            ],
          },
          timestamp: '2025-01-01T00:00:01Z',
        },
        {
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: 'file content',
              },
            ],
          },
          timestamp: '2025-01-01T00:00:02Z',
        },
        {
          message: { role: 'assistant', content: 'Here is the file content.' },
          timestamp: '2025-01-01T00:00:03Z',
        },
      ];

      const result = convertSessionMessages(raw);
      // user message + assistant text + tool_use + assistant text = 4
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('user');
      expect(result[1].type).toBe('assistant');
      expect(result[1].content).toBe('Sure, reading the file.');
      expect(result[2].isToolUse).toBe(true);
      expect(result[2].toolResult.content).toBe('file content');
      expect(result[3].content).toBe('Here is the file content.');
    });
  });
});

// ---------------------------------------------------------------------------
// convertCursorBlobs
// ---------------------------------------------------------------------------
describe('convertCursorBlobs', () => {
  const projectPath = '/Users/test/project';

  it('returns an empty array for empty input', () => {
    expect(convertCursorBlobs([], projectPath)).toEqual([]);
  });

  it('skips system role messages', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: { role: 'system', content: 'You are a helpful assistant.' },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(0);
  });

  it('converts user text messages', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('user');
    expect(result[0].content).toBe('Hello');
  });

  it('converts assistant text messages', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('assistant');
    expect(result[0].content).toBe('Hi there!');
  });

  it('decodes HTML entities in text parts', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [{ type: 'text', text: '1 &lt; 2 &amp; 3 &gt; 0' }],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result[0].content).toBe('1 < 2 & 3 > 0');
  });

  it('extracts reasoning text', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Thinking about this...' },
          { type: 'text', text: 'Answer.' },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].reasoning).toBe('Thinking about this...');
    expect(result[0].content).toBe('Answer.');
  });

  it('renames ApplyPatch tool to Edit', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'ApplyPatch', toolCallId: 'tc1', args: { patch: '@@\n-old\n+new' } },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    expect(toolMsg.toolName).toBe('Edit');
  });

  it('converts tool-call with Read tool and resolves relative paths', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'Read', toolCallId: 'tc2', args: { path: 'src/index.js' } },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    expect(toolMsg.toolName).toBe('Read');
    const input = JSON.parse(toolMsg.toolInput);
    expect(input.file_path).toBe('/Users/test/project/src/index.js');
  });

  it('preserves absolute paths for Read tool', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'Read', toolCallId: 'tc3', args: { file_path: '/absolute/path.js' } },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    const input = JSON.parse(toolMsg.toolInput);
    expect(input.file_path).toBe('/absolute/path.js');
  });

  it('converts Write tool with relative path and contents field', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          {
            type: 'tool-call', toolName: 'Write', toolCallId: 'tc4',
            args: { path: 'output.txt', contents: 'hello world' },
          },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    const input = JSON.parse(toolMsg.toolInput);
    expect(input.file_path).toBe('/Users/test/project/output.txt');
    expect(input.content).toBe('hello world');
  });

  it('attaches tool-result to matching tool-call', () => {
    const blobs = [
      {
        id: 1, sequence: 1, rowid: 1,
        content: {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolName: 'Read', toolCallId: 'tc5', args: { path: 'a.txt' } },
          ],
        },
      },
      {
        id: 2, sequence: 2, rowid: 2,
        content: {
          role: 'tool',
          content: [
            { type: 'tool-result', toolName: 'Read', toolCallId: 'tc5', result: 'file content' },
          ],
        },
      },
    ];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    expect(toolMsg.toolResult).toBeDefined();
    expect(toolMsg.toolResult.content).toBe('file content');
  });

  it('handles tool_use parts (OpenAI-style within Cursor)', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Search', input: { query: 'test' } },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    expect(toolMsg.toolName).toBe('Search');
    expect(JSON.parse(toolMsg.toolInput)).toEqual({ query: 'test' });
  });

  it('handles content.message.content format', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        message: {
          role: 'user',
          content: 'Hello via message wrapper',
        },
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello via message wrapper');
  });

  it('handles content.message.content as array', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        message: {
          role: 'assistant',
          content: [
            { text: 'part 1' },
            'part 2',
          ],
        },
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('part 1\npart 2');
  });

  it('skips system role in content.message format', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        message: {
          role: 'system',
          content: 'system prompt',
        },
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(0);
  });

  it('sorts output by sequence number', () => {
    const blobs = [
      {
        id: 3, sequence: 3, rowid: 3,
        content: { role: 'assistant', content: 'Third' },
      },
      {
        id: 1, sequence: 1, rowid: 1,
        content: { role: 'user', content: 'First' },
      },
      {
        id: 2, sequence: 2, rowid: 2,
        content: { role: 'assistant', content: 'Second' },
      },
    ];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result[0].content).toBe('First');
    expect(result[1].content).toBe('Second');
    expect(result[2].content).toBe('Third');
  });

  it('handles string parts in content array', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: ['plain string part'],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('plain string part');
  });

  it('gracefully handles malformed blob content', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: null,
    }];
    // Should not throw
    const result = convertCursorBlobs(blobs, projectPath);
    expect(result).toEqual([]);
  });

  it('parses ApplyPatch diff and extracts old/new strings', () => {
    const blobs = [{
      id: 1, sequence: 1, rowid: 1,
      content: {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'ApplyPatch',
            toolCallId: 'tc_patch',
            args: {
              file_path: 'src/app.js',
              patch: '@@\n-const old = 1;\n+const new = 2;\n context line',
            },
          },
        ],
      },
    }];
    const result = convertCursorBlobs(blobs, projectPath);
    const toolMsg = result.find(m => m.isToolUse);
    expect(toolMsg.toolName).toBe('Edit');
    const input = JSON.parse(toolMsg.toolInput);
    expect(input.file_path).toBe('/Users/test/project/src/app.js');
    expect(input.old_string).toContain('const old = 1;');
    expect(input.new_string).toContain('const new = 2;');
  });
});

// ---------------------------------------------------------------------------
// calculateDiff
// ---------------------------------------------------------------------------
describe('calculateDiff', () => {
  it('returns empty array for identical strings', () => {
    expect(calculateDiff('hello', 'hello')).toEqual([]);
  });

  it('returns empty array for identical multi-line strings', () => {
    expect(calculateDiff('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('detects a single line change', () => {
    const diff = calculateDiff('old line', 'new line');
    expect(diff).toEqual([
      { type: 'removed', content: 'old line', lineNum: 1 },
      { type: 'added', content: 'new line', lineNum: 1 },
    ]);
  });

  it('detects added lines at the end', () => {
    const diff = calculateDiff('line1', 'line1\nline2');
    expect(diff).toEqual([
      { type: 'added', content: 'line2', lineNum: 2 },
    ]);
  });

  it('detects removed lines at the end', () => {
    const diff = calculateDiff('line1\nline2', 'line1');
    expect(diff).toEqual([
      { type: 'removed', content: 'line2', lineNum: 2 },
    ]);
  });

  it('detects changes in the middle of the text', () => {
    const diff = calculateDiff('a\nold\nc', 'a\nnew\nc');
    expect(diff).toEqual([
      { type: 'removed', content: 'old', lineNum: 2 },
      { type: 'added', content: 'new', lineNum: 2 },
    ]);
  });

  it('detects multiple changes', () => {
    const diff = calculateDiff('a\nb\nc', 'x\nb\nz');
    expect(diff).toHaveLength(4);
    expect(diff[0]).toEqual({ type: 'removed', content: 'a', lineNum: 1 });
    expect(diff[1]).toEqual({ type: 'added', content: 'x', lineNum: 1 });
    expect(diff[2]).toEqual({ type: 'removed', content: 'c', lineNum: 3 });
    expect(diff[3]).toEqual({ type: 'added', content: 'z', lineNum: 3 });
  });

  it('handles empty old string (all lines added)', () => {
    const diff = calculateDiff('', 'new');
    // '' splits to [''], 'new' splits to ['new'] -> one removed (''), one added ('new')
    expect(diff).toEqual([
      { type: 'removed', content: '', lineNum: 1 },
      { type: 'added', content: 'new', lineNum: 1 },
    ]);
  });

  it('handles empty new string (all lines removed)', () => {
    const diff = calculateDiff('old', '');
    expect(diff).toEqual([
      { type: 'removed', content: 'old', lineNum: 1 },
      { type: 'added', content: '', lineNum: 1 },
    ]);
  });

  it('handles both strings being empty', () => {
    const diff = calculateDiff('', '');
    expect(diff).toEqual([]);
  });

  it('handles multi-line additions at the end of a longer file', () => {
    const diff = calculateDiff('a\nb', 'a\nb\nc\nd');
    expect(diff).toEqual([
      { type: 'added', content: 'c', lineNum: 3 },
      { type: 'added', content: 'd', lineNum: 4 },
    ]);
  });

  it('handles multi-line removals from the end', () => {
    const diff = calculateDiff('a\nb\nc\nd', 'a\nb');
    expect(diff).toEqual([
      { type: 'removed', content: 'c', lineNum: 3 },
      { type: 'removed', content: 'd', lineNum: 4 },
    ]);
  });
});
