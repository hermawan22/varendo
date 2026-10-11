import { html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent, AeliqoInputCommitEvent } from './events.js';
import { compareDateOnly, dateOnly } from './locale.js';

export type AeliqoDateCalendar = 'gregory';

/** Calendar-date input. Values are YYYY-MM-DD strings and never timestamps. */
export class AeliqoDateFieldElement extends AeliqoFieldElement<string> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    min: { type: String },
    max: { type: String },
    calendar: { type: String },
  };

  value = '';
  defaultValue = '';
  min = '';
  max = '';
  calendar: AeliqoDateCalendar = 'gregory';

  override connectedCallback(): void {
    if (this.value.length === 0 && this.defaultValue.length > 0) this.value = dateOnly(this.defaultValue) ?? '';
    super.connectedCallback();
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: string): boolean {
    return value === this.value;
  }

  protected override resetField(): void {
    this.value = dateOnly(this.defaultValue) ?? '';
    this.syncNative();
  }

  protected override render() {
    const parsed = dateOnly(this.value);
    const valid = this.isValid(parsed);
    const describedBy = this.describedByIds();
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        <input
          part="input"
          id="control"
          type="date"
          name=""
          .value=${parsed ?? this.value}
          min=${dateOnly(this.min) ?? nothing}
          max=${dateOnly(this.max) ?? nothing}
          ?disabled=${this.fieldDisabled}
          ?readonly=${this.readOnly}
          aria-readonly=${this.readOnly ? 'true' : nothing}
          aria-invalid=${this.error || !valid ? 'true' : nothing}
          aria-describedby=${describedBy || nothing}
          @input=${this.handleInput}
          @change=${this.handleCommit}
        />
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  private readonly handleInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled) return;
    if (this.readOnly) {
      this.syncNative();
      return;
    }
    const next = dateOnly(input.value) ?? input.value;
    this.value = next;
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: next }));
    void this.validateProposed(next);
    this.syncNative();
  };

  private readonly handleCommit = (): void => {
    this.dispatchEvent(new AeliqoInputCommitEvent({ source: 'user', value: this.value }));
  };

  private isValid(value: string | undefined): boolean {
    if (value === undefined) return this.value.trim().length === 0;
    if (this.min && compareDateOnly(value, dateOnly(this.min)) < 0) return false;
    if (this.max && compareDateOnly(value, dateOnly(this.max)) > 0) return false;
    return true;
  }

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const valid = this.isValid(dateOnly(this.value));
    this.setFormValue(this.fieldDisabled || !valid ? null : this.value);
    if (this.internals !== undefined && !this.fieldDisabled && !valid)
      this.internals.setValidity({ customError: true }, 'Enter a valid date.', this.native());
    else this.updateValidity(this.native(), this.value.length === 0);
  }

  static readonly styles = aeliqoInputStyles;
}
