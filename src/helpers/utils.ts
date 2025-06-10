import { nodes } from './nodes';

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function setNode(req, res, next) {
  const { network } = req.params;
  const { jsonrpc, id } = req.body || {};
  const url = nodes[network];

  if (!jsonrpc) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  if (!url) {
    return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
  }

  req._node = {
    url,
    path: url.substring(url.indexOf('/', url.indexOf('://') + 3) || 0) || '/',
    network
  };

  next();
}
