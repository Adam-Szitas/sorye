import { effect, untracked } from './signals';
import type { ReadonlySignal } from './signals';

/**
 * Any element with Lit's `requestUpdate` (LitElement satisfies this).
 * Lit stays a peer of the app, not a dependency of the kernel package.
 */
export interface KernelSignalElement {
  requestUpdate(): void;
  disconnectedCallback?(): void;
}

/**
 * Mixin: call `this.watchKernelSignal(signal)` from `connectedCallback`
 * and read `signal.value` in `render()`. The element re-renders on change.
 * The `any[]` rest parameter is required by TypeScript for mixin classes.
 *
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { customElement } from 'lit/decorators.js';
 * import { withKernelSignals } from '@sorye/platform/lit';
 *
 * @customElement('tasks-workspace')
 * class TasksWorkspace extends withKernelSignals(LitElement) {
 *   kernel!: KernelClient;
 *   override connectedCallback(): void {
 *     super.connectedCallback();
 *     this.watchKernelSignal(this.kernel.signals.workspaceName);
 *   }
 *   override render() {
 *     return html`${this.kernel.signals.workspaceName.value ?? ''}`;
 *   }
 * }
 * ```
 */
export function withKernelSignals<T extends new (...args: any[]) => KernelSignalElement>(
  Base: T,
) {
  return class KernelSignalsMixin extends Base {
    #stops: Array<() => void> = [];

    protected watchKernelSignal(source: ReadonlySignal<unknown>): void {
      const stop = effect(() => {
        void source.value;
        untracked(() => {
          this.requestUpdate();
        });
      });
      this.#stops.push(stop);
    }

    override disconnectedCallback(): void {
      for (const stop of this.#stops) stop();
      this.#stops = [];
      super.disconnectedCallback?.();
    }
  };
}
