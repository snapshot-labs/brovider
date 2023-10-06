import * as Sentry from '@sentry/node';
import { Express, Request, Response } from 'express';
import { URL } from 'url';

export function initLogger(app: Express) {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
      ...Sentry.autoDiscoverNodePerformanceMonitoringIntegrations()
    ],

    tracesSampleRate: parseFloat(process.env.SENTRY_TRACE_SAMPLE_RATE as string)
  });

  const sentryRequestHandler = Sentry.Handlers.requestHandler({
    request: ['body', 'url']
  });
  app.use(sentryRequestHandler);
  app.use(Sentry.Handlers.tracingHandler());
}

export function fallbackLogger(app: Express) {
  if (process.env.NODE_ENV !== 'production') return;

  app.use(Sentry.Handlers.errorHandler());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(function onError(err: any, req: any, res: any, _: any) {
    res.statusCode = 500;
    res.end(`${res.sentry}\n`);
  });
}

export function captureErr(e: any) {
  if (process.env.NODE_ENV !== 'production') {
    return console.error(e);
  }

  Sentry.captureException(e);
}

type ProxyErrorContext = {
  url: string | URL;
  statusCode?: number;
  responseBody: any;
};
export function captureProxy(e: any, req: Request, res: Response, context: ProxyErrorContext) {
  if (process.env.NODE_ENV !== 'production') {
    return console.error(JSON.stringify(context, null, 2));
  }

  Sentry.withScope(scope => {
    scope.setExtra('proxyUrl', context.url || req.url);
    scope.setExtra('method', req.method);
    scope.setExtra('params', req.params);
    scope.setExtra('body', req.body);
    scope.setExtra('response', res);
    scope.setExtra('resourceResponse', context.responseBody);
    scope.setExtra('statusCode', context.statusCode);
    Sentry.captureException(e);
  });
}
