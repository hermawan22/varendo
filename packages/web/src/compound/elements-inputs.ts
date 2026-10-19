import { css, html, nothing, type PropertyValues } from 'lit';
import type { VersionRef } from '@varendo/core';
import { VarendoCompoundElement, varendoCompoundThemeStyles } from './base.js';
import type {
  VarendoCompoundStatus,
  VarendoFormFlowCommitDetail,
  VarendoFormFlowStep,
  VarendoFormFlowStepDetail,
  VarendoRecordEditorCancelDetail,
  VarendoRecordEditorSaveDetail,
  VarendoQualityState,
} from './types.js';
import { VarendoFormElement } from '../input/form.js';
import {
  appendDraftValue,
  collectCompoundValues,
  compoundControls,
  dateRangeParts,
  event,
  type FormDraftRecord,
  type FormDraftValue,
  isDisabledControl,
  nullRecord,
  reportCompoundValidity,
  status,
  type CompoundControl,
} from './shared.js';

const BUTTON_INPUT_TYPES: ReadonlySet<string> = new Set(['submit', 'reset', 'button', 'image']);

export class VarendoRecordEditorElement extends VarendoCompoundElement {
  static readonly properties = {
    entity: { type: String },
    entityKey: { attribute: 'entity-key', type: String },
    entityRevision: { attribute: 'entity-revision', type: String },
    action: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    disabled: { type: Boolean },
    invalid: { type: Boolean },
    saveLabel: { attribute: 'save-label', type: String },
    cancelLabel: { attribute: 'cancel-label', type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='form'] {
        display: grid;
        gap: var(--varendo-space-12, 0.75rem);
      }
    `,
  ];
  entity = 'record';
  entityKey = '';
  entityRevision = '';
  action: VersionRef | undefined;
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Edit record';
  disabled = false;
  invalid = false;
  saveLabel = 'Save';
  cancelLabel = 'Cancel';
  protected override render() {
    const current = status(this.status);
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        <span part="meta"
          >${this.entity}
          ${this.entityKey ? `· ${this.entityKey}` : ''}${this.entityRevision ? ` · revision ${this.entityRevision}` : ''}</span
        >
      </div>
      <varendo-form part="form" label=${this.title}>
        <slot></slot>
        <div part="actions">
          <button type="button" ?disabled=${this.disabled} @click=${this.cancel}>${this.cancelLabel}</button
          ><button type="button" ?disabled=${this.disabled || this.invalid} @click=${this.save}>
            ${this.saveLabel}
          </button>
        </div>
      </varendo-form>
      ${this.message || current !== 'ready' ? html`<p part="status" role="status">${this.statusText(current, this.message)}</p>` : nothing}
    </section>`;
  }
  private readonly save = (): void => {
    if (this.disabled || this.invalid || !this.entityKey || !this.entityRevision) return;
    const form = this.renderRoot.querySelector('varendo-form');
    const formValid = form instanceof VarendoFormElement ? form.reportValidity() : true;
    const controlsValid = reportCompoundValidity(this);
    if (!formValid || !controlsValid) return;
    this.dispatchEvent(
      event<VarendoRecordEditorSaveDetail>('varendo-record-editor-save', {
        source: 'user',
        entity: this.entity,
        key: this.entityKey,
        entityRevision: this.entityRevision,
        values: collectCompoundValues(this),
        ...(this.action === undefined ? {} : { action: this.action }),
      }),
    );
  };
  private readonly cancel = (): void => {
    if (!this.entityKey || !this.entityRevision) return;
    this.dispatchEvent(
      event<VarendoRecordEditorCancelDetail>('varendo-record-editor-cancel', {
        source: 'user',
        entity: this.entity,
        key: this.entityKey,
        entityRevision: this.entityRevision,
        values: collectCompoundValues(this),
      }),
    );
  };
}

