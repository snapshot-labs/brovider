import init, { client } from '@snapshot-labs/snapshot-metrics';
import { Express } from 'express';

let server;

export default function initMetrics(app: Express) {
  init(app, {
    normalizedPath: [['/[0-9]+', '/#network']],
    whitelistedPath: [/^\/$/, /^\/monitor$/, /^\/[0-9]+$/]
  });

  app.use((req, res, next) => {
    if (!server) {
      // @ts-ignore
      server = req.socket.server;
    }
    next();
  });
}

new client.Gauge({
  name: 'express_open_connections_size',
  help: 'Number of open connections on the express server',
  async collect() {
    if (server) {
      this.set(server._connections);
    }
  }
});
