import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import dotenv from 'dotenv';

// path to the nuxt folder from node dist folder
const pathToNuxt = path.join(__dirname, '..', '..', 'ui');
const { parsed: nuxtConfig } = dotenv.config({ path: path.join(pathToNuxt, '.env') });
const endpoint = '/networks';
const { PORT: nuxtPort = 3000 } = nuxtConfig ?? {};

const router = express.Router();

const staticMiddleware = express.static(path.join(pathToNuxt, '.output', 'public'));
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
