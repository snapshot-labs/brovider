import express from 'express';
import proxy from 'express-http-proxy';
import setNode from './middlewares/setNode';
import withCachedEthChain from './middlewares/withCachedEthChain';

const router = express.Router();

const TIMEOUT = 30e3;

router.use(
  '/:network',
  withCachedEthChain,
  setNode,
  proxy(req => req._node.url, {
    timeout: TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: req => req._node.path
  })
);

export default router;
