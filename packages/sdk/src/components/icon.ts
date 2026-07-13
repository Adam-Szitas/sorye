import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const PATHS: Record<string, string> = {
  home: 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  apps: 'M4 6a2 2 0 0 1 2-2h3v6H4zm11-2h3a2 2 0 0 1 2 2v4h-5zm-7 6h5v8H7a2 2 0 0 1-2-2zm7 0h5v6a2 2 0 0 1-2 2h-3z',
  link: 'M10 13a5 5 0 0 1 7 0M14 11V7a2 2 0 0 1 4 0v1M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z',
  check: 'M3 8l3.5 3.5L13 5',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
};

const styles = css`
  :host {
    display: inline-block;
    width: 1.25rem;
    height: 1.25rem;
    vertical-align: middle;
    contain: strict;
    color: currentColor;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

export class SoryeIcon extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    name: { type: String, reflect: true },
    size: { type: Number },
  };

  declare name: keyof typeof PATHS;
  declare size: number;

  constructor() {
    super();
    this.name = 'home';
    this.size = 20;
  }

  override render() {
    const path = PATHS[this.name] ?? PATHS.home;
    return html`
      <svg
        viewBox="0 0 24 24"
        width=${this.size}
        height=${this.size}
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d=${path} />
      </svg>
    `;
  }
}

defineElement('sorye-icon', SoryeIcon);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-icon': SoryeIcon;
  }
}
