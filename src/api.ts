import express from 'express';
import dbq from './mysql';
import { captureErr } from './sentry';
import { processNodes } from './process-nodes';

const router = express.Router();

router.post('/process', async (req, res) => {
  try {
    await processNodes();
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

router.post('/nodes', (req, res) => {
  return res.json({
    status: 'ok'
  });
});

router.delete('/nodes', (req, res) => {
  return res.json({
    status: 'ok'
  });
});

router.put('/nodes', (req, res) => {
  return res.json({
    status: 'ok'
  });
});

export default router;
