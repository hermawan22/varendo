import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement } from '../foundation/base.js';
import { aeliqoInputStyles } from './base.js';

/** Semantic grouping boundary for related controls and coordinated messages. */
export class AeliqoFieldGroupElement extends AeliqoFoundationElement {
  static readonly properties = {
    legend: { type: String },
    description: { type: String },
    error: { type: String },
    disabled: { type: Boolean, reflect: true },
  };

  legend = '';
  description = '';
  error = '';
  disabled = false;
  private readonly restoredDisabled = new Map<HTMLElement & { disabled: boolean }, boolean>();
  private disabledObserver: MutationObserver | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof MutationObserver === 'function') {
      this.disabledObserver = new MutationObserver((records) => {
        if (this.disabled) {
          for (const record of records) {
            const control = record.target as HTMLElement & { disabled?: boolean };
            if (
              record.target instanceof HTMLElement &&
              typeof control.disabled === 'boolean' &&
              this.restoredDisabled.has(control as HTMLElement & { disabled: boolean }) &&
              !control.disabled
            ) {
              this.restoredDisabled.set(control as HTMLElement & { disabled: boolean }, false);
            }
          }
        }
        this.syncDisabledDescendants();
      });
      this.disabledObserver.observe(this, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['disabled'],
      });
    }
    this.syncDisabledDescendants();
  }

  override disconnectedCallback(): void {
    this.disabledObserver?.disconnect();
    this.disabledObserver = undefined;
    for (const [control, prior] of this.restoredDisabled) control.disabled = prior;
    this.restoredDisabled.clear();
    super.disconnectedCallback();
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('disabled')) return;
    this.syncDisabledDescendants();
  }

  protected override render() {
    return html`
      <fieldset part="group" ?disabled=${this.disabled} aria-describedby=${this.describedByIds() || nothing}>
        ${this.legend ? html`<legend part="legend">${this.legend}</legend>` : nothing}
        ${this.description ? html`<span id="description" part="description">${this.description}</span>` : nothing}
        <slot @slotchange=${this.handleSlotChange}></slot>
        ${this.error ? html`<span id="error" part="error" role="alert">${this.error}</span>` : nothing}
      </fieldset>
    `;
  }

  private describedByIds(): string {
    return [this.description ? 'description' : '', this.error ? 'error' : ''].filter(Boolean).join(' ');
  }

  private readonly handleSlotChange = (): void => {
    this.syncDisabledDescendants();
  };

  private syncDisabledDescendants(): void {
    const controls = Array.from(this.querySelectorAll<HTMLElement>('*')).filter(
      (child): child is HTMLElement & { disabled: boolean } =>
        'disabled' in child && typeof (child as { disabled?: unknown }).disabled === 'boolean',
    );
    const current = new Set(controls);
    for (const control of this.restoredDisabled.keys()) {
      if (!current.has(control)) {
        control.disabled = this.restoredDisabled.get(control)!;
        this.restoredDisabled.delete(control);
      }
    }
    if (this.disabled) {
      for (const control of controls) {
        if (!this.restoredDisabled.has(control)) this.restoredDisabled.set(control, control.disabled);
        if (!control.disabled) control.disabled = true;
      }
      return;
    }
    for (const [control, prior] of this.restoredDisabled) {
      if (current.has(control)) control.disabled = prior;
      this.restoredDisabled.delete(control);
    }
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      fieldset {
        border: 0;
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }
      legend {
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
    `,
  ];
}
