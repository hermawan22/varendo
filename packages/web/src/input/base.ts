import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { AeliqoValidationEvent, type AeliqoValidationState } from './events.js';

export type AeliqoValidationResult = boolean | string | { readonly valid: boolean; readonly message?: string } | void;

export type AeliqoValidator<T> = (
  value: T,
  signal: AbortSignal,
) => AeliqoValidationResult | Promise<AeliqoValidationResult>;

const VALIDITY_FLAG_KEYS = [
  'badInput',
  'patternMismatch',
  'rangeOverflow',
  'rangeUnderflow',
  'stepMismatch',
  'tooLong',
  'tooShort',
  'typeMismatch',
  'valueMissing',
] as const;

function nativeValidityFlags(validity: ValidityState): ValidityStateFlags {
  const flags: ValidityStateFlags = {};
  for (const key of VALIDITY_FLAG_KEYS) {
    if (validity[key]) flags[key] = true;
  }
  return flags;
}

function nativeValidityMessage(anchor: HTMLElement | undefined): string {
  if (anchor !== undefined && 'validationMessage' in anchor && typeof anchor.validationMessage === 'string')
    return anchor.validationMessage;
  return 'Enter a valid value.';
}

export const aeliqoInputStyles = [
  ...aeliqoFoundationThemeStyles,
  css`
    :host {
      color: var(--aeliqo-input-color, var(--aeliqo-color-text, #111827));
      display: inline-block;
      max-inline-size: 100%;
      min-inline-size: min(100%, 12rem);
      overflow-wrap: anywhere;
    }

    [part='field'] {
      display: grid;
      gap: var(--aeliqo-space-8, 0.5rem);
      min-inline-size: 0;
    }

    [part='label'] {
      display: grid;
      gap: var(--aeliqo-space-4, 0.25rem);
    }

    .label-text {
      font-weight: var(--aeliqo-typography-font-weight-medium, 500);
    }

    [part='description'],
    [part='error'],
    [part='pending'] {
      font-size: var(--aeliqo-typography-font-size-sm, 0.875rem);
      line-height: var(--aeliqo-typography-line-height-normal, 1.5);
    }

    [part='description'] {
      color: var(--aeliqo-input-description, var(--aeliqo-color-muted, #4b5563));
    }

    [part='error'] {
      color: var(--aeliqo-input-error, var(--aeliqo-color-danger, #b91c1c));
    }

    [part='pending'] {
      color: var(--aeliqo-color-muted, #4b5563);
    }

    :is(input, textarea, select, button, [role='combobox']):focus-visible {
      outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-input-focus, var(--aeliqo-color-focus, #4338ca));
      outline-offset: var(--aeliqo-focus-offset, 0.125rem);
      box-shadow: 0 0 0 0.25rem
        color-mix(in srgb, var(--aeliqo-input-focus, var(--aeliqo-color-focus, #4338ca)) 16%, transparent);
    }

    :is(input, textarea, select) {
      background: var(--aeliqo-input-background, var(--aeliqo-color-canvas, #fff));
      border: var(--aeliqo-control-border-width, 0.0625rem) solid
        var(--aeliqo-input-border, var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #64748b)));
      border-radius: var(--aeliqo-radius-medium, 0.625rem);
      box-shadow: var(--aeliqo-elevation-xs, 0 1px 2px rgb(15 23 42 / 0.05));
      box-sizing: border-box;
      color: inherit;
      font: inherit;
      font-size: var(--aeliqo-typography-font-size-sm, 0.875rem);
      inline-size: 100%;
      min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
      min-inline-size: 0;
      padding: var(--aeliqo-space-6, 0.375rem) var(--aeliqo-control-inline-padding, 0.75rem);
    }

    :is(input, textarea, select):not(:disabled):hover:not([aria-invalid='true']) {
      border-color: color-mix(
        in srgb,
        var(--aeliqo-color-accent, #4338ca) 52%,
        var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #64748b))
      );
    }

    :is(input[type='checkbox'], input[type='radio']) {
      box-shadow: none;
      accent-color: var(--aeliqo-color-accent, #4338ca);
      cursor: pointer;
      min-block-size: 0;
      padding: 0;
    }

    :is(input, textarea, select):disabled {
      background: var(--aeliqo-color-surface, #f8fafc);
      color: var(--aeliqo-color-muted, #4b5563);
      cursor: not-allowed;
      opacity: 1;
    }

    :is(input, textarea, select)[aria-invalid='true'] {
      border-color: var(--aeliqo-color-danger, #b91c1c);
    }

    :is(input, textarea, select)[aria-invalid='true']:focus-visible {
      box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--aeliqo-color-danger, #b91c1c) 16%, transparent);
      outline-color: var(--aeliqo-color-danger, #b91c1c);
    }

    input:focus-visible + .switch-track {
      box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--aeliqo-color-focus, #4338ca) 16%, transparent);
      outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-color-focus, #4338ca);
      outline-offset: var(--aeliqo-focus-offset, 0.125rem);
    }

    input:disabled + .switch-track {
      opacity: 0.65;
    }

    input:checked:disabled + .switch-track {
      background: color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 48%, var(--aeliqo-color-surface, #f8fafc));
    }

    input:disabled + .switch-track + .choice-text {
      color: var(--aeliqo-color-muted, #4b5563);
    }

    :is(input, textarea)::placeholder {
      color: var(--aeliqo-color-muted, #4b5563);
      opacity: 0.78;
    }

    @media (forced-colors: active) {
      :is(input, textarea, select)[aria-invalid='true'] {
        border-color: LinkText;
      }
    }
  `,
];

