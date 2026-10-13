import { css, html, nothing } from 'lit';
import { VarendoFieldElement, varendoInputStyles } from './base.js';
import { VarendoInputChangeEvent } from './events.js';

/** Native checkbox with explicit indeterminate and submitted-value semantics. */
export class VarendoCheckboxElement extends VarendoFieldElement<boolean> {
  static readonly properties = {
    ...VarendoFieldElement.properties,
    checked: { type: Boolean, reflect: true },
    defaultChecked: { attribute: 'default-checked', type: Boolean },
    indeterminate: { type: Boolean, reflect: true },
    value: { type: String },
  };

  checked = false;
  defaultChecked = false;
  indeterminate = false;
  value = 'on';

  override connectedCallback(): void {
    if (!this.checked && this.defaultChecked) this.checked = true;
    super.connectedCallback();
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: boolean): boolean {
    return value === this.checked;
  }

  protected override resetField(): void {
    this.checked = this.defaultChecked;
    this.indeterminate = false;
    this.syncNative();
  }

  protected override render() {
    const describedBy = this.describedByIds();
    return html`
      <div part="field">
        <label part="label" class="choice-label">
          <input
            part="input"
            type="checkbox"
            name=""
            .checked=${this.checked}
            .indeterminate=${this.indeterminate}
            ?disabled=${this.fieldDisabled}
            ?required=${this.required}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            aria-checked=${this.indeterminate ? 'mixed' : String(this.checked)}
            aria-invalid=${this.error ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @change=${this.handleChange}
          />
          <span class="choice-text">${this.label}</span>
        </label>
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  protected readonly handleChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (this.readOnly || this.fieldDisabled) {
      this.syncNative();
      return;
    }
    this.checked = input.checked;
    this.indeterminate = false;
    this.dispatchEvent(new VarendoInputChangeEvent({ source: 'user', value: this.checked }));
    void this.validateProposed(this.checked);
    this.syncNative();
  };

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const input = this.native();
    if (input === undefined) {
      this.setFormValue(this.checked ? this.value : null);
      return;
    }
    input.name = '';
    input.checked = this.checked;
    input.indeterminate = this.indeterminate;
    input.disabled = this.fieldDisabled;
    input.required = this.required;
    this.setFormValue(this.fieldDisabled || !this.checked ? null : this.value);
    this.updateValidity(input, !this.checked);
  }

  static readonly styles = [
    ...varendoInputStyles,
    css`
      .choice-label {
        align-items: center;
        display: inline-flex;
        gap: var(--varendo-space-8, 0.5rem);
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-min-target, 2.75rem));
      }
      input {
        accent-color: var(--varendo-color-accent, #4338ca);
        block-size: 1.25rem;
        inline-size: 1.25rem;
      }
    `,
  ];
}