export class VarendoFormFlowElement extends VarendoCompoundElement {
  static readonly properties = {
    steps: { attribute: false },
    activeStep: { attribute: 'active-step', type: String },
    draft: { attribute: false },
    validation: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    nextLabel: { attribute: 'next-label', type: String },
    backLabel: { attribute: 'back-label', type: String },
    commitLabel: { attribute: 'commit-label', type: String },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      [part='step-list'] {
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-8, 0.5rem);
        list-style: none;
        margin: 0 0 var(--varendo-space-16, 1rem);
        padding: 0;
      }
      [part='step'][data-active='true'] {
        font-weight: 700;
      }
    `,
  ];
  steps: readonly VarendoFormFlowStep[] = [];
  activeStep = '';
  draft: Readonly<Record<string, FormDraftValue>> = {};
  validation: Readonly<Record<string, string | undefined>> = {};
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Form';
  nextLabel = 'Next';
  backLabel = 'Back';
  commitLabel = 'Commit';
  private transientDraft: FormDraftRecord = nullRecord<FormDraftValue>();
  private transientDraftSource: Readonly<Record<string, FormDraftValue>> | undefined;

  private pendingFocus: { readonly target: string; readonly trigger: Element } | undefined;
  private focusStepAfterUpdate = false;

  protected override willUpdate(changes: PropertyValues): void {
    super.willUpdate(changes);
    if (changes.has('activeStep') && this.pendingFocus !== undefined) {
      this.focusStepAfterUpdate =
        this.activeStep === this.pendingFocus.target &&
        (this.shadowRoot?.activeElement ?? null) === this.pendingFocus.trigger;
      this.pendingFocus = undefined;
    }
  }

  protected override updated(changes: PropertyValues): void {
    super.updated(changes);
    if (!this.focusStepAfterUpdate) return;
    this.focusStepAfterUpdate = false;
    const first = this.controlsForStep(this.activeStep).find(
      (control) => !isDisabledControl(control) && control.getAttribute('type') !== 'hidden',
    );
    if (first !== undefined) first.focus();
    else this.renderRoot.querySelector<HTMLElement>('[part="step-panel"]')?.focus();
  }

  protected override render() {
    const active = this.activeStep || this.steps[0]?.id || '';
    const index = this.steps.findIndex((step) => step.id === active);
    const current = status(this.status);
    const error = this.validation[active];
    const named = this.hasNamedStepSlots();
    const slotName = `step-${active}`;
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        <span part="meta">Step ${index < 0 ? 0 : index + 1} of ${this.steps.length}</span>
      </div>
      <ol part="step-list">
        ${this.steps.map((step) => html`<li part="step" data-active=${String(step.id === active)}><button type="button" aria-current=${step.id === active ? 'step' : nothing} @click=${() => this.moveTo(step.id, this.steps.findIndex((item) => item.id === step.id) > index ? 'next' : 'back')}>${step.label}</button></li>`)}
      </ol>
      ${this.renderStepStatus(error, current)}
      <div
        part="step-panel"
        data-step=${active}
        tabindex="-1"
        role="group"
        aria-label=${this.steps[index]?.label ?? this.title}
      >
        ${named ? html`<slot name=${slotName}></slot>` : html`<slot></slot>`}
      </div>
      <div part="navigation">
        <button type="button" ?disabled=${index <= 0} @click=${() => this.moveRelative(-1)}>${this.backLabel}</button
        >${index >= 0 && index < this.steps.length - 1 ? html`<button type="button" @click=${() => this.moveRelative(1)}>${this.nextLabel}</button>` : html`<button type="button" @click=${this.commit}>${this.commitLabel}</button>`}
      </div>
    </section>`;
  }

  private renderStepStatus(error: string | undefined, current: ReturnType<typeof status>) {
    if (error !== undefined) return html`<p part="status" role="alert">${error}</p>`;
    if (current === 'ready') return nothing;
    return html`<p part="status" role="status">${this.statusText(current, this.message)}</p>`;
  }

  private hasNamedStepSlots(): boolean {
    return Array.from(this.children ?? []).some((child) => (child.getAttribute('slot') ?? '').startsWith('step-'));
  }

  private controlsForStep(stepId: string): readonly CompoundControl[] {
    if (!this.hasNamedStepSlots()) return compoundControls(this);
    return compoundControls(this).filter(
      (control) => control.closest('[slot]')?.getAttribute('slot') === `step-${stepId}`,
    );
  }

  private stepValid(stepId: string, report = false): boolean {
    if (this.validation[stepId]) return false;
    let valid = true;
    for (const control of this.controlsForStep(stepId)) {
      if (isDisabledControl(control)) continue;
      const check = report ? (control.reportValidity ?? control.checkValidity) : control.checkValidity;
      if (check !== undefined && !check.call(control)) valid = false;
    }
    return valid;
  }

  private collectDraft(): Readonly<FormDraftRecord> {
    this.resetTransientDraft();
    const output = Object.assign(nullRecord<FormDraftValue>(), this.draft, this.transientDraft);
    const replaced = new Set<string>();
    for (const control of compoundControls(this)) this.collectControlDraft(control, output, replaced);
    return output;
  }

  private resetTransientDraft(): void {
    if (this.transientDraftSource === this.draft) return;
    this.transientDraft = nullRecord<FormDraftValue>();
    this.transientDraftSource = this.draft;
  }

  private replaceCurrentValue(output: FormDraftRecord, replaced: Set<string>, name: string): void {
    if (replaced.has(name)) return;
    delete output[name];
    replaced.add(name);
  }

  private collectControlDraft(control: CompoundControl, output: FormDraftRecord, replaced: Set<string>): void {
    const name = control.getAttribute('name') || control.name || '';
    if (this.skipDraftControl(control, name)) return;
    if (this.collectToggleDraft(control, name, output, replaced)) return;
    if (this.collectMultipleSelectDraft(control, name, output, replaced)) return;
    if (this.collectDateRangeDraft(control, name, output, replaced)) return;
    this.replaceCurrentValue(output, replaced, name);
    const value = 'formValue' in control ? control.formValue : control.value;
    appendDraftValue(output, name, value);
  }

  private skipDraftControl(control: CompoundControl, name: string): boolean {
    if (!name || isDisabledControl(control) || control instanceof HTMLButtonElement) return true;
    return control instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(control.type);
  }

  private collectToggleDraft(
    control: CompoundControl,
    name: string,
    output: FormDraftRecord,
    replaced: Set<string>,
  ): boolean {
    if (!(control instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(control.type)) return false;
    this.replaceCurrentValue(output, replaced, name);
    if (control.checked) appendDraftValue(output, name, control.value);
    return true;
  }

  private collectMultipleSelectDraft(
    control: CompoundControl,
    name: string,
    output: FormDraftRecord,
    replaced: Set<string>,
  ): boolean {
    if (!(control instanceof HTMLSelectElement) || !control.multiple) return false;
    this.replaceCurrentValue(output, replaced, name);
    appendDraftValue(
      output,
      name,
      [...control.selectedOptions].map((option) => option.value),
    );
    return true;
  }

  private collectDateRangeDraft(
    control: CompoundControl,
    name: string,
    output: FormDraftRecord,
    replaced: Set<string>,
  ): boolean {
    const range = dateRangeParts(control, name);
    if (range === undefined) return false;
    const endName = name + '[end]';
    this.replaceCurrentValue(output, replaced, range[0]);
    this.replaceCurrentValue(output, replaced, endName);
    appendDraftValue(output, range[0], range[1]);
    const end = (control as HTMLElement & { readonly end?: string }).end;
    if (typeof end === 'string') appendDraftValue(output, endName, end);
    return true;
  }

  private captureDraft(): Readonly<FormDraftRecord> {
    this.transientDraft = Object.assign(nullRecord<FormDraftValue>(), this.collectDraft());
    this.transientDraftSource = this.draft;
    return this.transientDraft;
  }

  private moveRelative(delta: number): void {
    const active = this.activeStep || this.steps[0]?.id || '';
    const index = this.steps.findIndex((step) => step.id === active);
    const target = this.steps[index + delta];
    if (target) this.moveTo(target.id, delta > 0 ? 'next' : 'back');
  }

  private moveTo(target: string, direction: 'next' | 'back'): void {
    const transition = this.stepTransition(target);
    if (transition === undefined || !this.canMove(direction, transition)) return;
    const trigger = this.shadowRoot?.activeElement ?? null;
    this.pendingFocus = trigger === null ? undefined : { target, trigger };
    this.dispatchStepChange(transition.from, target, direction);
  }

  private stepTransition(
    target: string,
  ): { readonly from: string; readonly fromIndex: number; readonly targetIndex: number } | undefined {
    const from = this.activeStep || this.steps[0]?.id || '';
    const fromIndex = this.steps.findIndex((step) => step.id === from);
    const targetIndex = this.steps.findIndex((step) => step.id === target);
    if (!target || target === from || fromIndex < 0 || targetIndex < 0) return undefined;
    return { from, fromIndex, targetIndex };
  }

  private canMove(
    direction: 'next' | 'back',
    transition: { readonly fromIndex: number; readonly targetIndex: number },
  ): boolean {
    if (direction === 'back') return true;
    return this.stepsValidBetween(transition.fromIndex, transition.targetIndex);
  }

  private stepsValidBetween(fromIndex: number, targetIndex: number): boolean {
    for (let index = fromIndex; index < targetIndex; index += 1) {
      if (!this.stepValid(this.steps[index]!.id, true)) return false;
    }
    return true;
  }

  private dispatchStepChange(from: string, target: string, direction: 'next' | 'back'): void {
    const change = event<VarendoFormFlowStepDetail>('varendo-form-flow-step', {
      source: 'user',
      from,
      to: target,
      direction,
      draft: this.captureDraft(),
    });
    this.dispatchEvent(change);
    if (change.defaultPrevented) this.pendingFocus = undefined;
  }

  private readonly commit = (): void => {
    const active = this.activeStep || this.steps[0]?.id || '';
    if (!active) return;
    for (const step of this.steps) if (!this.stepValid(step.id, true)) return;
    this.dispatchEvent(
      event<VarendoFormFlowCommitDetail>('varendo-form-flow-commit', {
        source: 'user',
        step: active,
        draft: this.captureDraft(),
      }),
    );
  };
}

