import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: block;
    border-radius: var(--sorye-radius-lg, 1rem);
    border: 1px solid var(--sorye-border, rgba(255, 255, 255, 0.08));
    background: var(--sorye-surface-raised, #121826);
    contain: layout style paint;
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }

  :host([padding='none']) .body {
    padding: 0;
  }

  :host([padding='sm']) .body {
    padding: 0.75rem;
  }

  :host([padding='md']) .body {
    padding: 1rem;
  }

  :host([padding='lg']) .body {
    padding: 1.25rem;
  }

  .header {
    padding: 1rem 1rem 0;
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .header:empty {
    display: none;
  }

  .footer {
    padding: 0 1rem 1rem;
    font-size: 0.8125rem;
    color: var(--sorye-text-muted, #94a3b8);
  }

  .footer:empty {
    display: none;
  }

  .body {
    padding: 1rem;
  }
`;

export class SoryeCard extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    padding: { type: String, reflect: true },
  };

  declare padding: 'none' | 'sm' | 'md' | 'lg';

  constructor() {
    super();
    this.padding = 'md';
  }

  override render() {
    return html`
      <div class="header"><slot name="header"></slot></div>
      <div class="body"><slot></slot></div>
      <div class="footer"><slot name="footer"></slot></div>
    `;
  }
}

defineElement('sorye-card', SoryeCard);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-card': SoryeCard;
  }
}
