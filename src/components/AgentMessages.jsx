import React from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { useACS } from '../contexts/ACSContext';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

export default function AgentMessages({
  project,
  selectedThreadId,
  onSelectThread,
  onCompose
}) {
  const { enabled, projectConnections } = useACS();

  if (!enabled || !project?.name) {
    return null;
  }

  const connection = projectConnections[project.name] || {};
  const threads = connection.threads || [];

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="w-3 h-3" />
          Agent Messages
        </div>
        {onCompose && (
          <button
            className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onCompose(project);
            }}
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          No agent messages yet
        </div>
      ) : (
        <div className="space-y-1">
          {threads.map((thread) => {
            const isSelected = selectedThreadId === thread.id;
            return (
              <button
                key={thread.id}
                className={cn(
                  "w-full text-left px-2 py-2 rounded-md border transition-colors",
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/40 hover:bg-accent/40"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectThread(thread, project);
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                    {(thread.agentId || 'AG').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate">
                        {thread.agentId || 'Agent'}
                      </span>
                      {thread.unreadCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          {thread.unreadCount}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {thread.subject || thread.preview || 'New message'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
