import { loadHubEnv } from './load-hub-env';

loadHubEnv();

void import('./ocr-worker').catch((err: unknown) => {
  console.error('[ocr-worker] fatal startup error', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
});
