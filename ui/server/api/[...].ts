import { createProxyMiddleware } from 'http-proxy-middleware';

const serverPort = process.env.SERVER_PORT ?? 8081;
const apiProxyMiddleware = createProxyMiddleware('/api', {
  target: `http://localhost:${serverPort}`,
  changeOrigin: true
});

export default defineEventHandler(async event => {
  await new Promise((resolve, reject) => {
    const next = (err?: unknown) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    };

    apiProxyMiddleware(event.node.req as any, event.node.res as any, next);
  });
});
