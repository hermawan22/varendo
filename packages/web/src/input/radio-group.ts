import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent } from './events.js';
import type { AeliqoOption } from './options.js';
import { validOptions } from './options.js';

/** Native radio group with stable option identities and one form value. */
export class AeliqoRadioGroupElement extends AeliqoFieldElement<string> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    options: { attribute: false },
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    orientation: { type: String },
  };

  options: readonly AeliqoOption[] = [];
  value = '';
  defaultValue = '';
  orientation: 'horizontal' | 'vertical' = 'vertical';

  override connectedCallback(): void {
    if (this.value.length === 0 && this.defaultValue.length > 0) this.value = this.defaultValue;
    super.connectedCallback();
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: string): boolean {
    return value === this.value;
  }

  protected override resetField(): void {
    this.value = this.defaultValue;
    this.syncNative();
  }

  protected override render() {
    const options = validOptions(this.options) ? this.options : [];
    const describedBy = this.describedByIds();
    return html`
      <fieldset
        part="field"
        class=${this.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
        ?disabled=${this.fieldDisabled}
      >
        <legend part="label">${this.label}</legend>
        ${options.map(
          (option) => html`
            <label part="option" class=${option.disabled ? 'disabled' : ''}>
              <input
                part="input"
                type="radio"
                name="aeliqo-radio-group"
                value=${option.value}
                .checked=${this.value === option.value}
                ?disabled=${this.fieldDisabled || option.disabled === true}
                aria-readonly=${this.readOnly ? 'true' : nothing}
                aria-invalid=${this.error ? 'true' : nothing}
                aria-describedby=${describedBy || nothing}
                @change=${this.handleChange}
              />
              <span>${option.label}</span>
            </label>
          `,
        )}
        ${this.renderMessages()}
      </fieldset>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  private readonly handleChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.readOnly || this.fieldDisabled) {
      this.syncNative();
      return;
    }
    this.value = input.value;
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: this.value }));
    void this.validateProposed(this.value);
    this.syncNative();
  };

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const inputs = this.renderRoot?.querySelectorAll<HTMLInputElement>('input[type=radio]');
    inputs?.forEach((input) => {
      input.checked = input.value === this.value;
    });
    const selected =
      validOptions(this.options) &&
      this.options.some((option) => option.value === this.value && option.disabled !== true);
    this.setFormValue(this.fieldDisabled || !selected ? null : this.value);
    this.updateValidity(this.native(), this.value.length === 0 || !selected);
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      fieldset {
        border: 0;
        display: flex;
        gap: var(--aeliqo-space-8, 0.5rem);
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }
      fieldset.vertical {
        flex-direction: column;
      }
      fieldset.horizontal {
        flex-direction: row;
        flex-wrap: wrap;
      }
      legend {
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        margin-block-end: var(--aeliqo-space-4, 0.25rem);
      }
      [part='option'] {
        align-items: center;
        display: inline-flex;
        gap: var(--aeliqo-space-8, 0.5rem);
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
      }
      [part='option'].disabled {
        color: var(--aeliqo-color-muted, #4b5563);
      }
      input {
        accent-color: var(--aeliqo-color-accent, #4338ca);
        block-size: 1.25rem;
        inline-size: 1.25rem;
      }
    `,
  ];
}
