import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: inline-block;
    width: 1.25rem;
    height: 1.25rem;
    contain: strict;
  }

  .ring {
    width: 100%;
    height: 100%;
    border: 2px solid var(--sorye-accent, #38bdf8);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring {
      animation: none;
      border-right-color: var(--sorye-accent, #38bdf8);
      opacity: 0.5;
    }
  }
`;

export class SoryeSpinner extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    label: { type: String },
  };

  declare label: string;

  constructor() {
    super();
    this.label = 'Loading';
  }

  override render() {
    return html`<div class="ring" role="status" aria-label=${this.label}></div>`;
  }
}

defineElement('sorye-spinner', SoryeSpinner);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-spinner': SoryeSpinner;
  }
}
