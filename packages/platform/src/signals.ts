import {
  computed as preactComputed,
  effect as preactEffect,
  signal as preactSignal,
  untracked,
  type Signal as PreactSignal,
} from '@preact/signals-core';

export { untracked };

export { batch } from '@preact/signals-core';

/**
 * App-owned writable signal. Stays in the app bundle.
 * The kernel never receives these objects.
 */
export interface Signal<T> {
  value: T;
  peek(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** Read-only view. Apps get this for kernel state. There is no setter. */
export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
  subscribe(listener: (value: T) => void): () => void;
}

function subscribeInner<T>(
  inner: PreactSignal<T>,
  listener: (value: T) => void,
): () => void {
  let first = true;
  return preactEffect(() => {
    const value = inner.value;
    if (first) {
      first = false;
      return;
    }
    untracked(() => listener(value));
  });
}

function asReadonly<T>(inner: PreactSignal<T>): ReadonlySignal<T> {
  return {
    get value() {
      return inner.value;
    },
    peek() {
      return inner.peek();
    },
    subscribe(listener) {
      return subscribeInner(inner, listener);
    },
  };
}

export function signal<T>(initial: T): Signal<T> {
  const inner = preactSignal(initial);
  return {
    get value() {
      return inner.value;
    },
    set value(next: T) {
      inner.value = next;
    },
    peek() {
      return inner.peek();
    },
    subscribe(listener) {
      return subscribeInner(inner, listener);
    },
  };
}

export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return asReadonly(preactComputed(fn));
}

/** Tracks `.value` reads of signals created by this package. */
export function effect(fn: () => void): () => void {
  return preactEffect(fn);
}

export function readOnly<T>(source: Signal<T> | ReadonlySignal<T>): ReadonlySignal<T> {
  return {
    get value() {
      return source.value;
    },
    peek() {
      return source.peek();
    },
    subscribe(listener) {
      return source.subscribe(listener);
    },
  };
}
