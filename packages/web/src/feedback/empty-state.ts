import { css, html, nothing } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { emitAction } from '../navigation/shared.js';
import { varendoFeedbackStyles } from './shared.js';

export type VarendoEmptyStateKind = 'no-records' | 'no-matches' | 'forbidden' | 'loading' | 'failure';

const EMPTY_STATE_KINDS: ReadonlySet<VarendoEmptyStateKind> = new Set([
  'no-records',
  'no-matches',
  'forbidden',
  'loading',
  'failure',
]);

/** A truthful state message for a result surface with an optional host action. */
export class VarendoEmptyStateElement extends VarendoFoundationElement {
  static readonly properties = {
    kind: { type: String },
    heading: { type: String },
    message: { type: String },
    actionLabel: { type: String, attribute: 'action-label' },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    ...varendoFeedbackStyles,
    css`
      :host {
        display: block;
      }
      [part='state'] {
        align-items: center;
        border: 0.0625rem dashed var(--varendo-color-border, #64748b);
        border-radius: var(--varendo-radius-medium, 0.625rem);
        display: grid;
        gap: var(--varendo-space-8, 0.5rem);
        justify-items: center;
        min-block-size: 8rem;
        padding: var(--varendo-space-24, 1.5rem);
        text-align: center;
      }
      [part='heading'] {
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
      }
      [part='message'] {
        max-inline-size: 42rem;
        overflow-wrap: anywhere;
      }
      [part='action'] {
        background: var(--varendo-color-accent, #4338ca);
        border: 0;
        border-radius: var(--varendo-radius-small, 0.375rem);
        color: var(--varendo-color-on-accent, #fff);
        cursor: pointer;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        padding-inline: var(--varendo-space-12, 0.75rem);
      }
      [part='action']:not(:disabled):hover {
        background: color-mix(in srgb, var(--varendo-color-accent, #4338ca) 90%, var(--varendo-color-on-accent, #fff));
      }
    `,
  ];

  kind: VarendoEmptyStateKind = 'no-records';
  heading = 'No records';
  message = 'There is nothing to display.';
  actionLabel = '';

  private action(): void {
    emitAction(this, 'varendo-empty-state-action', { kind: this.kind });
  }

  protected override render() {
    const kind: VarendoEmptyStateKind = EMPTY_STATE_KINDS.has(this.kind) ? this.kind : 'failure';
    const role = kind === 'failure' || kind === 'forbidden' ? 'alert' : 'status';
    const busy = kind === 'loading' ? 'true' : 'false';
    return html`<section
      part="state"
      data-kind=${kind}
      role=${role}
      aria-live=${role === 'alert' ? 'assertive' : 'polite'}
      aria-busy=${busy}
    >
      <div part="heading">${this.heading}</div>
      <div part="message">${this.message || html`<slot></slot>`}</div>
      ${this.actionLabel && kind !== 'loading' ? html`<button part="action" type="button" @click=${this.action}>${this.actionLabel}</button>` : nothing}
    </section>`;
  }
}
