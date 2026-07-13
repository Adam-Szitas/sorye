import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    border-radius: var(--sorye-radius-full, 9999px);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    padding: 0.25rem 0.625rem;
    border: 1px solid transparent;
    contain: strict;
    content-visibility: auto;
  }

  :host([variant='neutral']) {
    background: rgba(255, 255, 255, 0.08);
    color: var(--sorye-text-muted, #94a3b8);
  }

  :host([variant='accent']) {
    background: color-mix(in srgb, var(--sorye-accent, #38bdf8) 18%, transparent);
    color: var(--sorye-accent, #38bdf8);
  }

  :host([variant='success']) {
    background: color-mix(in srgb, var(--sorye-success, #34d399) 18%, transparent);
    color: var(--sorye-success, #34d399);
  }

  :host([variant='warning']) {
    background: color-mix(in srgb, var(--sorye-warning, #fbbf24) 18%, transparent);
    color: var(--sorye-warning, #fbbf24);
  }

  :host([variant='danger']) {
    background: color-mix(in srgb, var(--sorye-danger, #f87171) 18%, transparent);
    color: var(--sorye-danger, #f87171);
  }

  .dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: currentColor;
    margin-right: 0.375rem;
    flex-shrink: 0;
  }

  .inner {
    display: inline-flex;
    align-items: center;
  }
`;

export class SoryeBadge extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    variant: { type: String, reflect: true },
    dot: { type: Boolean, reflect: true },
  };

  declare variant: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  declare dot: boolean;

  constructor() {
    super();
    this.variant = 'neutral';
    this.dot = false;
  }

  override render() {
    return html`
      <span class="inner">
        ${this.dot ? html`<span class="dot" aria-hidden="true"></span>` : null}
        <slot></slot>
      </span>
    `;
  }
}

defineElement('sorye-badge', SoryeBadge);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-badge': SoryeBadge;
  }
}
