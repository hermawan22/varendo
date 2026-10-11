import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoInputChangeEvent, AeliqoInputCommitEvent } from './events.js';
import { formatLocalizedDecimal, parseLocalizedDecimal } from './locale.js';

export interface AeliqoNumberChange {
  readonly text: string;
  readonly value: string | undefined;
  readonly valid: boolean;
}

function decimalParts(value: string): { negative: boolean; integer: string; fraction: string } {
  const unsigned = value.replace(/^[+-]/u, '');
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const negative = value.startsWith('-') && /[1-9]/u.test(`${integer}${fraction}`);
  return { negative, integer: integer.replace(/^0+(?=\d)/u, ''), fraction };
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const sign = a.negative ? -1 : 1;
  if (a.integer.length !== b.integer.length) return (a.integer.length < b.integer.length ? -1 : 1) * sign;
  if (a.integer !== b.integer) return (a.integer < b.integer ? -1 : 1) * sign;
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(scale, '0');
  const bf = b.fraction.padEnd(scale, '0');
  if (af === bf) return 0;
  return (af < bf ? -1 : 1) * sign;
}

function stepAligned(value: string, minimum: string | undefined, step: string | undefined): boolean {
  if (step === undefined || step === '') return true;
  const valueParts = decimalParts(value);
  const stepParts = decimalParts(step);
  const minParts = decimalParts(minimum ?? '0');
  const scale = Math.max(valueParts.fraction.length, stepParts.fraction.length, minParts.fraction.length);
  const scaleValue = (parts: ReturnType<typeof decimalParts>): bigint => {
    const digits = `${parts.integer}${parts.fraction.padEnd(scale, '0')}`;
    const integer = BigInt(digits || '0');
    return parts.negative ? -integer : integer;
  };
  const divisor = scaleValue(stepParts);
  if (divisor <= 0n) return false;
  return (scaleValue(valueParts) - scaleValue(minParts)) % divisor === 0n;
}

/** Locale-aware decimal editing whose exact canonical value remains a string. */
export class AeliqoNumberFieldElement extends AeliqoFieldElement<AeliqoNumberChange> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    text: { type: String },
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    min: { type: String },
    max: { type: String },
    step: { type: String },
    unit: { type: String },
  };

  text = '';
  value: string | undefined;
  defaultValue = '';
  min = '';
  max = '';
  step = '';
  unit = '';

  override connectedCallback(): void {
    if (this.value === undefined && this.defaultValue.length > 0) this.applyDefaultValue();
    super.connectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('value') && this.value !== undefined && (this.text.length === 0 || !changed.has('text'))) {
      this.text = formatLocalizedDecimal(this.value, this.locale);
    }
    super.willUpdate(changed);
  }

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: AeliqoNumberChange): boolean {
    const current = this.numberValue();
    return (
      value.value === this.value &&
      value.text === current.text &&
      value.value === current.value &&
      value.valid === current.valid
    );
  }

  protected override resetField(): void {
    this.applyDefaultValue();
    this.syncNative();
  }

  private applyDefaultValue(): void {
    const parsed = parseLocalizedDecimal(this.defaultValue, 'en-US');
    this.value = parsed.valid ? parsed.canonical : undefined;
    this.text =
      parsed.valid && parsed.canonical !== undefined
        ? formatLocalizedDecimal(parsed.canonical, this.locale)
        : this.defaultValue;
  }

  protected override render() {
    const parsed = parseLocalizedDecimal(this.text, this.locale);
    const valid = this.isValid(parsed.canonical);
    const describedBy = [this.describedByIds(), this.unit ? 'unit' : ''].filter((id) => id.length > 0).join(' ');
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        <div class="input-wrap">
          <input
            part="input"
            id="control"
            type="text"
            name=""
            inputmode="decimal"
            autocomplete=${this.autocomplete || nothing}
            .value=${this.text}
            ?disabled=${this.fieldDisabled}
            ?readonly=${this.readOnly}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            aria-invalid=${this.error || !valid ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @input=${this.handleInput}
            @change=${this.handleCommit}
          />
          ${this.unit ? html`<span id="unit" part="unit">${this.unit}</span>` : nothing}
        </div>
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  private readonly handleInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.readOnly || this.fieldDisabled) return;
    this.text = input.value;
    const detail = this.numberValue();
    this.value = detail.value;
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: detail }));
    void this.validateProposed(detail);
    this.syncNative();
  };

  private readonly handleCommit = (): void => {
    this.dispatchEvent(new AeliqoInputCommitEvent({ source: 'user', value: this.numberValue() }));
  };

  private numberValue(): AeliqoNumberChange {
    const parsed = parseLocalizedDecimal(this.text, this.locale);
    const valid = this.isValid(parsed.canonical);
    return { text: this.text, value: valid ? parsed.canonical : undefined, valid };
  }

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private isValid(value: string | undefined): boolean {
    if (value === undefined) return this.text.trim().length === 0;
    const minimum = this.canonicalBound(this.min);
    const maximum = this.canonicalBound(this.max);
    const step = this.canonicalBound(this.step);
    if (minimum === null || maximum === null || step === null) return false;
    if (minimum !== undefined && compareDecimal(value, minimum) < 0) return false;
    if (maximum !== undefined && compareDecimal(value, maximum) > 0) return false;
    return stepAligned(value, minimum, step);
  }

  private canonicalBound(text: string): string | undefined | null {
    if (text.trim().length === 0) return undefined;
    const parsed = parseLocalizedDecimal(text, 'en-US');
    return parsed.valid ? parsed.canonical : null;
  }

  private syncNative(): void {
    const parsed = parseLocalizedDecimal(this.text, this.locale);
    const valid = this.isValid(parsed.canonical);
    this.setFormValue(this.fieldDisabled ? null : (this.value ?? this.text));
    if (this.internals !== undefined && !this.fieldDisabled && !valid)
      this.internals.setValidity({ customError: true }, 'Enter a valid number.', this.native());
    else this.updateValidity(this.native(), this.text.trim().length === 0);
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      .input-wrap {
        align-items: center;
        display: flex;
        gap: var(--aeliqo-space-8, 0.5rem);
      }
      .input-wrap input {
        flex: 1 1 auto;
        min-inline-size: 0;
      }
      [part='unit'] {
        flex: 0 0 auto;
        white-space: nowrap;
        color: var(--aeliqo-color-muted, #4b5563);
      }
    `,
  ];
}
