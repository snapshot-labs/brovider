import express from 'express';
import proxy from 'express-http-proxy';
import { REQUEST_TIMEOUT } from './constants';
import processGraphql from './middlewares/processGraphql';
import setGraphqlUrl from './middlewares/setGraphqlUrl';
import setNode from './middlewares/setNode';
import subgraphErrorHandler from './middlewares/subgraphErrorHandler';
import withCachedEthChain from './middlewares/withCachedEthChain';

const router = express.Router();

router.post(
  ['/delegation/:network', '/subgraph/:network/:subgraph'],
  setGraphqlUrl,
  processGraphql,
  subgraphErrorHandler
);

router.use(
  /^\/([^\/]+)$/,
  withCachedEthChain,
  setNode,
  proxy((req: any) => req._node.url, {
    timeout: REQUEST_TIMEOUT,
    memoizeHost: false,
    proxyReqPathResolver: (req: any) => req._node.path
  })
);

export default router;