export class VarendoQualityPanelElement extends VarendoCompoundElement {
  static readonly properties = {
    source: { type: String },
    freshness: { type: String },
    completeness: { type: String },
    provenance: { attribute: false },
    unsupportedClaims: { attribute: false },
    status: { type: String },
    message: { type: String },
    title: { type: String },
    state: { attribute: false },
  };
  static readonly styles = [
    ...varendoCompoundThemeStyles,
    css`
      dl {
        display: grid;
        gap: var(--varendo-space-8, 0.5rem) var(--varendo-space-16, 1rem);
        grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
        margin: 0;
      }
      dt {
        color: var(--varendo-color-muted, #475569);
        overflow-wrap: anywhere;
      }
      dd {
        margin: 0;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      bdi {
        overflow-wrap: anywhere;
      }
      ul {
        margin-block: var(--varendo-space-8, 0.5rem) 0;
        padding-inline-start: 1.25rem;
      }
      @media (max-width: 30rem) {
        dl {
          grid-template-columns: minmax(0, 1fr);
        }
        dd:not(:last-child) {
          margin-block-end: var(--varendo-space-12, 0.75rem);
        }
      }
    `,
  ];
  source = '';
  freshness = '';
  completeness = '';
  provenance: readonly string[] = [];
  unsupportedClaims: readonly string[] = [];
  status: VarendoCompoundStatus = 'ready';
  message = '';
  title = 'Data quality';
  state: VarendoQualityState | undefined;
  protected override render() {
    const values = this.qualityValues();
    const current = status(this.status);
    return html`<section part="root" data-status=${current} aria-label=${this.title}>
      <div part="header">
        <h2>${this.title}</h2>
        <span part="meta">${this.statusLabel(current)}</span>
      </div>
      <dl>
        <dt>Source</dt>
        <dd><bdi>${values.source || 'Not supplied'}</bdi></dd>
        <dt>Freshness</dt>
        <dd><bdi>${values.freshness || 'Not supplied'}</bdi></dd>
        <dt>Completeness</dt>
        <dd><bdi>${values.completeness || 'Not supplied'}</bdi></dd>
        <dt>Provenance</dt>
        <dd>${this.renderProvenance(values.provenance)}</dd>
      </dl>
      ${this.renderStatus(current)} ${this.renderUnsupported(values.unsupported)}
    </section>`;
  }

