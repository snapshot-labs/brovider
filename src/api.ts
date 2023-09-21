import express from 'express';
import dbq from './mysql';
import { captureErr } from './sentry';
import { processNodes } from './process-nodes';

const router = express.Router();

router.post('/process', async (req, res) => {
  try {
    await processNodes({ forced: true });
    return res.json({
      status: 'ok'
    });
  } catch (error) {
    captureErr(error);
    return res.status(500).json({ error: (error as any).message });
  }
});

router.get('/nodes', async (req, res) => {
  try {
    const [nodes] = await dbq.loadNodes();
    return res.json({ nodes });
  } catch (error) {
    captureErr(error);
    return res.status(500).json({ error: (error as any).message });
  }
});

router.post('/nodes', async (req, res) => {
  let { nodes } = req.body;
  if (!Array.isArray(nodes)) {
    nodes = [nodes];
  }

  const serializedNodes = nodes
    .map(node => {
      const { url, provider = null } = node;
      if (!url || typeof url !== 'string' || (provider && typeof provider !== 'string')) {
        return null;
      }

      return {
        url,
        provider
      };
    })
    .filter(Boolean);

  if (serializedNodes.length === 0) {
    return res.status(400).json({ error: 'Invalid nodes' });
  }

  try {
    await dbq.addNodes(serializedNodes);

    return res.json({
      status: 'ok',
      nodeIds: serializedNodes.map(({ url }) => url)
    });
  } catch (error) {
    captureErr(error);
    return res.status(500).json({ error: (error as any).message });
  }
});

router.delete('/nodes', async (req, res) => {
  const { nodeUrl } = req.body;
  if (!nodeUrl || typeof nodeUrl !== 'string') {
    return res.status(400).json({ error: 'Invalid node url' });
  }

  try {
    await dbq.deleteNode(nodeUrl);
    return res.json({
      status: 'ok'
    });
  } catch (error) {
    captureErr(error);
    return res.status(500).json({ error: (error as any).message });
  }
});

router.put('/nodes', async (req, res) => {
  const { node } = req.body;
  if (!node || !node.url || typeof node.url !== 'string') {
    return res.status(400).json({ error: 'Invalid node url' });
  }

  const { url, provider, requests, errors, duration } = node;
  const isValidUrl = typeof url === 'string';
  const isValidProvider = typeof provider === 'string';
  const isValidRequests = typeof requests === 'number' && requests >= 0;
  const isValidErrors = typeof errors === 'number' && errors >= 0;
  const isValidDuration = typeof duration === 'number' && duration >= 0;

  if (!isValidUrl || !isValidProvider || !isValidRequests || !isValidErrors || !isValidDuration) {
    return res.status(400).json({ error: 'Invalid node' });
  }

  try {
    await dbq.updateNode({
      url,
      provider,
      requests,
      errors,
      duration
    });
    return res.json({
      status: 'ok'
    });
  } catch (error) {
    captureErr(error);
    return res.status(500).json({ error: (error as any).message });
  }
});

export default router;
