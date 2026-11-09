import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeLlmControl } = await import('./lib/llm-control');
    await initializeLlmControl();
    const { installOperatorPersistence } = await import('./lib/operator/persist');
    await installOperatorPersistence();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.SENTRY_DSN) {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge' && process.env.SENTRY_DSN) {
    await import('./sentry.edge.config');
  }
}

type RequestErrorArgs = Parameters<typeof Sentry.captureRequestError>;

export function onRequestError(...args: RequestErrorArgs): ReturnType<typeof Sentry.captureRequestError> {
  try {
    const error = args[0];
    const context = args[2] as { routePath?: string } | undefined;
    const route = typeof context?.routePath === 'string' ? context.routePath : 'hub';
    if (process.env.NEXT_RUNTIME === 'nodejs') void import('./lib/operator/sink').then(({ noteOperatorError }) => {
      noteOperatorError({
        appId: 'hub',
        route,
        message: error instanceof Error ? error.message : 'Request error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }).catch(() => undefined);
  } catch {
    // Error capture must not change the request failure.
  }
  return Sentry.captureRequestError(...args);
}
