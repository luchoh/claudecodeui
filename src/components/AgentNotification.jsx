import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export default function AgentNotification({ notification, onView }) {
  const [visible, setVisible] = useState(null);

  useEffect(() => {
    if (notification) {
      setVisible(notification);
    }
  }, [notification]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-card border border-border shadow-lg rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {visible.agentId || 'Agent Message'}
            </div>
            <div className="text-xs text-muted-foreground">
              {visible.repo}
            </div>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setVisible(null)}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap">
          {visible.subject ? `${visible.subject}\n${visible.preview || ''}` : (visible.preview || 'New message')}
        </div>
        <div className="flex gap-2">
          <button
            className="flex-1 bg-primary text-primary-foreground text-xs font-medium rounded-md py-2"
            onClick={() => {
              setVisible(null);
              onView?.(visible);
            }}
          >
            View
          </button>
          <button
            className="flex-1 bg-muted text-muted-foreground text-xs font-medium rounded-md py-2"
            onClick={() => setVisible(null)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
