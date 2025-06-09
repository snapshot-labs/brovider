import express from 'express';
import proxy from 'express-http-proxy';
import { setNode } from './helpers/utils';

const CACHE_METHODS = ['eth_chainId'];

const router = express.Router();

router.use(
  '/:network',
  setNode,
  proxy(req => req.nodeData.url, {
    timeout: 30e3,
    memoizeHost: false,
    proxyReqPathResolver: req => req.nodeData.path,
    filter: req => !(req.body && CACHE_METHODS.includes(req.body.method))
  })
);

router.use('/:network', async (req, res) => {
  const network = req.params.network;
  const { method, jsonrpc, id } = req.body;

  if (method && method === 'eth_chainId') {
    const result = `0x${Number(network).toString(16)}`;

    return res.json({ jsonrpc, id, result });
  }

  res.status(404).json({ jsonrpc, id, error: 'Method not found' });
});

export default router;
