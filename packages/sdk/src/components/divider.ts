import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: block;
    contain: layout style;
  }

  :host([orientation='horizontal']) hr {
    width: 100%;
    height: 1px;
    border: none;
    margin: 0;
    background: var(--sorye-border, rgba(255, 255, 255, 0.08));
  }

  :host([orientation='vertical']) {
    display: inline-block;
    align-self: stretch;
    width: 1px;
    min-height: 1rem;
    background: var(--sorye-border, rgba(255, 255, 255, 0.08));
  }

  :host([orientation='vertical']) hr {
    display: none;
  }

  .label {
    display: block;
    text-align: center;
    font-size: 0.6875rem;
    color: var(--sorye-text-muted, #94a3b8);
    padding: 0.5rem 0;
  }

  .label:empty {
    display: none;
  }
`;

export class SoryeDivider extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    orientation: { type: String, reflect: true },
  };

  declare orientation: 'horizontal' | 'vertical';

  constructor() {
    super();
    this.orientation = 'horizontal';
  }

  override render() {
    if (this.orientation === 'vertical') {
      return html`<slot></slot>`;
    }

    return html`
      <span class="label"><slot></slot></span>
      <hr role="separator" />
    `;
  }
}

defineElement('sorye-divider', SoryeDivider);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-divider': SoryeDivider;
  }
}
