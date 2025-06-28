import express from 'express';
import proxy from 'express-http-proxy';
import setDelegation from './middlewares/setDelegation';
import setNode from './middlewares/setNode';
import setSubgraph from './middlewares/setSubgraph';
import withCachedEthChain from './middlewares/withCachedEthChain';

const router = express.Router();

const TIMEOUT = 30e3;

router.post(
  '/delegation/:network',
  setDelegation,
  proxy(req => req._delegation.url, {
    timeout: TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: req => req._delegation.path
  })
);

router.post(
  '/subgraph/:network/:subgraph',
  setSubgraph,
  proxy(req => req._subgraph.url, {
    timeout: TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: req => req._subgraph.path
  })
);

router.use(
  /^\/(\d+|sn|sn-tn)$/,
  withCachedEthChain,
  setNode,
  proxy(req => req._node.url, {
    timeout: TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: req => req._node.path
  })
);

export default router;
