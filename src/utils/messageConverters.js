/**
 * messageConverters.js - Message format conversion utilities
 *
 * Extracted from ChatInterface.jsx.
 * Pure functions that convert raw session messages into the UI display format.
 */

import {
  decodeHtmlEntities,
  unescapeWithMathProtection,
} from './chatUtils';

/**
 * Convert raw Claude/Codex session messages into display format.
 * Handles user messages, assistant messages, tool_use, tool_result, and thinking messages.
 *
 * @param {Array} rawMessages - Raw messages from the API
 * @returns {Array} Converted messages for display
 */
export function convertSessionMessages(rawMessages) {
  const converted = [];
  const toolResults = new Map(); // Map tool_use_id to tool result

  // First pass: collect all tool results
  for (const msg of rawMessages) {
    if (msg.message?.role === 'user' && Array.isArray(msg.message?.content)) {
      for (const part of msg.message.content) {
        if (part.type === 'tool_result') {
          toolResults.set(part.tool_use_id, {
            content: part.content,
            isError: part.is_error,
            timestamp: new Date(msg.timestamp || Date.now()),
            toolUseResult: msg.toolUseResult || null
          });
        }
      }
    }
  }

  // Second pass: process messages and attach tool results to tool uses
  for (const msg of rawMessages) {
    // Handle user messages
    if (msg.message?.role === 'user' && msg.message?.content) {
      let content = '';

      if (Array.isArray(msg.message.content)) {
        const textParts = [];

        for (const part of msg.message.content) {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        }

        content = textParts.join('\n');
      } else if (typeof msg.message.content === 'string') {
        content = decodeHtmlEntities(msg.message.content);
      } else {
        content = decodeHtmlEntities(String(msg.message.content));
      }

      const shouldSkip = !content ||
                        content.startsWith('<command-name>') ||
                        content.startsWith('<command-message>') ||
                        content.startsWith('<command-args>') ||
                        content.startsWith('<local-command-stdout>') ||
                        content.startsWith('<system-reminder>') ||
                        content.startsWith('Caveat:') ||
                        content.startsWith('This session is being continued from a previous') ||
                        content.startsWith('[Request interrupted');

      if (!shouldSkip) {
        content = unescapeWithMathProtection(content);
        converted.push({
          type: 'user',
          content: content,
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    }

    // Handle thinking messages (Codex reasoning)
    else if (msg.type === 'thinking' && msg.message?.content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(msg.message.content),
        timestamp: msg.timestamp || new Date().toISOString(),
        isThinking: true
      });
    }

    // Handle tool_use messages (Codex function calls)
    else if (msg.type === 'tool_use' && msg.toolName) {
      converted.push({
        type: 'assistant',
        content: '',
        timestamp: msg.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: msg.toolName,
        toolInput: msg.toolInput || '',
        toolCallId: msg.toolCallId
      });
    }

    // Handle tool_result messages (Codex function outputs)
    else if (msg.type === 'tool_result') {
      for (let i = converted.length - 1; i >= 0; i--) {
        if (converted[i].isToolUse && !converted[i].toolResult) {
          if (!msg.toolCallId || converted[i].toolCallId === msg.toolCallId) {
            converted[i].toolResult = {
              content: msg.output || '',
              isError: false
            };
            break;
          }
        }
      }
    }

    // Handle assistant messages
    else if (msg.message?.role === 'assistant' && msg.message?.content) {
      if (Array.isArray(msg.message.content)) {
        for (const part of msg.message.content) {
          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            converted.push({
              type: 'assistant',
              content: text,
              timestamp: msg.timestamp || new Date().toISOString()
            });
          } else if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: msg.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolInput: JSON.stringify(part.input),
              toolResult: toolResult ? {
                content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
                isError: toolResult.isError,
                toolUseResult: toolResult.toolUseResult
              } : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date()
            });
          }
        }
      } else if (typeof msg.message.content === 'string') {
        let text = msg.message.content;
        text = unescapeWithMathProtection(text);
        converted.push({
          type: 'assistant',
          content: text,
          timestamp: msg.timestamp || new Date().toISOString()
        });
      }
    }
  }

  return converted;
}

