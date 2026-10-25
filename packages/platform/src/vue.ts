import { effect, untracked, type ReadonlySignal } from './signals';

/** Structural stand-in for Vue's `shallowRef` result. */
export interface VueRef<T> {
  value: T;
}

/**
 * Pass these from `vue` so this package does not depend on Vue.
 * `shallowRef` and `onScopeDispose` are the real Vue functions.
 */
export interface VueSignalBridge {
  shallowRef<T>(value: T): VueRef<T>;
  onScopeDispose(fn: () => void): void;
}

/**
 * Bridge a kernel (or private) signal into a Vue ref. Call during `setup()`.
 *
 * ```ts
 * import { onScopeDispose, shallowRef } from 'vue';
 * import { useKernelSignal } from '@sorye/platform/vue';
 *
 * const workspaceName = useKernelSignal(kernel.signals.workspaceName, {
 *   shallowRef,
 *   onScopeDispose,
 * });
 * ```
 */
export function useKernelSignal<T>(source: ReadonlySignal<T>, vue: VueSignalBridge): VueRef<T> {
  const target = vue.shallowRef(source.peek());
  const stop = effect(() => {
    const value = source.value;
    untracked(() => {
      target.value = value;
    });
  });
  vue.onScopeDispose(stop);
  return target;
}
