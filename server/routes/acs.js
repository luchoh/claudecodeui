import express from 'express';

const router = express.Router();

function getManager(req) {
  return req.app.locals.acsManager;
}

function ensureAcsEnabled(req, res) {
  const manager = getManager(req);
  if (!manager || !manager.isEnabled()) {
    res.status(503).json({ error: 'ACS disabled' });
    return null;
  }
  return manager;
}

router.get('/status', (req, res) => {
  const manager = getManager(req);
  if (!manager) {
    return res.json({ enabled: false, error: 'ACS manager not initialized' });
  }
  return res.json(manager.getStatus());
});

router.get('/projects/:repo/agents', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.discoverAgents(req.params.repo, req.query || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/projects/:repo/inbox', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.checkInbox(req.params.repo, req.query || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:repo/send', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.sendMessage(req.params.repo, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:repo/reply', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.reply(req.params.repo, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:repo/ack', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.acknowledge(req.params.repo, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/bridges', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.listBridges();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bridges', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.createBridge(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/bridges/:repo', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.updateBridge(req.params.repo, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/bridges/:repo', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const result = await manager.deleteBridge(req.params.repo);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/bridges/:repo/output', async (req, res) => {
  const manager = ensureAcsEnabled(req, res);
  if (!manager) return;
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const result = await manager.getBridgeOutputHistory(req.params.repo, limit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
