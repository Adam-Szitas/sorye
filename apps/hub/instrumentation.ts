import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logConfigReport } = await import('./lib/config-report');
    await logConfigReport();
    // Each startup step is isolated: one failing step (for example an unreachable
    // database) is logged and must not turn every request into a 500.
    const step = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        console.error(`[sorye] startup step "${name}" failed: ${error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : 'unknown error'}`);
      }
    };
    await step('llm-control', async () => (await import('./lib/llm-control')).initializeLlmControl());
    await step('platform-config', async () => {
      const { startPlatformConfigWatcher } = await import('./lib/platform-config/watcher');
      void startPlatformConfigWatcher('hub').catch(() => undefined);
    });
    await step('operator-persistence', async () => (await import('./lib/operator/persist')).installOperatorPersistence());
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
