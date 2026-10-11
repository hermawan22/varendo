import { css, html, noChange, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { AeliqoInputChangeEvent, AeliqoInputCommitEvent } from './events.js';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';

const BLOCKING_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'number',
]);

type FormSubmitter = HTMLButtonElement | HTMLInputElement | null | undefined;

function isQueryRoot(root: Node): root is Document | DocumentFragment {
  if (typeof Document === 'undefined' || typeof DocumentFragment === 'undefined') return false;
  return root instanceof Document || root instanceof DocumentFragment;
}

export type AeliqoTextFieldInputType =
  | 'text'
  | 'search'
  | 'url'
  | 'tel'
  | 'email'
  | 'password'
  | 'date'
  | 'month'
  | 'week'
  | 'time'
  | 'datetime-local'
  | 'number';

/** Shared controlled/uncontrolled, selection and IME implementation. */
export abstract class AeliqoTextControlElement extends AeliqoFieldElement<string> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    inputType: { attribute: 'input-type', type: String },
    placeholder: { type: String },
    maxLength: { attribute: 'max-length', type: Number },
    minLength: { attribute: 'min-length', type: Number },
    pattern: { type: String },
    inputMode: { attribute: 'inputmode', type: String },
    rows: { type: Number },
    spellcheck: { type: Boolean },
  };

  value = '';
  defaultValue = '';
  inputType: AeliqoTextFieldInputType = 'text';
  placeholder = '';
  maxLength = -1;
  minLength = -1;
  pattern = '';
  inputMode = 'text';
  rows = 4;
  spellcheck = true;

  protected abstract readonly multiline: boolean;

  protected get isControlled(): boolean {
    return false;
  }

  private composing = false;
  private lastComposingProposal: string | undefined;
  private suppressTrailingCompositionInput: string | undefined;
  private pendingSelection: { readonly start: number; readonly end: number } | undefined;
  private hydratedDraft: string | undefined;

  constructor() {
    super();
    const prerendered = this.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part=input]');
    if (prerendered !== null && prerendered !== undefined) this.hydratedDraft = prerendered.value;
  }

  override connectedCallback(): void {
    // Declarative shadow roots can be attached after the constructor runs
    // during custom-element upgrade. Capture the live draft once more before
    // Lit schedules its first reconciliation.
    if (this.hydratedDraft === undefined) {
      const prerendered = this.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part=input]');
      if (prerendered !== null && prerendered !== undefined) this.hydratedDraft = prerendered.value;
    }
    if (this.hydratedDraft !== undefined) {
      this.value = this.hydratedDraft;
      this.hydratedDraft = undefined;
    }
    if (this.value.length === 0 && this.defaultValue.length > 0) this.value = this.defaultValue;
    super.connectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('validator')) this.invalidateValidation(false);
    if (changed.has('value')) this.invalidateStaleValidation(this.value, false);
    const existing = this.nativeControl();
    this.captureHydratedValue(existing);
    if (!changed.has('value')) return;
    this.captureSelection(existing);
  }

  private captureHydratedValue(existing: HTMLInputElement | HTMLTextAreaElement | undefined): void {
    if (existing === undefined || this.hasUpdated || this.hydratedDraft !== undefined || existing.value === this.value)
      return;
    this.hydratedDraft = existing.value;
    this.value = existing.value;
  }

  private captureSelection(existing: HTMLInputElement | HTMLTextAreaElement | undefined): void {
    if (existing === undefined || this.shadowRoot?.activeElement !== existing) return;
    const start = existing.selectionStart;
    const end = existing.selectionEnd;
    if (start !== null && end !== null) this.pendingSelection = { start, end };
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (
      changed.has('value') ||
      changed.has('disabled') ||
      changed.has('required') ||
      changed.has('error') ||
      changed.has('readOnly') ||
      changed.has('defaultValue')
    ) {
      this.syncNativeControl();
    }
  }

  protected override resetField(): void {
    this.value = this.defaultValue;
    this.syncNativeControl();
  }

  protected override restoreFormState(value: string): void {
    this.value = value;
    this.syncNativeControl();
  }

  protected override render() {
    const describedBy = this.describedByIds();
    const type = this.safeInputType();
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        ${this.renderControl(describedBy, type)} ${this.renderMessages()}
      </div>
    `;
  }

  private renderControl(describedBy: string, type: AeliqoTextFieldInputType) {
    if (this.multiline) return this.renderTextarea(describedBy);
    return this.renderInput(describedBy, type);
  }

  private renderTextarea(describedBy: string) {
    return html`<textarea
      part="input"
      id="control"
      name=""
      placeholder=${this.placeholder || nothing}
      autocomplete=${this.autocomplete || nothing}
      inputmode=${this.inputMode || nothing}
      maxlength=${this.maxLength >= 0 ? this.maxLength : nothing}
      minlength=${this.minLength >= 0 ? this.minLength : nothing}
      spellcheck=${this.spellcheck ? 'true' : 'false'}
      rows=${this.rows > 0 ? this.rows : 4}
      ?required=${this.required}
      ?disabled=${this.fieldDisabled}
      ?readonly=${this.readOnly}
      aria-readonly=${this.readOnly ? 'true' : nothing}
      aria-invalid=${this.error ? 'true' : nothing}
      aria-describedby=${describedBy || nothing}
      .value=${this.composing ? noChange : this.value}
      @input=${this.handleInput}
      @change=${this.handleCommit}
      @compositionstart=${this.handleCompositionStart}
      @compositionend=${this.handleCompositionEnd}
    ></textarea>`;
  }

  private renderInput(describedBy: string, type: AeliqoTextFieldInputType) {
    return html`<input
      part="input"
      id="control"
      type=${type}
      name=""
      placeholder=${this.placeholder || nothing}
      autocomplete=${this.autocomplete || nothing}
      inputmode=${this.inputMode || nothing}
      maxlength=${this.maxLength >= 0 ? this.maxLength : nothing}
      minlength=${this.minLength >= 0 ? this.minLength : nothing}
      pattern=${this.pattern || nothing}
      spellcheck=${this.spellcheck ? 'true' : 'false'}
      ?required=${this.required}
      ?disabled=${this.fieldDisabled}
      ?readonly=${this.readOnly}
      aria-readonly=${this.readOnly ? 'true' : nothing}
      aria-invalid=${this.error ? 'true' : nothing}
      aria-describedby=${describedBy || nothing}
      .value=${this.composing ? noChange : this.value}
      @input=${this.handleInput}
      @change=${this.handleCommit}
      @keydown=${this.handleKeyDown}
      @compositionstart=${this.handleCompositionStart}
      @compositionend=${this.handleCompositionEnd}
    />`;
  }

  override focus(options?: FocusOptions): void {
    this.nativeControl()?.focus(options);
  }

  private readonly handleInput = (event: Event): void => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) return;
    if (!this.composing && this.suppressTrailingCompositionInput !== undefined) {
      const expected = this.suppressTrailingCompositionInput;
      this.suppressTrailingCompositionInput = undefined;
      if (control.value === expected || control.value === this.value) {
        this.syncNativeControl();
        return;
      }
    }
    if (this.composing) this.lastComposingProposal = control.value;
    if (!this.composing && !this.isControlled) this.value = control.value;
    this.dispatchProposal(control.value);
    if (!this.composing) {
      void this.validateProposed(control.value);
      this.syncNativeControl();
    }
  };

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
    this.lastComposingProposal = undefined;
    this.suppressTrailingCompositionInput = undefined;
  };

  private readonly handleCompositionEnd = (): void => {
    const control = this.nativeControl();
    const finalValue = control?.value;
    const alreadyProposed = finalValue !== undefined && this.lastComposingProposal === finalValue;
    this.composing = false;
    this.lastComposingProposal = undefined;
    if (finalValue !== undefined) {
      this.suppressTrailingCompositionInput = finalValue;
      if (!this.isControlled) this.value = finalValue;
      if (!alreadyProposed) {
        this.dispatchProposal(finalValue);
      }
      // Composition input is only a draft. Validate exactly once after the
      // final composition value is committed, even when the browser already
      // emitted an input event for that same final draft.
      void this.validateProposed(finalValue);
    }
    this.syncNativeControl();
  };

  private readonly handleCommit = (): void => {
    this.dispatchEvent(new AeliqoInputCommitEvent({ source: 'user', value: this.value }));
  };

  private dispatchProposal(value: string): void {
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value }));
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      this.multiline ||
      event.key !== 'Enter' ||
      event.repeat ||
      event.isComposing ||
      this.composing ||
      this.fieldDisabled
    )
      return;
    const form = this.internals?.form;
    if (form === undefined || form === null) return;
    setTimeout(() => {
      if (
        event.defaultPrevented ||
        !this.isConnected ||
        this.internals?.form !== form ||
        this.composing ||
        event.isComposing ||
        this.fieldDisabled
      )
        return;
      const submitter = this.defaultSubmitter(form);
      if (submitter === null || (submitter === undefined && !this.hasSingleBlockingField(form))) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (submitter === undefined) form.requestSubmit();
      else submitter.click();
    }, 0);
  };

  private defaultSubmitter(form: HTMLFormElement): FormSubmitter {
    const root = form.getRootNode();
    if (!isQueryRoot(root)) return undefined;
    for (const control of root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
      const submitter = this.submitterFor(control, form);
      if (submitter !== undefined) return submitter;
    }
    return undefined;
  }

  private submitterFor(control: HTMLButtonElement | HTMLInputElement, form: HTMLFormElement): FormSubmitter {
    if (control.form !== form || !this.isSubmitter(control)) return undefined;
    return control.matches(':disabled') ? null : control;
  }

  private isSubmitter(control: HTMLButtonElement | HTMLInputElement): boolean {
    if (control instanceof HTMLButtonElement) return control.type === 'submit';
    return control.type === 'submit' || control.type === 'image';
  }

  private hasSingleBlockingField(form: HTMLFormElement): boolean {
    let count = 0;
    for (const control of Array.from(form.elements)) {
      if (control.matches(':disabled')) continue;
      if (control instanceof AeliqoTextControlElement) count += 1;
      else if (control instanceof HTMLInputElement && BLOCKING_INPUT_TYPES.has(control.type)) count += 1;
      if (count > 1) return false;
    }
    return true;
  }

  private nativeControl(): HTMLInputElement | HTMLTextAreaElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part=input]');
    return control ?? undefined;
  }

  private syncNativeControl(): void {
    const control = this.nativeControl();
    if (control === undefined) {
      this.setFormValue(this.value);
      return;
    }
    const focused = this.shadowRoot?.activeElement === control;
    const selection = this.pendingSelection ?? { start: control.selectionStart, end: control.selectionEnd };
    if (!this.composing && control.value !== this.value) control.value = this.value;
    control.name = '';
    control.required = this.required;
    control.disabled = this.fieldDisabled;
    control.readOnly = this.readOnly;
    control.setAttribute('autocomplete', this.autocomplete);
    this.setFormValue(this.fieldDisabled ? null : control.value);
    this.updateValidity(control, control.value.length === 0);
    if (focused && selection.start !== null && selection.end !== null)
      control.setSelectionRange(selection.start, selection.end);
    this.pendingSelection = undefined;
  }

  protected override isCurrentValidationValue(value: string): boolean {
    return this.isControlled ? this.value === value : true;
  }

  private safeInputType(): AeliqoTextFieldInputType {
    return BLOCKING_INPUT_TYPES.has(this.inputType) ? this.inputType : 'text';
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      textarea {
        min-block-size: 6rem;
        resize: vertical;
      }
      input::placeholder,
      textarea::placeholder {
        color: var(--aeliqo-color-muted, #4b5563);
        opacity: 1;
      }
    `,
  ];
}
