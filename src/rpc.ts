import express from 'express';
import proxy from 'express-http-proxy';
import { REQUEST_TIMEOUT } from './constants';
import processGraphql from './middlewares/processGraphql';
import setGraphqlUrl from './middlewares/setGraphqlUrl';
import setNode from './middlewares/setNode';
import subgraphErrorHandler from './middlewares/subgraphErrorHandler';
import validateJsonRpc from './middlewares/validateJsonRpc';
import withCachedChainId from './middlewares/withCachedChainId';
import withRpcCache, { storeRpcResponse } from './middlewares/withRpcCache';

const router = express.Router();

router.post(
  ['/delegation/:network', '/subgraph/:network/:subgraph'],
  setGraphqlUrl,
  processGraphql,
  subgraphErrorHandler
);

const proxyOptions = {
  timeout: REQUEST_TIMEOUT,
  memoizeHost: false,
  proxyReqPathResolver: (req: any) => req._node.path,
  proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => ({
    ...proxyReqOpts,
    headers: { ...proxyReqOpts.headers, ...srcReq._node.headers }
  })
};
const streamed = proxy((req: any) => req._node.url, proxyOptions);
// Any response decorator turns the whole proxy instance into buffering mode,
// so cacheable reads get their own instance and everything else keeps streaming.
const buffered = proxy((req: any) => req._node.url, {
  ...proxyOptions,
  proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => {
    const opts = proxyOptions.proxyReqOptDecorator(proxyReqOpts, srcReq);
    // The proxy only inflates gzip before the decorator; a brotli body would be unreadable.
    delete opts.headers['accept-encoding'];
    return opts;
  },
  userResDecorator: storeRpcResponse
});

router.use(
  /^\/([^\/]+)$/,
  validateJsonRpc,
  withCachedChainId,
  setNode,
  withRpcCache,
  (req: any, res, next) => (req._cache ? buffered : streamed)(req, res, next)
);

export default router;
