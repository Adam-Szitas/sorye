import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const styles = css`
  :host {
    display: block;
  }

  :host([compact]) .control select {
    padding-top: 0.35rem;
    padding-bottom: 0.35rem;
    font-size: 0.8125rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  label {
    font-size: 0.75rem;
    color: var(--sorye-text-muted, #94a3b8);
  }

  .control {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--sorye-radius-md, 0.75rem);
    border: 1px solid var(--sorye-border, rgba(255, 255, 255, 0.08));
    background: rgba(255, 255, 255, 0.04);
    transition:
      border-color var(--sorye-transition, 150ms ease),
      box-shadow var(--sorye-transition, 150ms ease);
    contain: layout style;
  }

  .control:focus-within {
    border-color: var(--sorye-accent, #38bdf8);
    box-shadow: var(--sorye-focus-ring);
  }

  :host([invalid]) .control {
    border-color: var(--sorye-danger, #f87171);
  }

  select {
    flex: 1;
    width: 100%;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 0.5rem 2.25rem 0.5rem 0.75rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--sorye-text, #f1f5f9);
    outline: none;
    appearance: none;
    cursor: pointer;
  }

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  select option {
    background: var(--sorye-surface-raised, #121826);
    color: var(--sorye-text, #f1f5f9);
  }

  .chevron {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--sorye-text-muted, #94a3b8);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .chevron svg {
    width: 1rem;
    height: 1rem;
  }

  .hint,
  .error {
    font-size: 0.6875rem;
    min-height: 1rem;
  }

  .hint {
    color: var(--sorye-text-muted, #94a3b8);
  }

  .error {
    color: var(--sorye-danger, #f87171);
  }

  .error:empty,
  .hint:empty {
    display: none;
  }
`;

export class SoryeSelect extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    label: { type: String },
    name: { type: String },
    hint: { type: String },
    error: { type: String },
    invalid: { type: Boolean, reflect: true },
    disabled: { type: Boolean },
    required: { type: Boolean },
    compact: { type: Boolean, reflect: true },
    value: { type: String },
    placeholder: { type: String },
    options: { type: Array },
  };

  declare label: string;
  declare name: string;
  declare hint: string;
  declare error: string;
  declare invalid: boolean;
  declare disabled: boolean;
  declare required: boolean;
  declare compact: boolean;
  declare value: string;
  declare placeholder: string;
  declare options: SelectOption[];

  private selectId = `sorye-select-${Math.random().toString(36).slice(2, 9)}`;

  constructor() {
    super();
    this.label = '';
    this.name = '';
    this.hint = '';
    this.error = '';
    this.invalid = false;
    this.disabled = false;
    this.required = false;
    this.compact = false;
    this.value = '';
    this.placeholder = '';
    this.options = [];
  }

  private onChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    this.value = target.value;
    this.dispatchEvent(
      new CustomEvent('sorye-change', {
        detail: { value: target.value, name: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  };

  override render() {
    return html`
      <div class="field">
        ${this.label
          ? html`<label for=${this.selectId}>${this.label}</label>`
          : null}
        <div class="control">
          <select
            id=${this.selectId}
            name=${this.name}
            ?disabled=${this.disabled}
            ?required=${this.required}
            .value=${this.value}
            @change=${this.onChange}
            aria-invalid=${this.invalid ? 'true' : 'false'}
            aria-label=${this.label || this.placeholder || 'Select'}
          >
            ${this.placeholder
              ? html`<option value="" disabled ?selected=${!this.value}>
                  ${this.placeholder}
                </option>`
              : null}
            ${this.options.map(
              (option) => html`
                <option
                  value=${option.value}
                  ?disabled=${option.disabled ?? false}
                >
                  ${option.label}
                </option>
              `,
            )}
          </select>
          <span class="chevron" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M5 7.5L10 12.5L15 7.5"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
        <div class="hint">${this.hint}</div>
        <div class="error">${this.error}</div>
      </div>
    `;
  }
}

defineElement('sorye-select', SoryeSelect);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-select': SoryeSelect;
  }
}
