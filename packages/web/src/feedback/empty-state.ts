import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { emitAction } from '../navigation/shared.js';
import { aeliqoFeedbackStyles } from './shared.js';

export type AeliqoEmptyStateKind = 'no-records' | 'no-matches' | 'forbidden' | 'loading' | 'failure';

const EMPTY_STATE_KINDS: ReadonlySet<AeliqoEmptyStateKind> = new Set([
  'no-records',
  'no-matches',
  'forbidden',
  'loading',
  'failure',
]);

/** A truthful state message for a result surface with an optional host action. */
export class AeliqoEmptyStateElement extends AeliqoFoundationElement {
  static readonly properties = {
    kind: { type: String },
    heading: { type: String },
    message: { type: String },
    actionLabel: { type: String, attribute: 'action-label' },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    ...aeliqoFeedbackStyles,
    css`
      :host {
        display: block;
      }
      [part='state'] {
        align-items: center;
        border: 0.0625rem dashed var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        justify-items: center;
        min-block-size: 8rem;
        padding: var(--aeliqo-space-24, 1.5rem);
        text-align: center;
      }
      [part='heading'] {
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
      [part='message'] {
        max-inline-size: 42rem;
        overflow-wrap: anywhere;
      }
      [part='action'] {
        background: var(--aeliqo-color-accent, #4338ca);
        border: 0;
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        color: var(--aeliqo-color-on-accent, #fff);
        cursor: pointer;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding-inline: var(--aeliqo-space-12, 0.75rem);
      }
      [part='action']:not(:disabled):hover {
        background: color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 90%, var(--aeliqo-color-on-accent, #fff));
      }
    `,
  ];

  kind: AeliqoEmptyStateKind = 'no-records';
  heading = 'No records';
  message = 'There is nothing to display.';
  actionLabel = '';

  private action(): void {
    emitAction(this, 'aeliqo-empty-state-action', { kind: this.kind });
  }

  protected override render() {
    const kind: AeliqoEmptyStateKind = EMPTY_STATE_KINDS.has(this.kind) ? this.kind : 'failure';
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
