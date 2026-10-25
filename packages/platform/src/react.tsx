import { useSyncExternalStore, createContext, useContext, type ReactNode } from 'react';
import type { ReadonlySignal } from './signals';
import type { KernelClient, KernelGlobalSnapshot } from './types';

const KernelContext = createContext<KernelClient | null>(null);

export function KernelProvider({
  kernel,
  children,
}: {
  kernel: KernelClient;
  children: ReactNode;
}) {
  return <KernelContext.Provider value={kernel}>{children}</KernelContext.Provider>;
}

export function useKernel(): KernelClient {
  const kernel = useContext(KernelContext);
  if (!kernel) {
    throw new Error('useKernel requires KernelProvider from @sorye/platform/react');
  }
  return kernel;
}

/**
 * Subscribe a component to one signal.
 * Uses `useSyncExternalStore` so the component re-renders when the value changes
 * without a signals compiler transform.
 */
export function useSignalValue<T>(source: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => source.subscribe(() => onStoreChange()),
    () => source.value,
    () => source.value,
  );
}

/** Re-render when any kernel field in the snapshot changes. */
export function useKernelState(): KernelGlobalSnapshot {
  const kernel = useKernel();
  return useSyncExternalStore(
    (onStoreChange) => kernel.subscribe(() => onStoreChange()),
    () => kernel.getState(),
    () => kernel.getState(),
  );
}
