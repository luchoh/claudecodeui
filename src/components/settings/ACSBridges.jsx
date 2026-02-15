import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, Edit3, Trash2, TerminalSquare } from 'lucide-react';
import { useACS } from '../../contexts/ACSContext';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

const defaultForm = {
  repo: '',
  repoPath: '',
  model: '',
  command: '',
  sandbox: '',
  approval: '',
  enabled: true
};

export default function ACSBridges() {
  const {
    enabled,
    status,
    bridges,
    refreshBridges,
    createBridge,
    updateBridge,
    deleteBridge,
    loadBridgeOutput
  } = useACS();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState(defaultForm);
  const [editingRepo, setEditingRepo] = useState(null);
  const [outputVisible, setOutputVisible] = useState({});
  const [outputLogs, setOutputLogs] = useState({});
  const [isLoadingOutput, setIsLoadingOutput] = useState({});

  useEffect(() => {
    if (enabled) {
      refreshBridges();
    }
  }, [enabled, refreshBridges]);

  const handleOpenForm = (bridge = null) => {
    if (bridge) {
      setEditingRepo(bridge.repo || bridge.name || bridge.id);
      setFormData({
        repo: bridge.repo || bridge.name || '',
        repoPath: bridge.repoPath || bridge.path || '',
        model: bridge.model || '',
        command: bridge.command || '',
        sandbox: bridge.sandbox || '',
        approval: bridge.approval || '',
        enabled: bridge.enabled !== false
      });
    } else {
      setEditingRepo(null);
      setFormData(defaultForm);
    }
    setIsFormOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (editingRepo) {
      await updateBridge(editingRepo, formData);
    } else {
      await createBridge(formData);
    }
    setIsFormOpen(false);
  };

  const handleDelete = async (bridge) => {
    const repo = bridge.repo || bridge.name || bridge.id;
    if (!repo) return;
    await deleteBridge(repo);
  };

  const toggleOutput = async (bridge) => {
    const repo = bridge.repo || bridge.name || bridge.id;
    if (!repo) return;
    setOutputVisible((prev) => ({ ...prev, [repo]: !prev[repo] }));
    if (!outputVisible[repo]) {
      setIsLoadingOutput((prev) => ({ ...prev, [repo]: true }));
      try {
        const output = await loadBridgeOutput(repo, 200);
        const events = Array.isArray(output) ? output : output?.events || output?.output || [];
        setOutputLogs((prev) => ({ ...prev, [repo]: events }));
      } catch (error) {
        console.error('Failed to load bridge output:', error);
      } finally {
        setIsLoadingOutput((prev) => ({ ...prev, [repo]: false }));
      }
    }
  };

  if (!enabled) {
    return (
      <div className="text-sm text-muted-foreground">
        ACS is disabled or unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">Connection</div>
        <div className="text-sm font-medium text-foreground">
          {status?.enabled ? 'Connected' : 'Disabled'}
        </div>
        <div className="text-xs text-muted-foreground">
          {status?.acsUrl || 'ACS URL not available'}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">ACS Bridges</div>
          <div className="text-xs text-muted-foreground">
            Manage Codex bridges connected to ACS.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refreshBridges}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={() => handleOpenForm()}>
            <Plus className="w-4 h-4 mr-1" />
            Add Bridge
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {bridges.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No bridges configured.
          </div>
        ) : (
          bridges.map((bridge) => {
            const repo = bridge.repo || bridge.name || bridge.id;
            const status = bridge.status || bridge.state || (bridge.enabled ? 'running' : 'stopped');
            return (
              <div key={repo} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-foreground">{repo}</div>
                    <div className="text-xs text-muted-foreground">{bridge.repoPath || bridge.path || 'No path'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      status === 'running' ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300" :
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    )}>
                      {status}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleOpenForm(bridge)}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => handleDelete(bridge)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  className="text-xs text-primary flex items-center gap-1"
                  onClick={() => toggleOutput(bridge)}
                >
                  <TerminalSquare className="w-3 h-3" />
                  {outputVisible[repo] ? 'Hide output' : 'Show output'}
                </button>

                {outputVisible[repo] && (
                  <div className="border border-border rounded-md bg-background">
                    <ScrollArea className="h-40 p-2">
                      {isLoadingOutput[repo] ? (
                        <div className="text-xs text-muted-foreground">Loading output…</div>
                      ) : (
                        <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground">
                          {(outputLogs[repo] || []).map((line, index) => (
                            <div key={`${repo}-line-${index}`}>{line.message || line.output || JSON.stringify(line)}</div>
                          ))}
                        </pre>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
          <form className="bg-card border border-border rounded-lg p-4 w-full max-w-lg space-y-3" onSubmit={handleSubmit}>
            <div className="text-sm font-semibold text-foreground">
              {editingRepo ? 'Edit Bridge' : 'Add Bridge'}
            </div>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Repo name"
              value={formData.repo}
              onChange={(e) => setFormData((prev) => ({ ...prev, repo: e.target.value }))}
              required
            />
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Repo path"
              value={formData.repoPath}
              onChange={(e) => setFormData((prev) => ({ ...prev, repoPath: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Model (optional)"
                value={formData.model}
                onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
              />
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Command (optional)"
                value={formData.command}
                onChange={(e) => setFormData((prev) => ({ ...prev, command: e.target.value }))}
              />
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Sandbox (optional)"
                value={formData.sandbox}
                onChange={(e) => setFormData((prev) => ({ ...prev, sandbox: e.target.value }))}
              />
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Approval (optional)"
                value={formData.approval}
                onChange={(e) => setFormData((prev) => ({ ...prev, approval: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="text-xs text-muted-foreground">Enabled</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingRepo ? 'Save' : 'Create'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
