import { createKernelHost } from './host';
import { startKernelSync } from './sync';
import type { AppFramework, KernelClient } from './types';

export interface StandaloneKernelOptions {
  appId: string;
  framework: AppFramework;
  /**
   * Hub origin when this document is not Hub (`http://localhost:3000`).
   * Leave empty when `/api` is already same-origin (embedded page or a reverse proxy).
   * Dev Hub allows credentialed CORS only for localhost / 127.0.0.1.
   */
  hubOrigin?: string;
}

/**
 * Local kernel client for a remote opened on its own origin.
 * Talks to the same Hub event, handoff, workspace, and notification routes.
 * Navigation needs `hubOrigin`; split panes exist only inside the Hub shell.
 */
export function createStandaloneKernel(options: StandaloneKernelOptions): KernelClient {
  const host = createKernelHost({
    mode: 'standalone',
    hubOrigin: options.hubOrigin,
  });
  host.setActiveAppId(options.appId);
  const client = host.clientFor({
    appId: options.appId,
    framework: options.framework,
  });
  const stop = startKernelSync(host, options.hubOrigin);
  const disposeClient = client.dispose.bind(client);
  return {
    ...client,
    dispose() {
      stop();
      disposeClient();
      host.dispose();
    },
  };
}
