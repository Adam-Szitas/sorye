import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.SENTRY_RELEASE || undefined,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.05,
  sendDefaultPii: false,
  beforeSend(event) {
    delete event.request?.data;
    delete event.request?.cookies;
    delete event.request?.headers;
    delete event.user;
    return event;
  },
  beforeSendTransaction(event) {
    delete event.request?.data;
    delete event.request?.cookies;
    delete event.request?.headers;
    return event;
  },
});
