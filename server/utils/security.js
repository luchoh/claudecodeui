import fs from 'fs';
import path from 'path';
import os from 'os';

// SEC-003: CORS configuration
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001,http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// SEC-003b: Network-based CORS (e.g., "10.10.10.0/24,192.168.3.0/24")
export const ALLOWED_NETWORKS = (process.env.ALLOWED_NETWORKS || '')
  .split(',')
  .map(n => n.trim())
  .filter(Boolean);

/**
 * Check if an IP is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., "10.10.10.0/24")
 * @returns {boolean}
 */
export function ipInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  const ipNum = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  const rangeNum = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Check if origin is from an allowed network
 * @param {string} origin - Origin URL (e.g., "http://10.10.10.55:5177")
 * @returns {boolean}
 */
export function isOriginFromAllowedNetwork(origin) {
  if (!ALLOWED_NETWORKS.length) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Check if host is an IP address (not a hostname)
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false;
    return ALLOWED_NETWORKS.some(cidr => ipInCidr(host, cidr));
  } catch {
    return false;
  }
}

// SEC-004: Server binding configuration
export const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// SEC-006: Allowed PTY commands
export const ALLOWED_PTY_COMMANDS = new Set([
  'claude', 'cursor-agent', 'codex', 'bash', 'zsh', 'sh'
]);

// SEC-012: PTY idle timeout (default 5 minutes)
export const PTY_IDLE_TIMEOUT = parseInt(process.env.PTY_IDLE_TIMEOUT || '300000', 10);

// SEC-006: Multi-root workspace validation
export const WORKSPACES_ROOTS = (process.env.WORKSPACES_ROOT || os.homedir())
  .split(',')
  .map(p => path.resolve(p.trim()));

/**
 * SEC-006: Validate that a path is within allowed workspace roots
 * @param {string} requestedPath - The path to validate
 * @returns {boolean} Whether the path is allowed
 */
export function isAllowedWorkspacePath(requestedPath) {
  try {
    const resolved = path.resolve(requestedPath);
    // Try to get real path (follows symlinks)
    let real;
    try {
      real = fs.realpathSync(resolved);
    } catch (e) {
      // Path doesn't exist yet, use resolved path
      real = resolved;
    }
    return WORKSPACES_ROOTS.some(root =>
      real === root || real.startsWith(root + path.sep)
    );
  } catch (e) {
    return false;
  }
}

/**
 * SEC-006: Validate a command against the allowlist
 * @param {string} cmd - The command to validate
 * @returns {{valid: boolean, cmd?: string, args?: string[], error?: string}}
 */
export function validatePtyCommand(cmd) {
  if (!cmd) return { valid: true, cmd: null, args: [] };

  // Reject shell metacharacters that could enable command injection
  if (/[&;|`<>$(){}\\]/.test(cmd)) {
    return { valid: false, error: 'Shell metacharacters not allowed in commands' };
  }

  const parts = cmd.trim().split(/\s+/);
  const baseCmd = parts[0];

  if (!ALLOWED_PTY_COMMANDS.has(baseCmd)) {
    return {
      valid: false,
      error: `Command '${baseCmd}' not in allowlist. Allowed: ${Array.from(ALLOWED_PTY_COMMANDS).join(', ')}`
    };
  }

  return { valid: true, cmd: baseCmd, args: parts.slice(1) };
}

/**
 * SEC-006: Escape a string for safe use in bash/sh
 * Uses single quotes and escapes embedded single quotes with '\''
 * @param {string} arg - The argument to escape
 * @returns {string} The escaped argument
 */
export function escapeShellArg(arg) {
  if (!arg) return "''";
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * SEC-006: Escape a string for PowerShell
 * Escapes backticks, double quotes, and dollar signs
 * @param {string} arg - The argument to escape
 * @returns {string} The escaped argument
 */
export function escapePowerShellArg(arg) {
  if (!arg) return '""';
  // Escape backticks, double quotes, and dollar signs
  return '"' + arg.replace(/[`"$]/g, '`$&') + '"';
}

/**
 * SEC-006: Validate sessionId format (alphanumeric, hyphens, underscores only)
 * @param {string} sessionId - The session ID to validate
 * @returns {boolean} Whether the sessionId is valid
 */
export function isValidSessionId(sessionId) {
  if (!sessionId) return true;
  return /^[a-zA-Z0-9_-]+$/.test(sessionId);
}
