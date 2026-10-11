import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent, AeliqoInputCommitEvent } from './events.js';

export interface AeliqoSliderValue {
  readonly value: number;
  readonly unit: string;
}

/** Bounded range control with a keyboard-accessible text alternative. */
export class AeliqoSliderElement extends AeliqoFieldElement<AeliqoSliderValue> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    value: { type: Number, reflect: true },
    defaultValue: { attribute: 'default-value', type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    unit: { type: String },
  };

  value = 0;
  defaultValue = 0;
  min = 0;
  max = 100;
  step = 1;
  unit = '';

  override connectedCallback(): void {
    if (this.value === 0 && this.defaultValue !== 0) this.value = this.safeNumber(this.defaultValue, this.min);
    super.connectedCallback();
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: AeliqoSliderValue): boolean {
    return value.value === this.value && value.unit === this.unit;
  }

  protected override resetField(): void {
    this.value = this.safeNumber(this.defaultValue, this.min);
    this.syncNative();
  }

  protected override render() {
    const valid = this.isValid(this.value);
    const describedBy = [this.describedByIds(), this.unit ? 'unit' : ''].filter((id) => id.length > 0).join(' ');
    return html`
      <div part="field">
        <label part="label" for="slider-control"><span class="label-text">${this.label}</span></label>
        <div class="slider-row">
          <input
            part="input"
            id="slider-control"
            type="range"
            name=""
            .value=${String(this.value)}
            min=${String(this.min)}
            max=${String(this.max)}
            step=${String(this.safeStep())}
            ?disabled=${this.fieldDisabled}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            aria-invalid=${this.error || !valid ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @input=${this.handleRange}
            @change=${this.handleCommit}
          />
          <input
            part="text-input"
            type="number"
            .value=${String(this.value)}
            min=${String(this.min)}
            max=${String(this.max)}
            step=${String(this.safeStep())}
            ?disabled=${this.fieldDisabled}
            ?readonly=${this.readOnly}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            aria-label=${this.label ? `${this.label} value` : 'Value'}
            @input=${this.handleText}
            @change=${this.handleCommit}
          />
          ${this.unit ? html`<span id="unit" part="unit">${this.unit}</span>` : nothing}
        </div>
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.nativeRange()?.focus(options);
  }

  private readonly handleRange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled) return;
    if (this.readOnly) {
      this.syncNative();
      return;
    }
    this.applyUserValue(input.value);
  };

  private readonly handleText = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled || this.readOnly) return;
    this.applyUserValue(input.value);
  };

  private readonly handleCommit = (): void => {
    this.dispatchEvent(new AeliqoInputCommitEvent({ source: 'user', value: { value: this.value, unit: this.unit } }));
  };

  private applyUserValue(text: string): void {
    const next = Number(text);
    if (!Number.isFinite(next)) return;
    this.value = next;
    const detail: AeliqoSliderValue = { value: next, unit: this.unit };
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: detail }));
    void this.validateProposed(detail);
    this.syncNative();
  }

  private isValid(value: number): boolean {
    if (!Number.isFinite(value) || !Number.isFinite(this.min) || !Number.isFinite(this.max) || this.min > this.max)
      return false;
    if (value < this.min || value > this.max) return false;
    const step = this.safeStep();
    if (step <= 0) return false;
    const quotient = (value - this.min) / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-9;
  }

  private safeStep(): number {
    return Number.isFinite(this.step) && this.step > 0 ? this.step : 1;
  }

  private safeNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
  }

  private nativeRange(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[type=range]') ?? undefined;
  }

  private syncNative(): void {
    const range = this.nativeRange();
    if (range !== undefined && range.value !== String(this.value)) range.value = String(this.value);
    const valid = this.isValid(this.value);
    this.setFormValue(this.fieldDisabled || !valid ? null : String(this.value));
    if (this.internals !== undefined && !this.fieldDisabled && !valid)
      this.internals.setValidity(
        { rangeOverflow: this.value > this.max, rangeUnderflow: this.value < this.min, stepMismatch: true },
        'Enter a value in range.',
        this.nativeRange(),
      );
    else this.updateValidity(this.nativeRange(), !Number.isFinite(this.value));
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      .slider-row {
        align-items: center;
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        grid-template-columns: minmax(0, 1fr) minmax(5rem, 7rem) auto;
        min-inline-size: 0;
      }
      input[type='range'] {
        accent-color: var(--aeliqo-color-accent, #4338ca);
        min-inline-size: 0;
      }
      input[type='number'] {
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
      }
      @media (max-width: 30rem) {
        .slider-row {
          grid-template-columns: minmax(0, 7rem) auto minmax(0, 1fr);
        }
        input[type='range'] {
          grid-column: 1 / -1;
        }
        input[type='number'] {
          grid-column: 1;
        }
        [part='unit'] {
          grid-column: 2;
        }
      }
    `,
  ];
}
