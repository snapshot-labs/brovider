import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const router = express.Router();

router.post(
  '/1',
  createProxyMiddleware({
    target: 'https://eth-mainnet.g.alchemy.com/v2/ZWXqGt01pfN6SG6PuyZ2m9o236iv8iCl',
    secure: true,
    changeOrigin: true,
    logLevel: 'debug',
    followRedirects: true,
    cookieDomainRewrite: 'localhost',
    onProxyReq: () => console.log('Req'),
    onProxyRes: () => console.log('Res'),
    onError: e => console.log(e)
  })
);

export default router;
