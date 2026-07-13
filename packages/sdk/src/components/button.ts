import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: inline-block;
    vertical-align: middle;
  }

  button,
  a.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: 1px solid transparent;
    border-radius: var(--sorye-radius-md, 0.75rem);
    font-family: inherit;
    font-weight: 500;
    line-height: 1.25;
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    transition:
      background-color var(--sorye-transition, 150ms ease),
      border-color var(--sorye-transition, 150ms ease),
      opacity var(--sorye-transition, 150ms ease),
      transform var(--sorye-transition, 150ms ease);
  }

  button:active:not(:disabled),
  a.btn:active {
    transform: scale(0.98);
  }

  button:focus-visible,
  a.btn:focus-visible {
    outline: none;
    box-shadow: var(--sorye-focus-ring);
  }

  button:disabled,
  a.btn[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  :host([size='sm']) button,
  :host([size='sm']) a.btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
  }

  :host([size='md']) button,
  :host([size='md']) a.btn {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
  }

  :host([size='lg']) button,
  :host([size='lg']) a.btn {
    padding: 0.625rem 1.25rem;
    font-size: 0.9375rem;
  }

  :host([variant='primary']) button,
  :host([variant='primary']) a.btn {
    background: var(--sorye-accent, #38bdf8);
    color: var(--sorye-surface, #0b0f17);
  }

  :host([variant='primary']) button:hover:not(:disabled),
  :host([variant='primary']) a.btn:hover {
    background: var(--sorye-accent-hover, #7dd3fc);
  }

  :host([variant='secondary']) button,
  :host([variant='secondary']) a.btn {
    background: var(--sorye-surface-raised, #121826);
    border-color: var(--sorye-border, rgba(255, 255, 255, 0.08));
    color: var(--sorye-text, #f1f5f9);
  }

  :host([variant='secondary']) button:hover:not(:disabled),
  :host([variant='secondary']) a.btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  :host([variant='ghost']) button,
  :host([variant='ghost']) a.btn {
    background: transparent;
    color: var(--sorye-text-muted, #94a3b8);
  }

  :host([variant='ghost']) button:hover:not(:disabled),
  :host([variant='ghost']) a.btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--sorye-text, #f1f5f9);
  }

  :host([variant='danger']) button,
  :host([variant='danger']) a.btn {
    background: rgba(248, 113, 113, 0.15);
    color: var(--sorye-danger, #f87171);
  }

  :host([variant='danger']) button:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.25);
  }

  .spinner {
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-right-color: currentColor;
      opacity: 0.6;
    }
  }

  .slot-wrap {
    display: contents;
  }

  .slot-wrap[hidden] {
    display: none;
  }
`;

export class SoryeButton extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    variant: { type: String, reflect: true },
    size: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    loading: { type: Boolean, reflect: true },
    href: { type: String },
    type: { type: String },
  };

  declare variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  declare size: 'sm' | 'md' | 'lg';
  declare disabled: boolean;
  declare loading: boolean;
  declare href: string;
  declare type: 'button' | 'submit' | 'reset';

  constructor() {
    super();
    this.variant = 'primary';
    this.size = 'md';
    this.disabled = false;
    this.loading = false;
    this.href = '';
    this.type = 'button';
  }

  private renderInner() {
    return html`
      ${this.loading
        ? html`<span class="spinner" aria-hidden="true"></span>`
        : null}
      <span class="slot-wrap" ?hidden=${this.loading}><slot></slot></span>
    `;
  }

  override render() {
    if (this.href) {
      return html`
        <a
          class="btn"
          href=${this.disabled ? undefined : this.href}
          aria-disabled=${this.disabled || this.loading ? 'true' : 'false'}
          tabindex=${this.disabled ? -1 : 0}
        >
          ${this.renderInner()}
        </a>
      `;
    }

    return html`
      <button
        type=${this.type}
        ?disabled=${this.disabled || this.loading}
        aria-busy=${this.loading ? 'true' : 'false'}
      >
        ${this.renderInner()}
      </button>
    `;
  }
}

defineElement('sorye-button', SoryeButton);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-button': SoryeButton;
  }
}
