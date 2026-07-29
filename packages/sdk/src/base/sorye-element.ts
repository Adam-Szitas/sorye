import { css, LitElement, type CSSResultGroup } from 'lit';

/** Shared host styles — limits layout/paint scope to reduce repaints. */
export const hostStyles = css`
  :host {
    box-sizing: border-box;
    contain: layout style;
    font-family: var(--sorye-font, system-ui, sans-serif);
    color: var(--sorye-text, #f1f5f9);
    -webkit-font-smoothing: antialiased;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  :host([hidden]) {
    display: none !important;
  }
`;

export abstract class SoryeElement extends LitElement {
  static styles: CSSResultGroup = [hostStyles];

  /**
   * Disable shadow DOM adoption for faster updates on static slot-only components.
   * Override in leaf components that only project slots.
   */
  protected createRenderRoot() {
    return super.createRenderRoot();
  }

  /** Skip Lit update when value unchanged (default Lit behavior, explicit helper). */
  protected hasChanged(name: PropertyKey, old: unknown, value: unknown): boolean {
    return old !== value;
  }
}

/** Type-safe custom element define — avoids double registration. */
export function defineElement(
  name: string,
  ctor: CustomElementConstructor,
): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(name)) {
    customElements.define(name, ctor);
  }
}
