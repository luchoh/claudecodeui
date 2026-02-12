/**
 * ToolApproval.jsx - Tool permission approval UI extracted from ChatInterface.jsx
 *
 * Renders pending permission request banners with allow/deny/remember actions.
 * Does not persist permissions by itself; persistence is handled by the
 * useToolPermissions hook and localStorage-based settings helpers.
 */

import React from 'react';
import {
  getClaudeSettings,
  buildClaudeToolPermissionEntry,
  formatToolInputForDisplay,
} from '../../utils/chatUtils';

/**
 * @param {Object} props
 * @param {Array} props.pendingPermissionRequests - Queued tool approval requests
 * @param {Function} props.onPermissionDecision - handlePermissionDecision(requestIds, decision)
 * @param {Function} props.onGrantToolPermission - handleGrantToolPermission(suggestion)
 */
function ToolApproval({ pendingPermissionRequests, onPermissionDecision, onGrantToolPermission }) {
  if (!pendingPermissionRequests || pendingPermissionRequests.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {pendingPermissionRequests.map((request) => {
        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry
          ? settings.allowedTools.includes(permissionEntry)
          : false;
        const rememberLabel = alreadyAllowed ? 'Allow (saved)' : 'Allow & remember';
        // Group pending prompts that resolve to the same allow rule so
        // a single "Allow & remember" can clear them in one click.
        // This does not attempt fuzzy matching; it only batches identical rules.
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
            .filter(item => buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry)
            .map(item => item.requestId)
          : [request.requestId];

        return (
          <div
            key={request.requestId}
            className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Permission required
                </div>
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  Tool: <span className="font-mono">{request.toolName}</span>
                </div>
              </div>
              {permissionEntry && (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  Allow rule: <span className="font-mono">{permissionEntry}</span>
                </div>
              )}
            </div>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100">
                  View tool input
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-white/80 dark:bg-gray-900/60 border border-amber-200/60 dark:border-amber-800/60 p-2 text-xs text-amber-900 dark:text-amber-100 whitespace-pre-wrap">
                  {rawInput}
                </pre>
              </details>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onPermissionDecision(request.requestId, { allow: true })}
                className="inline-flex items-center gap-2 rounded-md bg-amber-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-amber-700 transition-colors"
              >
                Allow once
              </button>
              <button
                type="button"
                onClick={() => {
                  if (permissionEntry && !alreadyAllowed) {
                    onGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                  }
                  onPermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                }}
                className={`inline-flex items-center gap-2 rounded-md text-xs font-medium px-3 py-1.5 border transition-colors ${
                  permissionEntry
                    ? 'border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/30'
                    : 'border-gray-300 text-gray-400 cursor-not-allowed'
                }`}
                disabled={!permissionEntry}
              >
                {rememberLabel}
              </button>
              <button
                type="button"
                onClick={() => onPermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
                className="inline-flex items-center gap-2 rounded-md text-xs font-medium px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/30 transition-colors"
              >
                Deny
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(ToolApproval);
