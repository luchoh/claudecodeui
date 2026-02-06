/**
 * SEC-015: WebSocket message validation using Zod
 * Validates all incoming WebSocket messages against strict schemas
 */
import { z } from 'zod';

// Shell WebSocket message schemas
const InitMessageSchema = z.object({
  type: z.literal('init'),
  projectPath: z.string().min(1).max(4096),
  sessionId: z.string().max(256).optional(),
  hasSession: z.boolean().optional(),
  provider: z.enum(['claude', 'cursor', 'codex', 'plain-shell']).optional(),
  initialCommand: z.string().max(4096).optional(),
  isPlainShell: z.boolean().optional(),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional()
});

const InputMessageSchema = z.object({
  type: z.literal('input'),
  data: z.string().max(65536) // 64KB max input
});

const ResizeMessageSchema = z.object({
  type: z.literal('resize'),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200)
});

// Chat WebSocket message schemas
const ClaudeCommandSchema = z.object({
  type: z.literal('claude-command'),
  command: z.string().max(1048576).optional(), // 1MB max (for large prompts)
  options: z.object({
    projectPath: z.string().max(4096).optional(),
    sessionId: z.string().max(256).optional(),
    model: z.string().max(128).optional(),
    images: z.array(z.object({
      name: z.string().max(256),
      data: z.string(), // Base64 encoded, can be large
      size: z.number().int().positive().max(10485760).optional(), // 10MB max
      mimeType: z.string().max(128).optional()
    })).max(10).optional()
  }).passthrough().optional()
}).passthrough();

const CursorCommandSchema = z.object({
  type: z.literal('cursor-command'),
  command: z.string().max(1048576).optional(),
  options: z.object({
    cwd: z.string().max(4096).optional(),
    sessionId: z.string().max(256).optional(),
    model: z.string().max(128).optional()
  }).passthrough().optional()
}).passthrough();

const CodexCommandSchema = z.object({
  type: z.literal('codex-command'),
  command: z.string().max(1048576).optional(),
  options: z.object({
    projectPath: z.string().max(4096).optional(),
    cwd: z.string().max(4096).optional(),
    sessionId: z.string().max(256).optional(),
    model: z.string().max(128).optional()
  }).passthrough().optional()
}).passthrough();

const AbortSessionSchema = z.object({
  type: z.literal('abort-session'),
  sessionId: z.string().max(256),
  provider: z.enum(['claude', 'cursor', 'codex']).optional()
});

const PermissionResponseSchema = z.object({
  type: z.literal('claude-permission-response'),
  requestId: z.string().max(256).optional(),
  allow: z.boolean().optional(),
  updatedInput: z.unknown().optional(),
  message: z.string().max(4096).optional(),
  rememberEntry: z.unknown().optional()
});

const CheckSessionStatusSchema = z.object({
  type: z.literal('check-session-status'),
  sessionId: z.string().max(256),
  provider: z.enum(['claude', 'cursor', 'codex']).optional()
});

const GetActiveSessionsSchema = z.object({
  type: z.literal('get-active-sessions')
});

const CursorResumeSchema = z.object({
  type: z.literal('cursor-resume'),
  sessionId: z.string().max(256),
  options: z.object({
    cwd: z.string().max(4096).optional()
  }).passthrough().optional()
});

const CursorAbortSchema = z.object({
  type: z.literal('cursor-abort'),
  sessionId: z.string().max(256)
});

// Combined schemas
export const ShellMessageSchema = z.discriminatedUnion('type', [
  InitMessageSchema,
  InputMessageSchema,
  ResizeMessageSchema
]);

export const ChatMessageSchema = z.discriminatedUnion('type', [
  ClaudeCommandSchema,
  CursorCommandSchema,
  CodexCommandSchema,
  AbortSessionSchema,
  PermissionResponseSchema,
  CheckSessionStatusSchema,
  GetActiveSessionsSchema,
  CursorResumeSchema,
  CursorAbortSchema
]);

/**
 * Validate a shell WebSocket message
 * @param {string} rawData - Raw message string
 * @returns {{success: true, data: object} | {success: false, error: string}}
 */
export function validateShellMessage(rawData) {
  try {
    const parsed = JSON.parse(rawData);
    const result = ShellMessageSchema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return {
      success: false,
      error: `Invalid message: ${result.error.issues.map(i => i.message).join(', ')}`
    };
  } catch (error) {
    return { success: false, error: 'Invalid JSON format' };
  }
}

/**
 * Validate a chat WebSocket message
 * @param {string} rawData - Raw message string
 * @returns {{success: true, data: object} | {success: false, error: string}}
 */
export function validateChatMessage(rawData) {
  try {
    const parsed = JSON.parse(rawData);
    const result = ChatMessageSchema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return {
      success: false,
      error: `Invalid message: ${result.error.issues.map(i => i.message).join(', ')}`
    };
  } catch (error) {
    return { success: false, error: 'Invalid JSON format' };
  }
}

// Export individual schemas for testing
export {
  InitMessageSchema,
  InputMessageSchema,
  ResizeMessageSchema,
  ClaudeCommandSchema,
  CursorCommandSchema,
  CodexCommandSchema
};
