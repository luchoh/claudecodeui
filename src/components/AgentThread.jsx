import React, { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { useACS } from '../contexts/ACSContext';
import { cn } from '../lib/utils';

export default function AgentThread({ project, thread }) {
  const { sendMessage, addLocalMessage, markThreadRead } = useACS();
  const [to, setTo] = useState(thread?.agentId || '');
  const [subject, setSubject] = useState(thread?.subject || '');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messages = useMemo(() => thread?.messages || [], [thread]);
  const isCompose = !thread?.agentId || thread?.mode === 'compose';

  useEffect(() => {
    setTo(thread?.agentId || '');
    setSubject(thread?.subject || '');
  }, [thread?.agentId, thread?.subject]);

  useEffect(() => {
    if (project?.name && thread?.id) {
      markThreadRead(project.name, thread.id);
    }
  }, [project?.name, thread?.id, markThreadRead]);

  if (!project || !thread) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Select an agent message to view the thread.
      </div>
    );
  }

  const handleSend = async () => {
    if (!body.trim()) return;
    if (isCompose && !to.trim()) return;
    setIsSending(true);
    try {
      const payload = {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim()
      };
      if (thread?.id && !isCompose) {
        payload.threadId = thread.id;
      }
      await sendMessage(project.name, payload);
      const localMessage = {
        id: `local-${Date.now()}`,
        threadId: thread?.id || `${to}-${subject || 'message'}`,
        from: 'ui',
        subject: payload.subject,
        body: payload.body,
        timestamp: new Date().toISOString()
      };
      addLocalMessage(project.name, thread?.id || localMessage.threadId, localMessage);
      setBody('');
    } catch (error) {
      console.error('ACS send error:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border px-4 py-3 bg-card">
        <div className="text-sm font-semibold text-foreground">
          {thread.agentId || 'New Message'}
        </div>
        {thread.subject && (
          <div className="text-xs text-muted-foreground truncate">
            {thread.subject}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          messages.map((message) => {
            const isIncoming = message.from === thread.agentId;
            return (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-1",
                  isIncoming ? "items-start" : "items-end"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    isIncoming
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground"
                  )}
                >
                  <div className="whitespace-pre-wrap">{message.body || message.subject}</div>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {message.timestamp ? new Date(message.timestamp).toLocaleString() : ''}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border p-4 space-y-2">
        {isCompose && (
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="To (agent id)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        )}
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
            placeholder="Write a message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            className={cn(
              "h-10 px-3 rounded-md flex items-center gap-2 text-sm font-medium",
              isSending ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
            )}
            onClick={handleSend}
            disabled={isSending || !body.trim() || (isCompose && !to.trim())}
          >
            <Send className="w-4 h-4" />
            {isSending ? 'Sending' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
