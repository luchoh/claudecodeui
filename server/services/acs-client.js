import { EventEmitter } from 'events';

const DEFAULT_ACS_URL = 'http://127.0.0.1:4100/mcp';
const DEFAULT_ADMIN_URL = 'http://127.0.0.1:4100';
const DEFAULT_MAX_REGISTRATIONS = 20;

const CAPABILITIES = ['ui', 'dashboard', 'notifications'];

function getRepoFromProject(project) {
  if (!project) return null;
  if (typeof project === 'string') return project;
  return project.name || project.repo || null;
}

function getRepoPathFromProject(project) {
  if (!project || typeof project !== 'object') return null;
  return project.fullPath || project.path || project.repoPath || null;
}

export class ACSConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.connections = new Map();
    this.inFlight = new Map();
    this.enabled = process.env.ACS_ENABLED === '1';
    this.acsUrl = process.env.ACS_URL || DEFAULT_ACS_URL;
    this.adminUrl = process.env.ACS_ADMIN_URL || DEFAULT_ADMIN_URL;
    this.adminToken = process.env.ACS_ADMIN_TOKEN || '';
    this.maxRegistrations = Number(process.env.ACS_MAX_REGISTRATIONS || DEFAULT_MAX_REGISTRATIONS);
    this.sdk = null;
    this.sdkError = null;
    this.logger = options.logger || console;
  }

  isEnabled() {
    return this.enabled;
  }

  getStatus() {
    const connections = {};
    for (const [repo, connection] of this.connections.entries()) {
      connections[repo] = {
        connected: connection.connected,
        agentId: connection.agentId,
        repoPath: connection.repoPath,
        lastActiveAt: connection.lastActiveAt
      };
    }

    return {
      enabled: this.enabled,
      acsUrl: this.acsUrl,
      adminUrl: this.adminUrl,
      maxRegistrations: this.maxRegistrations,
      sdkAvailable: Boolean(this.sdk),
      sdkError: this.sdkError ? this.sdkError.message : null,
      connections
    };
  }

  async loadSdk() {
    if (this.sdk) return this.sdk;
    if (this.sdkError) throw this.sdkError;

    try {
      const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
      const transportModule = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const Client = clientModule.Client || clientModule.default || clientModule;
      const StreamableHTTPClientTransport =
        transportModule.StreamableHTTPClientTransport || transportModule.default || transportModule;

      if (!Client || !StreamableHTTPClientTransport) {
        throw new Error('MCP SDK missing expected exports');
      }

      this.sdk = { Client, StreamableHTTPClientTransport };
      return this.sdk;
    } catch (error) {
      this.sdkError = error;
      this.logger.error('[ACS] Failed to load MCP SDK:', error.message);
      throw error;
    }
  }

  async createClient() {
    const { Client, StreamableHTTPClientTransport } = await this.loadSdk();
    const transport = new StreamableHTTPClientTransport(new URL(this.acsUrl));
    const client = new Client({ name: 'claude-code-ui', version: 'unknown' });
    await client.connect(transport);
    return { client, transport };
  }

  async callTool(client, name, args = {}) {
    if (!client) {
      throw new Error('MCP client not initialized');
    }

    if (typeof client.callTool === 'function') {
      return client.callTool({ name, arguments: args });
    }

    if (typeof client.request === 'function') {
      return client.request({ method: 'tools/call', params: { name, arguments: args } });
    }

    throw new Error('MCP client does not support tool calls');
  }

  attachNotificationHandlers(repo, client) {
    const handleNotification = (method, params) => {
      const normalized = typeof method === 'string' ? method.toLowerCase() : '';
      const payload = {
        repo,
        method,
        params,
        timestamp: new Date().toISOString()
      };

      if (normalized.includes('message')) {
        this.emit('acs-message-received', payload);
      } else if (normalized.includes('agent')) {
        this.emit('acs-agent-changed', payload);
      } else if (normalized.includes('bridge')) {
        this.emit('acs-bridge-status', payload);
      } else if (normalized.includes('connection')) {
        this.emit('acs-connection-changed', payload);
      } else {
        this.emit('acs-notification', payload);
      }

      const connection = this.connections.get(repo);
      if (connection) {
        connection.lastActiveAt = Date.now();
      }
    };

    let attached = false;

    if (typeof client.setNotificationHandler === 'function') {
      const methods = [
        'notifications/message',
        'notifications/agent-changed',
        'notifications/bridge-status',
        'notifications/connection-changed'
      ];

      methods.forEach((method) => {
        client.setNotificationHandler(method, (params) => handleNotification(method, params));
      });
      attached = true;
    }

    if (!attached && typeof client.onnotification === 'function') {
      client.onnotification = (notification) => {
        handleNotification(notification?.method, notification?.params);
      };
      attached = true;
    }

    if (!attached && typeof client.on === 'function') {
      client.on('notification', (notification) => {
        handleNotification(notification?.method, notification?.params);
      });
      attached = true;
    }

    if (!attached) {
      this.logger.warn('[ACS] MCP client does not support notification handlers');
    }
  }

  async registerForProject(repo, repoPath) {
    if (!this.enabled) {
      return { skipped: true, reason: 'ACS disabled' };
    }

    if (!repo || !repoPath) {
      throw new Error('Repo and repoPath are required');
    }

    if (this.connections.has(repo)) {
      const existing = this.connections.get(repo);
      if (existing?.connected) {
        return existing;
      }
    }

    if (this.inFlight.has(repo)) {
      return this.inFlight.get(repo);
    }

    const registrationPromise = (async () => {
      const { client, transport } = await this.createClient();
      this.attachNotificationHandlers(repo, client);

      const response = await this.callTool(client, 'register', {
        vendor: 'ui',
        repo,
        repoPath,
        capabilities: CAPABILITIES,
        force: true
      });

      const agentId =
        response?.content?.agentId ||
        response?.content?.id ||
        response?.agentId ||
        `ui-${repo}`;

      const connection = {
        repo,
        repoPath,
        client,
        transport,
        agentId,
        connected: true,
        connectedAt: Date.now(),
        lastActiveAt: Date.now()
      };

      this.connections.set(repo, connection);
      this.emit('acs-connection-changed', {
        repo,
        connected: true,
        agentId,
        timestamp: new Date().toISOString()
      });

      return connection;
    })();

    this.inFlight.set(repo, registrationPromise);

    try {
      const connection = await registrationPromise;
      return connection;
    } finally {
      this.inFlight.delete(repo);
    }
  }

  async unregisterFromProject(repo) {
    const connection = this.connections.get(repo);
    if (!connection) {
      return { skipped: true, reason: 'not registered' };
    }

    try {
      await this.callTool(connection.client, 'unregister', {});
    } catch (error) {
      this.logger.warn('[ACS] Failed to unregister:', error.message);
    }

    await this.closeConnection(repo, connection);
    this.connections.delete(repo);
    this.emit('acs-connection-changed', {
      repo,
      connected: false,
      agentId: connection.agentId,
      timestamp: new Date().toISOString()
    });

    return { success: true };
  }

  async closeConnection(repo, connection) {
    if (!connection) return;
    connection.connected = false;

    if (connection.client) {
      if (typeof connection.client.close === 'function') {
        await connection.client.close();
      } else if (typeof connection.client.disconnect === 'function') {
        await connection.client.disconnect();
      }
    }

    if (connection.transport && typeof connection.transport.close === 'function') {
      await connection.transport.close();
    }
  }

  async registerAll(projects = []) {
    if (!this.enabled) return { skipped: true, reason: 'ACS disabled' };

    const projectList = Array.isArray(projects) ? projects : [];
    const desired = projectList
      .map((project) => ({
        repo: getRepoFromProject(project),
        repoPath: getRepoPathFromProject(project)
      }))
      .filter((entry) => entry.repo && entry.repoPath);

    const desiredRepos = new Set(desired.map((entry) => entry.repo));

    for (const repo of this.connections.keys()) {
      if (!desiredRepos.has(repo)) {
        await this.unregisterFromProject(repo);
      }
    }

    let entries = desired;
    if (desired.length > this.maxRegistrations) {
      const withPriority = desired.map((entry) => {
        const existing = this.connections.get(entry.repo);
        return {
          ...entry,
          priority: existing?.lastActiveAt || 0
        };
      });

      withPriority.sort((a, b) => b.priority - a.priority);
      entries = withPriority.slice(0, this.maxRegistrations);

      this.logger.warn(
        `[ACS] Registration cap reached (${this.maxRegistrations}). Skipping ${desired.length - entries.length} repos.`
      );
    }

    const results = [];
    for (const entry of entries) {
      results.push(await this.registerForProject(entry.repo, entry.repoPath));
    }

    return results;
  }

  async ensureConnection(repo, repoPathOverride) {
    const connection = this.connections.get(repo);
    if (connection?.connected) return connection;
    const repoPath = repoPathOverride || connection?.repoPath;
    if (!repoPath) {
      throw new Error(`Missing repoPath for ${repo}`);
    }
    return this.registerForProject(repo, repoPath);
  }

  async sendMessage(fromRepo, payload) {
    const repoPath = payload?.repoPath;
    const connection = await this.ensureConnection(fromRepo, repoPath);
    const { repoPath: _ignored, ...args } = payload || {};
    return this.callTool(connection.client, 'send', args);
  }

  async checkInbox(repo, payload = {}) {
    const repoPath = payload?.repoPath;
    const connection = await this.ensureConnection(repo, repoPath);
    const { repoPath: _ignored, ...args } = payload || {};
    return this.callTool(connection.client, 'check_inbox', args);
  }

  async discoverAgents(repo, payload = {}) {
    const repoPath = payload?.repoPath;
    const connection = await this.ensureConnection(repo, repoPath);
    const { repoPath: _ignored, ...args } = payload || {};
    return this.callTool(connection.client, 'discover', args);
  }

  async reply(repo, payload = {}) {
    const repoPath = payload?.repoPath;
    const connection = await this.ensureConnection(repo, repoPath);
    const { repoPath: _ignored, ...args } = payload || {};
    return this.callTool(connection.client, 'reply', args);
  }

  async acknowledge(repo, payload = {}) {
    const repoPath = payload?.repoPath;
    const connection = await this.ensureConnection(repo, repoPath);
    const { repoPath: _ignored, ...args } = payload || {};
    return this.callTool(connection.client, 'acknowledge', args);
  }

  async fetchAdmin(pathname, options = {}) {
    const url = new URL(pathname, this.adminUrl);
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (this.adminToken) {
      headers.Authorization = `Bearer ${this.adminToken}`;
    }

    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
    const response = await fetchFn(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ACS admin request failed (${response.status}): ${text}`);
    }

    return response;
  }

  async listBridges() {
    const response = await this.fetchAdmin('/admin/api/bridges');
    return response.json();
  }

  async createBridge(payload) {
    const response = await this.fetchAdmin('/admin/api/bridges', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  async updateBridge(repo, payload) {
    const response = await this.fetchAdmin(`/admin/api/bridges/${encodeURIComponent(repo)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  async deleteBridge(repo) {
    const response = await this.fetchAdmin(`/admin/api/bridges/${encodeURIComponent(repo)}`, {
      method: 'DELETE'
    });
    return response.json();
  }

  async getBridgeOutputHistory(repo, limit = 100) {
    const response = await this.fetchAdmin(
      `/admin/api/bridges/${encodeURIComponent(repo)}/output?mode=history&limit=${limit}`
    );
    return response.json();
  }

  async shutdown() {
    const repos = Array.from(this.connections.keys());
    for (const repo of repos) {
      await this.unregisterFromProject(repo);
    }
  }
}