/** Shared native form and validation boundary for every input primitive. */
export abstract class AeliqoFieldElement<T = unknown> extends AeliqoFoundationElement {
  static readonly formAssociated = true;

  static readonly properties = {
    label: { type: String },
    description: { type: String },
    error: { type: String },
    required: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    readOnly: { attribute: 'read-only', type: Boolean, reflect: true },
    name: { type: String, reflect: true },
    autocomplete: { type: String },
    locale: { type: String },
    validationState: { attribute: 'validation-state', type: String, reflect: true },
    validator: { attribute: false },
  };

  label = '';
  description = '';
  error = '';
  required = false;
  disabled = false;
  readOnly = false;
  name = '';
  autocomplete = 'off';
  locale = 'en-US';
  validationState: AeliqoValidationState = 'idle';
  validator: AeliqoValidator<T> | undefined;

  protected formDisabled = false;
  protected readonly internals: ElementInternals | undefined;
  private currentFormValue: string | File | FormData | null = null;
  private validationSequence = 0;
  private validationAbort: AbortController | undefined;
  private validationValidator: AeliqoValidator<T> | undefined;
  private validationValue: T | undefined;
  private hasValidationValue = false;
  /**
   * The last error text written by the validator. An error supplied by the
   * host must survive a value update; matching the text lets invalidation
   * clear only validator-owned state while preserving host state.
   */
  private validationErrorText: string | undefined;
  private validationErrorOwned = false;

  constructor() {
    super();
    this.internals = typeof this.attachInternals === 'function' ? this.attachInternals() : undefined;
  }

  get effectiveDescription(): string {
    return this.description;
  }

  get fieldDisabled(): boolean {
    return this.disabled || this.formDisabled;
  }

  override focus(options?: FocusOptions): void {
    const control = this.renderRoot.querySelector<HTMLElement>('[part=input], [part=control], [role=combobox]');
    control?.focus(options);
  }

  formDisabledCallback(disabled: boolean): void {
    this.formDisabled = disabled;
    // Include a reactive change key so subclasses that synchronize a native
    // control on `disabled` also refresh their form value and validity.
    this.requestUpdate('disabled', !this.disabled);
  }

  formResetCallback(): void {
    this.reset();
  }

