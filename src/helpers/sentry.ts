import * as Sentry from '@sentry/node';

const TRANSIENT_UPSTREAM_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EPROTO',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);

function isTransientUpstreamError(err: any): boolean {
  if (!err) return false;
  if (err.code && TRANSIENT_UPSTREAM_CODES.has(err.code)) return true;
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.every((e: any) => isTransientUpstreamError(e));
  }
  return false;
}

// Drop unfixable upstream RPC failures before Sentry — third-party network conditions, not brovider bugs.
export function initSentryFilters() {
  Sentry.addGlobalEventProcessor((event, hint) => {
    if (isTransientUpstreamError(hint?.originalException)) return null;
    return event;
  });
}
