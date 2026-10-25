import { signal, type Signal } from './signals';
import { createStandaloneKernel } from './standalone';
import type { AppFramework, KernelClient, KernelMountContext } from './types';

export interface AppStore<T extends object> {
  readonly appId: string;
  readonly state: { readonly [K in keyof T]: Signal<T[K]> };
}

/**
 * Private signals for one app. They are not registered with the kernel.
 * Call once per mount if the values should reset when the app unmounts.
 */
export function createAppStore<T extends object>(
  appId: string,
  initial: T,
): AppStore<T> {
  const id = appId.trim();
  if (!id) throw new Error('createAppStore requires an app id');
  const state = {} as { [K in keyof T]: Signal<T[K]> };
  for (const key of Object.keys(initial) as (keyof T)[]) {
    state[key] = signal(initial[key]);
  }
  return { appId: id, state };
}

export interface ConnectKernelOptions {
  appId: string;
  framework: AppFramework;
  /** Present when Hub called `mount(container, context)`. */
  context?: KernelMountContext;
  hubOrigin?: string;
  /**
   * Force the Relay HTTP client. Also forced by `?standalone=1` on this document,
   * including when Hub passed a kernel handle.
   */
  standalone?: boolean;
}

export interface ConnectedKernel {
  kernel: KernelClient;
  /** Stops a standalone client this call created. No-op for a Hub-owned kernel. */
  release(): void;
}

export function wantsStandalone(explicit?: boolean): boolean {
  if (explicit) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('standalone') === '1';
}

/** Embedded kernel from Hub, or a standalone client against Hub `/api`. */
export function connectKernel(options: ConnectKernelOptions): ConnectedKernel {
  const standalone = wantsStandalone(options.standalone) || !options.context?.kernel;
  if (!standalone && options.context?.kernel) {
    return { kernel: options.context.kernel, release() {} };
  }
  const kernel = createStandaloneKernel({
    appId: options.appId,
    framework: options.framework,
    hubOrigin: options.hubOrigin,
  });
  return {
    kernel,
    release() {
      kernel.dispose();
    },
  };
}

export interface MountAppOptions extends ConnectKernelOptions {
  render(kernel: KernelClient): () => void;
}

/**
 * Shared boot helper. Framework adapters render inside `render`.
 * Hub passes `context`. Standalone omits it (or sets `?standalone=1`).
 */
export function mountApp(options: MountAppOptions): () => void {
  const connected = connectKernel(options);
  const unmount = options.render(connected.kernel);
  return () => {
    unmount();
    connected.release();
  };
}
