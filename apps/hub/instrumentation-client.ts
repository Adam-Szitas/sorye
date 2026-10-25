import * as Sentry from '@sentry/nextjs';

const SENSITIVE_QUERY =
  /(?:auth|authorization|cookie|code|email|key|password|secret|token|signature|sig|file|body|content)=/gi;

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/auth|cookie|code|email|key|password|secret|token|signature|file|body|content/i.test(key)) {
        url.searchParams.set(key, '[Filtered]');
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return value.replace(SENSITIVE_QUERY, '[Filtered]=');
  }
}

function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    event.request.url = event.request.url ? scrubUrl(event.request.url) : undefined;
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
  }
  delete event.user;
  return event;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE) || 0.05,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