/**
 * Convert raw Cursor session blobs into display format.
 * Handles Cursor-specific message formats including tool-call, tool-result, reasoning, etc.
 *
 * @param {Array} blobs - Raw message blobs from the Cursor SQLite database
 * @param {string} projectPath - Project root path for resolving relative file paths
 * @returns {Array} Converted messages for display, sorted chronologically
 */
export function convertCursorBlobs(blobs, projectPath) {
  const converted = [];
  const toolUseMap = {};

  for (let blobIdx = 0; blobIdx < blobs.length; blobIdx++) {
    const blob = blobs[blobIdx];
    const content = blob.content;
    let text = '';
    let role = 'assistant';
    let reasoningText = null;
    try {
      if (content?.role && content?.content) {
        if (content.role === 'system') {
          continue;
        }

        if (content.role === 'tool') {
          if (Array.isArray(content.content)) {
            for (const item of content.content) {
              if (item?.type === 'tool-result') {
                let toolName = item.toolName || 'Unknown Tool';
                if (toolName === 'ApplyPatch') {
                  toolName = 'Edit';
                }
                const toolCallId = item.toolCallId || content.id;
                const result = item.result || '';

                if (toolUseMap[toolCallId]) {
                  toolUseMap[toolCallId].toolResult = {
                    content: result,
                    isError: false
                  };
                } else {
                  converted.push({
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(Date.now() + blobIdx * 1000),
                    blobId: blob.id,
                    sequence: blob.sequence,
                    rowid: blob.rowid,
                    isToolUse: true,
                    toolName: toolName,
                    toolId: toolCallId,
                    toolInput: null,
                    toolResult: {
                      content: result,
                      isError: false
                    }
                  });
                }
              }
            }
          }
          continue;
        } else {
          role = content.role === 'user' ? 'user' : 'assistant';

          if (Array.isArray(content.content)) {
            const textParts = [];

            for (const part of content.content) {
              if (part?.type === 'text' && part?.text) {
                textParts.push(decodeHtmlEntities(part.text));
              } else if (part?.type === 'reasoning' && part?.text) {
                reasoningText = decodeHtmlEntities(part.text);
              } else if (part?.type === 'tool-call') {
                if (textParts.length > 0 || reasoningText) {
                  converted.push({
                    type: role,
                    content: textParts.join('\n'),
                    reasoning: reasoningText,
                    timestamp: new Date(Date.now() + blobIdx * 1000),
                    blobId: blob.id,
                    sequence: blob.sequence,
                    rowid: blob.rowid
                  });
                  textParts.length = 0;
                  reasoningText = null;
                }

                let toolName = part.toolName || 'Unknown Tool';
                if (toolName === 'ApplyPatch') {
                  toolName = 'Edit';
                }
                const toolId = part.toolCallId || `tool_${blobIdx}`;

                let toolInput = part.args;

                if (toolName === 'Edit' && part.args) {
                  if (part.args.patch) {
                    const patchLines = part.args.patch.split('\n');
                    let oldLines = [];
                    let newLines = [];
                    let inPatch = false;

                    for (const line of patchLines) {
                      if (line.startsWith('@@')) {
                        inPatch = true;
                      } else if (inPatch) {
                        if (line.startsWith('-')) {
                          oldLines.push(line.substring(1));
                        } else if (line.startsWith('+')) {
                          newLines.push(line.substring(1));
                        } else if (line.startsWith(' ')) {
                          oldLines.push(line.substring(1));
                          newLines.push(line.substring(1));
                        }
                      }
                    }

                    const filePath = part.args.file_path;
                    const absolutePath = filePath && !filePath.startsWith('/')
                      ? `${projectPath}/${filePath}`
                      : filePath;
                    toolInput = {
                      file_path: absolutePath,
                      old_string: oldLines.join('\n') || part.args.patch,
                      new_string: newLines.join('\n') || part.args.patch
                    };
                  } else {
                    toolInput = part.args;
                  }
                } else if (toolName === 'Read' && part.args) {
                  const filePath = part.args.path || part.args.file_path;
                  const absolutePath = filePath && !filePath.startsWith('/')
                    ? `${projectPath}/${filePath}`
                    : filePath;
                  toolInput = {
                    file_path: absolutePath
                  };
                } else if (toolName === 'Write' && part.args) {
                  const filePath = part.args.path || part.args.file_path;
                  const absolutePath = filePath && !filePath.startsWith('/')
                    ? `${projectPath}/${filePath}`
                    : filePath;
                  toolInput = {
                    file_path: absolutePath,
                    content: part.args.contents || part.args.content
                  };
                }

                const toolMessage = {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid,
                  isToolUse: true,
                  toolName: toolName,
                  toolId: toolId,
                  toolInput: toolInput ? JSON.stringify(toolInput) : null,
                  toolResult: null
                };
                converted.push(toolMessage);
                toolUseMap[toolId] = toolMessage;
              } else if (part?.type === 'tool_use') {
                if (textParts.length > 0 || reasoningText) {
                  converted.push({
                    type: role,
                    content: textParts.join('\n'),
                    reasoning: reasoningText,
                    timestamp: new Date(Date.now() + blobIdx * 1000),
                    blobId: blob.id,
                    sequence: blob.sequence,
                    rowid: blob.rowid
                  });
                  textParts.length = 0;
                  reasoningText = null;
                }

                const toolName2 = part.name || 'Unknown Tool';
                const toolId2 = part.id || `tool_${blobIdx}`;

                const toolMessage2 = {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid,
                  isToolUse: true,
                  toolName: toolName2,
                  toolId: toolId2,
                  toolInput: part.input ? JSON.stringify(part.input) : null,
                  toolResult: null
                };
                converted.push(toolMessage2);
                toolUseMap[toolId2] = toolMessage2;
              } else if (typeof part === 'string') {
                textParts.push(part);
              }
            }

            if (textParts.length > 0) {
              text = textParts.join('\n');
              if (reasoningText && !text) {
                converted.push({
                  type: role,
                  content: '',
                  reasoning: reasoningText,
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid
                });
                text = '';
              }
            } else {
              text = '';
            }
          } else if (typeof content.content === 'string') {
            text = content.content;
          }
        }
      } else if (content?.message?.role && content?.message?.content) {
        if (content.message.role === 'system') {
          continue;
        }
        role = content.message.role === 'user' ? 'user' : 'assistant';
        if (Array.isArray(content.message.content)) {
          text = content.message.content
            .map(p => (typeof p === 'string' ? p : (p?.text || '')))
            .filter(Boolean)
            .join('\n');
        } else if (typeof content.message.content === 'string') {
          text = content.message.content;
        }
      }
    } catch (e) {
      console.log('Error parsing blob content:', e);
    }
    if (text && text.trim()) {
      const message = {
        type: role,
        content: text,
        timestamp: new Date(Date.now() + blobIdx * 1000),
        blobId: blob.id,
        sequence: blob.sequence,
        rowid: blob.rowid
      };

      if (reasoningText) {
        message.reasoning = reasoningText;
      }

      converted.push(message);
    }
  }

  // Sort messages by sequence/rowid to maintain chronological order
  converted.sort((a, b) => {
    if (a.sequence !== undefined && b.sequence !== undefined) {
      return a.sequence - b.sequence;
    }
    if (a.rowid !== undefined && b.rowid !== undefined) {
      return a.rowid - b.rowid;
    }
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  return converted;
}

/**
 * Simple diff calculation between two strings.
 * Returns an array of { type: 'added'|'removed', content, lineNum } entries.
 *
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {Array}
 */
export function calculateDiff(oldStr, newStr) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diffLines = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldIndex >= oldLines.length) {
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      newIndex++;
    } else if (newIndex >= newLines.length) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex++;
    } else if (oldLine === newLine) {
      oldIndex++;
      newIndex++;
    } else {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
      oldIndex++;
      newIndex++;
    }
  }

  return diffLines;
}
