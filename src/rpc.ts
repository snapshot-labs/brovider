import express from 'express';
import proxy from 'express-http-proxy';
import setNode from './middlewares/setNode';
import withCachedEthChain from './middlewares/withCachedEthChain';

const router = express.Router();

const TIMEOUT = 30e3;

router.use(
  /^\/([^\/]+)$/,
  withCachedEthChain,
  setNode,
  proxy((req: any) => req._node.url, {
    timeout: TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: (req: any) => req._node.path
  })
);

export default router;
