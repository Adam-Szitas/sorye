import { effect, untracked } from './signals';
import type { ReadonlySignal } from './signals';

export interface AngularObserver<T> {
  next: (value: T) => void;
  error?: (error: unknown) => void;
  complete?: () => void;
}

/** Matches the `Subscribable` shape Angular's `toSignal()` reads. */
export interface AngularSubscribable<T> {
  subscribe(
    observer: AngularObserver<T> | ((value: T) => void),
  ): { unsubscribe(): void };
}

/**
 * Adapt a kernel signal to something `toSignal()` can subscribe to.
 * This file does not import `@angular/core` (optional peer; not installed here).
 *
 * ```ts
 * import { toSignal } from '@angular/core/rxjs-interop';
 * import type { Observable } from 'rxjs';
 * import { kernelSignalSubscribable } from '@sorye/platform/angular';
 *
 * const workspaceName = toSignal(
 *   kernelSignalSubscribable(kernel.signals.workspaceName) as Observable<string | null>,
 *   { requireSync: true },
 * );
 * ```
 */
export function kernelSignalSubscribable<T>(source: ReadonlySignal<T>): AngularSubscribable<T> {
  return {
    subscribe(observer) {
      const next = typeof observer === 'function' ? observer : observer.next.bind(observer);
      next(source.peek());
      let first = true;
      const stop = effect(() => {
        const value = source.value;
        if (first) {
          first = false;
          return;
        }
        untracked(() => next(value));
      });
      return { unsubscribe: stop };
    },
  };
}
