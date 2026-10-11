import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent, AeliqoInputCommitEvent } from './events.js';
import { compareDateOnly, dateOnly } from './locale.js';

export type AeliqoRangeBoundary = 'inclusive' | 'exclusive';

export interface AeliqoDateRangeValue {
  readonly start: string;
  readonly end: string;
  readonly boundary: AeliqoRangeBoundary;
  readonly timezone: 'calendar';
  readonly calendar: 'gregory';
  readonly valid: boolean;
}

/** Two calendar dates with explicit boundary and calendar semantics. */
export class AeliqoDateRangeElement extends AeliqoFieldElement<AeliqoDateRangeValue> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    start: { type: String, reflect: true },
    end: { type: String, reflect: true },
    defaultStart: { attribute: 'default-start', type: String },
    defaultEnd: { attribute: 'default-end', type: String },
    boundary: { type: String },
    timezone: { type: String },
    calendar: { type: String },
  };

  start = '';
  end = '';
  defaultStart = '';
  defaultEnd = '';
  boundary: AeliqoRangeBoundary = 'inclusive';
  timezone = 'calendar' as const;
  calendar = 'gregory' as const;

  override connectedCallback(): void {
    if (this.start.length === 0 && this.defaultStart.length > 0) this.start = dateOnly(this.defaultStart) ?? '';
    if (this.end.length === 0 && this.defaultEnd.length > 0) this.end = dateOnly(this.defaultEnd) ?? '';
    super.connectedCallback();
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: AeliqoDateRangeValue): boolean {
    const current = this.rangeValue();
    return (
      value.start === current.start &&
      value.end === current.end &&
      value.boundary === current.boundary &&
      value.timezone === current.timezone &&
      value.calendar === current.calendar &&
      value.valid === current.valid
    );
  }

  protected override resetField(): void {
    this.start = dateOnly(this.defaultStart) ?? '';
    this.end = dateOnly(this.defaultEnd) ?? '';
    this.syncNative();
  }

  protected override render() {
    const valid = this.isValid();
    const describedBy = this.describedByIds();
    return html`
      <fieldset part="field" ?disabled=${this.fieldDisabled} aria-invalid=${!this.error && valid ? nothing : 'true'}>
        <legend part="label">${this.label}</legend>
        <div class="range-inputs">
          <label part="start-label"
            >Start
            <input
              part="input start"
              class="start"
              type="date"
              name=""
              .value=${dateOnly(this.start) ?? ''}
              ?disabled=${this.fieldDisabled}
              ?readonly=${this.readOnly}
              aria-readonly=${this.readOnly ? 'true' : nothing}
              aria-describedby=${describedBy || nothing}
              @input=${this.handleStart}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label part="end-label"
            >End
            <input
              part="input end"
              class="end"
              type="date"
              name=""
              .value=${dateOnly(this.end) ?? ''}
              ?disabled=${this.fieldDisabled}
              ?readonly=${this.readOnly}
              aria-readonly=${this.readOnly ? 'true' : nothing}
              aria-describedby=${describedBy || nothing}
              @input=${this.handleEnd}
              @change=${this.handleCommit}
            />
          </label>
        </div>
        <span class="policy" part="policy"
          >${this.boundary === 'inclusive' ? 'Inclusive range' : 'Exclusive range'}; calendar dates</span
        >
        ${!valid && this.valueMissingMessage() ? html`<span part="error" id="error" role="alert">${this.valueMissingMessage()}</span>` : nothing}
        ${this.renderMessages()}
      </fieldset>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.nativeStart()?.focus(options);
  }

  private readonly handleStart = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled) return;
    if (this.readOnly) {
      this.syncNative();
      return;
    }
    this.start = dateOnly(input.value) ?? input.value;
    this.emitChange();
  };

  private readonly handleEnd = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled) return;
    if (this.readOnly) {
      this.syncNative();
      return;
    }
    this.end = dateOnly(input.value) ?? input.value;
    this.emitChange();
  };

  private readonly handleCommit = (): void => {
    this.dispatchEvent(new AeliqoInputCommitEvent({ source: 'user', value: this.rangeValue() }));
  };

  private emitChange(): void {
    const value = this.rangeValue();
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value }));
    void this.validateProposed(value);
    this.syncNative();
  }

  private rangeValue(): AeliqoDateRangeValue {
    return {
      start: this.start,
      end: this.end,
      boundary: this.boundary,
      timezone: this.timezone,
      calendar: this.calendar,
      valid: this.isValid(),
    };
  }

  private isValid(): boolean {
    const start = dateOnly(this.start);
    const end = dateOnly(this.end);
    if (start === undefined || end === undefined) return this.start.length === 0 && this.end.length === 0;
    const comparison = compareDateOnly(start, end);
    return this.boundary === 'inclusive' ? comparison <= 0 : comparison < 0;
  }

  private valueMissingMessage(): string {
    if (this.required && (this.start.length === 0 || this.end.length === 0)) return 'Enter both dates.';
    if (!this.isValid() && this.start && this.end)
      return this.boundary === 'inclusive' ? 'Start must be on or before end.' : 'Start must be before end.';
    return '';
  }

  private syncNative(): void {
    const valid = this.isValid();
    const start = dateOnly(this.start);
    const end = dateOnly(this.end);
    const missing = this.required && (start === undefined || end === undefined);
    this.syncFormValue(valid, start, end, missing);
    this.syncAriaInvalid(valid, missing);
    this.syncValidity(valid, missing);
  }

  private syncFormValue(valid: boolean, start: string | undefined, end: string | undefined, missing: boolean): void {
    if (this.fieldDisabled || !valid || missing) {
      this.setFormValue(null);
      return;
    }
    if (!this.name || start === undefined || end === undefined) {
      this.setFormValue(null);
      return;
    }
    const data = new FormData();
    data.append(`${this.name}[start]`, start);
    data.append(`${this.name}[end]`, end);
    this.setFormValue(data);
  }

  private syncAriaInvalid(valid: boolean, missing: boolean): void {
    if ((!this.error && valid && !missing) || this.fieldDisabled) this.removeAttribute('aria-invalid');
    else this.setAttribute('aria-invalid', 'true');
  }

  private syncValidity(valid: boolean, missing: boolean): void {
    const anchor = this.nativeStart();
    if (this.internals !== undefined && !this.fieldDisabled && !valid)
      this.internals.setValidity(
        { customError: true },
        this.valueMissingMessage() || 'Enter a valid date range.',
        anchor,
      );
    else this.updateValidity(anchor, missing);
  }

  private nativeStart(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input.start') ?? undefined;
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      :host {
        container-type: inline-size;
      }
      fieldset {
        border: 0;
        display: grid;
        gap: var(--aeliqo-space-4, 0.25rem);
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }
      legend {
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
      .range-inputs {
        align-items: end;
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      }
      .range-inputs label {
        display: grid;
        gap: var(--aeliqo-space-4, 0.25rem);
      }
      @container (max-width: 28rem) {
        .range-inputs {
          grid-template-columns: minmax(0, 1fr);
        }
        .range-inputs > span {
          display: none;
        }
      }
      .policy {
        color: var(--aeliqo-color-muted, #4b5563);
        font-size: 0.9em;
      }
    `,
  ];
}
