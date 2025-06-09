import { nodes } from './nodes';

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getPathFromURL(url: string) {
  const removePrefix = url.replace(/^(http|https):\/\//, '');

  return removePrefix.indexOf('/') > -1 ? removePrefix.substring(removePrefix.indexOf('/')) : '/';
}

export function setNode(req, res, next) {
  const { network } = req.params;
  const { jsonrpc, id } = req.body;

  if (!nodes[network]) {
    return res.status(404).json({ jsonrpc, id, error: 'Invalid network' });
  }

  req.nodeData = {
    url: nodes[network],
    path: getPathFromURL(nodes[network]),
    network
  };

  next();
}
