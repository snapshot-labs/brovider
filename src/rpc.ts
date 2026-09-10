import express, { Request } from 'express';
import proxy from 'express-http-proxy';
import { REQUEST_TIMEOUT } from './constants';
import processGraphql from './middlewares/processGraphql';
import setGraphqlUrl from './middlewares/setGraphqlUrl';
import setNode from './middlewares/setNode';
import subgraphErrorHandler from './middlewares/subgraphErrorHandler';
import validateJsonRpc from './middlewares/validateJsonRpc';
import withCachedChainId from './middlewares/withCachedChainId';
import withRpcCache, { storeRpcResponse } from './middlewares/withRpcCache';

type ProxyReqOpts = Parameters<
  NonNullable<proxy.ProxyOptions['proxyReqOptDecorator']>
>[0];

const router = express.Router();

router.post(
  ['/delegation/:network', '/subgraph/:network/:subgraph'],
  setGraphqlUrl,
  processGraphql,
  subgraphErrorHandler
);

const withNodeHeaders = (proxyReqOpts: ProxyReqOpts, srcReq: Request) => ({
  ...proxyReqOpts,
  headers: { ...proxyReqOpts.headers, ...srcReq._node.headers }
});

const proxyOptions: proxy.ProxyOptions = {
  timeout: REQUEST_TIMEOUT,
  memoizeHost: false,
  proxyReqPathResolver: req => req._node.path,
  proxyReqOptDecorator: withNodeHeaders
};
const target = (req: Request) => req._node.url;
const streamed = proxy(target, proxyOptions);
// Any response decorator turns the whole proxy instance into buffering mode,
// so cacheable reads get their own instance and everything else keeps streaming.
const buffered = proxy(target, {
  ...proxyOptions,
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    const opts = withNodeHeaders(proxyReqOpts, srcReq);
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
  (req: Request, res, next) =>
    (req._cache ? buffered : streamed)(req, res, next)
);

export default router;