  reset(): void {
    this.resetField();
    this.validationAbort?.abort();
    this.validationSequence += 1;
    this.validationAbort = undefined;
    this.hasValidationValue = false;
    this.validationErrorText = undefined;
    this.validationErrorOwned = false;
    this.validationState = 'idle';
    this.error = '';
    this.requestUpdate();
  }

  formStateRestoreCallback(state: File | FormData | string | null): void {
    if (typeof state === 'string') this.restoreFormState(state);
  }

  protected restoreFormState(_value: string): void {}

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (
      changed.has('validator') ||
      (this.validationValue !== undefined && !this.isCurrentValidationValue(this.validationValue))
    )
      this.invalidateValidation(false);
  }

  disconnectedCallback(): void {
    this.validationAbort?.abort();
    this.validationAbort = undefined;
    this.validationSequence += 1;
    this.hasValidationValue = false;
    this.validationErrorText = undefined;
    this.validationErrorOwned = false;
    super.disconnectedCallback();
  }

  protected resetField(): void {}

  protected setFormValue(value: string | File | FormData | null): void {
    this.currentFormValue = value;
    if (this.fieldDisabled) {
      this.internals?.setFormValue(null);
      return;
    }
    this.internals?.setFormValue(value);
  }

  /** Public form boundary used by the compound Form primitive for slotted fields. */
  checkValidity(): boolean {
    return this.internals?.checkValidity() ?? !this.error;
  }

  reportValidity(): boolean {
    return this.internals?.reportValidity() ?? this.checkValidity();
  }

  get validationMessage(): string {
    return this.internals?.validationMessage ?? this.error;
  }

  get formValue(): string | File | FormData | null {
    return this.fieldDisabled ? null : this.currentFormValue;
  }

  /** Native form owner, when the host placed this field in an ordinary form. */
  get formOwner(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }

  protected updateValidity(anchor?: HTMLElement, valueMissing = false): void {
    if (this.internals === undefined) return;
    if (this.fieldDisabled) {
      this.internals.setValidity({});
      return;
    }
    if (this.required && !this.readOnly && valueMissing) {
      this.internals.setValidity({ valueMissing: true }, this.error || 'Enter a value.', anchor);
      return;
    }
    if (this.error.length > 0) {
      this.internals.setValidity({ customError: true }, this.error, anchor);
      return;
    }
    this.setNativeValidity(anchor);
  }

  private setNativeValidity(anchor: HTMLElement | undefined): void {
    if (this.internals === undefined) return;
    const nativeValidity =
      anchor !== undefined && 'validity' in anchor ? (anchor as HTMLInputElement).validity : undefined;
    if (nativeValidity === undefined || nativeValidity.valid) {
      this.internals.setValidity({});
      return;
    }
    const message = nativeValidityMessage(anchor) || 'Enter a valid value.';
    this.internals.setValidity(nativeValidityFlags(nativeValidity), message, anchor);
  }

  protected describedByIds(): string {
    return [
      this.effectiveDescription ? 'description' : '',
      this.error ? 'error' : '',
      this.validationState === 'pending' ? 'pending' : '',
    ]
      .filter((id) => id.length > 0)
      .join(' ');
  }

  protected renderMessages(): TemplateResult {
    const description = this.effectiveDescription;
    return html`
      ${description ? html`<span id="description" part="description" dir="auto">${description}</span>` : nothing}
      ${
        this.validationState === 'pending'
          ? html`<span id="pending" part="pending" role="status" dir="auto">Checking…</span>`
          : nothing
      }
      ${this.error ? html`<span id="error" part="error" role="alert" dir="auto">${this.error}</span>` : nothing}
    `;
  }

  protected async validateProposed(value: T): Promise<void> {
    const validator = this.validator;
    this.validationValidator = validator;
    this.validationAbort?.abort();
    this.validationAbort = undefined;
    this.validationSequence += 1;
    const sequence = this.validationSequence;
    this.validationValue = value;
    this.hasValidationValue = true;
    this.clearOwnedValidationError();
    if (validator === undefined) {
      this.validationState = 'idle';
      this.hasValidationValue = false;
      this.dispatchValidation('idle', '');
      return;
    }
    const controller = new AbortController();
    this.validationAbort = controller;
    this.validationState = 'pending';
    this.validationErrorText = '';
    this.validationErrorOwned = this.error.length === 0;
    this.dispatchValidation('pending', '');
    this.requestUpdate();
    try {
      const result = await validator(value, controller.signal);
      this.completeValidation(value, sequence, controller, result);
    } catch {
      this.failValidation(value, sequence, controller);
    }
  }

  private completeValidation(
    value: T,
    sequence: number,
    controller: AbortController,
    result: AeliqoValidationResult,
  ): void {
    if (!this.isActiveValidation(sequence, controller) || !this.acceptCurrentValidationValue(value)) return;
    const normalized = this.normalizeValidationResult(result);
    this.validationState = normalized.valid ? 'valid' : 'invalid';
    this.setValidatorError(normalized.message);
    this.hasValidationValue = false;
    this.dispatchValidation(this.validationState, this.error);
    this.requestUpdate();
  }

  private failValidation(value: T, sequence: number, controller: AbortController): void {
    if (!this.isActiveValidation(sequence, controller) || !this.acceptCurrentValidationValue(value)) return;
    this.validationState = 'invalid';
    this.setValidatorError('Validation failed.');
    this.hasValidationValue = false;
    this.dispatchValidation('invalid', this.error);
    this.requestUpdate();
  }

  private isActiveValidation(sequence: number, controller: AbortController): boolean {
    return (
      !controller.signal.aborted &&
      sequence === this.validationSequence &&
      this.isConnected &&
      this.validator === this.validationValidator
    );
  }

  private acceptCurrentValidationValue(value: T): boolean {
    if (this.isCurrentValidationValue(value)) return true;
    this.invalidateValidation();
    return false;
  }

  /** Cancel a result that no longer describes the current host value. */
  protected invalidateValidation(schedule = true): void {
    if (
      !this.hasValidationValue &&
      this.validationAbort === undefined &&
      this.validationState === 'idle' &&
      this.validationErrorText === undefined
    )
      return;
    this.validationAbort?.abort();
    this.validationAbort = undefined;
    this.validationSequence += 1;
    this.hasValidationValue = false;
    this.clearOwnedValidationError();
    this.validationState = 'idle';
    if (schedule) this.requestUpdate();
  }

  protected invalidateStaleValidation(value: T, schedule = true): void {
    const hasValidation =
      this.hasValidationValue ||
      this.validationAbort !== undefined ||
      this.validationState !== 'idle' ||
      this.validationErrorText !== undefined;
    if (hasValidation && !Object.is(this.validationValue, value)) this.invalidateValidation(schedule);
  }

  /** Clear a validator message without erasing an independently supplied host error. */
  private clearOwnedValidationError(): void {
    if (this.validationErrorOwned && this.validationErrorText !== undefined && this.error === this.validationErrorText)
      this.error = '';
    this.validationErrorText = undefined;
    this.validationErrorOwned = false;
  }

  /** Apply validator output only while the host has not supplied another error. */
  private setValidatorError(message: string): void {
    if (this.validationErrorOwned && this.error === this.validationErrorText) this.error = message;
    else this.validationErrorOwned = false;
    this.validationErrorText = message;
  }

  protected isCurrentValidationValue(_value: T): boolean {
    return true;
  }

  private normalizeValidationResult(result: AeliqoValidationResult): {
    readonly valid: boolean;
    readonly message: string;
  } {
    if (result === undefined || result === true) return { valid: true, message: '' };
    if (result === false) return { valid: false, message: 'Value is invalid.' };
    if (typeof result === 'string') return { valid: false, message: result };
    return { valid: result.valid, message: result.message ?? (result.valid ? '' : 'Value is invalid.') };
  }

  private dispatchValidation(state: AeliqoValidationState, message: string): void {
    this.dispatchEvent(new AeliqoValidationEvent({ source: 'user', state, message }));
  }
}
