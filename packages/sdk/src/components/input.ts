import { css, html } from 'lit';
import { SoryeElement, defineElement, hostStyles } from '../base/sorye-element';

const styles = css`
  :host {
    display: block;
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
    display: flex;
    align-items: center;
    border-radius: var(--sorye-radius-md, 0.75rem);
    border: 1px solid var(--sorye-border, rgba(255, 255, 255, 0.08));
    background: rgba(255, 255, 255, 0.04);
    transition: border-color var(--sorye-transition, 150ms ease);
    contain: layout style;
  }

  .control:focus-within {
    border-color: var(--sorye-accent, #38bdf8);
    box-shadow: var(--sorye-focus-ring);
  }

  :host([invalid]) .control {
    border-color: var(--sorye-danger, #f87171);
  }

  input {
    flex: 1;
    width: 100%;
    border: none;
    background: transparent;
    padding: 0.5rem 0.75rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--sorye-text, #f1f5f9);
    outline: none;
  }

  input::placeholder {
    color: var(--sorye-text-muted, #94a3b8);
    opacity: 0.7;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .prefix,
  .suffix {
    display: flex;
    align-items: center;
    color: var(--sorye-text-muted, #94a3b8);
    font-size: 0.8125rem;
  }

  .prefix {
    padding-left: 0.75rem;
  }

  .prefix:empty {
    display: none;
  }

  .suffix {
    padding-right: 0.75rem;
  }

  .suffix:empty {
    display: none;
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

export class SoryeInput extends SoryeElement {
  static override styles = [hostStyles, styles];

  static properties = {
    label: { type: String },
    name: { type: String },
    placeholder: { type: String },
    type: { type: String },
    hint: { type: String },
    error: { type: String },
    invalid: { type: Boolean, reflect: true },
    disabled: { type: Boolean },
    required: { type: Boolean },
    value: { type: String },
  };

  declare label: string;
  declare name: string;
  declare placeholder: string;
  declare type: string;
  declare hint: string;
  declare error: string;
  declare invalid: boolean;
  declare disabled: boolean;
  declare required: boolean;
  declare value: string;

  private inputId = `sorye-input-${Math.random().toString(36).slice(2, 9)}`;
  private inputEl: HTMLInputElement | null = null;

  constructor() {
    super();
    this.label = '';
    this.name = '';
    this.placeholder = '';
    this.type = 'text';
    this.hint = '';
    this.error = '';
    this.invalid = false;
    this.disabled = false;
    this.required = false;
    this.value = '';
  }

  override firstUpdated() {
    this.inputEl = this.renderRoot.querySelector('input');
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('value') && this.inputEl && this.inputEl.value !== this.value) {
      this.inputEl.value = this.value;
    }
  }

  private onInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.dispatchEvent(
      new CustomEvent('sorye-input', {
        detail: { value: target.value, name: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private onChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
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
          ? html`<label for=${this.inputId}>${this.label}</label>`
          : null}
        <div class="control">
          <span class="prefix"><slot name="prefix"></slot></span>
          <input
            id=${this.inputId}
            name=${this.name}
            type=${this.type}
            placeholder=${this.placeholder}
            ?disabled=${this.disabled}
            ?required=${this.required}
            .value=${this.value}
            @input=${this.onInput}
            @change=${this.onChange}
            aria-invalid=${this.invalid ? 'true' : 'false'}
            aria-describedby=${this.error ? 'err' : this.hint ? 'hint' : undefined}
          />
          <span class="suffix"><slot name="suffix"></slot></span>
        </div>
        <div id="hint" class="hint">${this.hint}</div>
        <div id="err" class="error">${this.error}</div>
      </div>
    `;
  }
}

defineElement('sorye-input', SoryeInput);

declare global {
  interface HTMLElementTagNameMap {
    'sorye-input': SoryeInput;
  }
}