  private qualityValues() {
    return {
      source: this.state?.source ?? this.source,
      freshness: this.state?.freshness ?? this.freshness,
      completeness: this.state?.completeness ?? this.completeness,
      provenance: this.state?.provenance ?? this.provenance,
      unsupported: this.state?.unsupportedClaims ?? this.unsupportedClaims,
    };
  }

  private statusLabel(current: ReturnType<typeof status>): string {
    if (current === 'ready') return 'Reported metadata';
    return this.statusText(current, this.message);
  }

  private renderProvenance(provenance: readonly string[]) {
    if (provenance.length === 0) return html`<bdi>Not supplied</bdi>`;
    return html`<ul>
      ${provenance.map((item) => html`<li><bdi>${item}</bdi></li>`)}
    </ul>`;
  }

  private renderStatus(current: ReturnType<typeof status>) {
    if (current === 'ready') return nothing;
    return html`<p part="status" role="status">${this.statusText(current, this.message)}</p>`;
  }

  private renderUnsupported(unsupported: readonly string[]) {
    if (unsupported.length === 0) return nothing;
    return html`<p part="caution">
        <bdi>Unsupported claims are shown explicitly and are not presented as facts.</bdi>
      </p>
      <ul part="unsupported">
        ${unsupported.map((item) => html`<li><bdi>${item}</bdi></li>`)}
      </ul>`;
  }
}
