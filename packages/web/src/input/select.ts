import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent } from './events.js';
import type { AeliqoOption } from './options.js';
import { validOptions } from './options.js';

/** Bounded native select; empty and unknown values stay distinguishable. */
export class AeliqoSelectElement extends AeliqoFieldElement<string> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    options: { attribute: false },
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    emptyLabel: { attribute: 'empty-label', type: String },
    unknownLabel: { attribute: 'unknown-label', type: String },
  };

  options: readonly AeliqoOption[] = [];
  value = '';
  defaultValue = '';
  emptyLabel = 'Select an option';
  unknownLabel = 'Unknown option';

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
    const known = options.some((option) => option.value === this.value);
    const describedBy = this.describedByIds();
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        <div class="select-wrap">
          <select
            part="input"
            id="control"
            name=""
            .value=${this.value}
            ?disabled=${this.fieldDisabled}
            ?required=${this.required}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            autocomplete=${this.autocomplete || nothing}
            aria-invalid=${this.error || (!known && this.value) ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @change=${this.handleChange}
          >
            <option value="">${this.emptyLabel}</option>
            ${
              !known && this.value
                ? html`<option value=${this.value}>${this.unknownLabel}: ${this.value}</option>`
                : nothing
            }
            ${options.map(
              (option) =>
                html`<option value=${option.value} ?disabled=${option.disabled === true}>${option.label}</option>`,
            )}
          </select>
          <svg class="select-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  private readonly handleChange = (event: Event): void => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (this.readOnly || this.fieldDisabled) {
      this.syncNative();
      return;
    }
    this.value = select.value;
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: this.value }));
    void this.validateProposed(this.value);
    this.syncNative();
  };

  private native(): HTMLSelectElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLSelectElement>('select[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const native = this.native();
    if (native !== undefined && native.value !== this.value) native.value = this.value;
    const valid = validOptions(this.options);
    const option = valid ? this.options.find((candidate) => candidate.value === this.value) : undefined;
    const unknown = this.value.length > 0 && option === undefined;
    this.setFormValue(this.fieldDisabled ? null : this.value);
    if (this.internals !== undefined && !this.fieldDisabled && unknown)
      this.internals.setValidity({ customError: true }, 'Choose a supported option.', native);
    else this.updateValidity(native, this.value.length === 0);
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      .select-wrap {
        min-inline-size: 0;
        position: relative;
      }

      /* Native appearance ignores padding in some engines; draw our own chevron. */
      select {
        appearance: none;
        overflow: hidden;
        padding-inline-end: calc(var(--aeliqo-control-inline-padding, 0.75rem) + 1.5rem);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      select:has(> option[value='']:checked) {
        color: var(--aeliqo-color-muted, #4b5563);
      }

      .select-chevron {
        block-size: 1rem;
        color: var(--aeliqo-color-muted, #4b5563);
        inline-size: 1rem;
        inset-block-start: 50%;
        inset-inline-end: var(--aeliqo-control-inline-padding, 0.75rem);
        pointer-events: none;
        position: absolute;
        transform: translateY(-50%);
      }

      /* The sibling chevron does not share the select's disabled opacity. */
      select:disabled + .select-chevron {
        opacity: 0.55;
      }

      @media (forced-colors: active) {
        select {
          appearance: auto;
          padding-inline-end: var(--aeliqo-control-inline-padding, 0.75rem);
        }

        .select-chevron {
          display: none;
        }
      }
    `,
  ];
}
