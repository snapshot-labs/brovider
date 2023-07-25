import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import dotenv from 'dotenv';

const { parsed: nuxtConfig } = dotenv.config({ path: path.join(__dirname, '..', 'ui', '.env') });
const endpoint = '/networks';
const { PORT: nuxtPort = 3000 } = nuxtConfig ?? {};

const router = express.Router();

const staticMiddleware = express.static(path.join(__dirname, '..', 'ui', '.output', 'public'));
const proxyMiddleware = createProxyMiddleware({
  target: `http://localhost:${nuxtPort}${endpoint}`,
  changeOrigin: true,
  pathRewrite: {
    [`^${endpoint}`]: ''
  }
});

router.use(staticMiddleware);
router.use(`${endpoint}*`, proxyMiddleware);

export default router;
