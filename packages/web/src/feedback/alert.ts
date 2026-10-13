import { css, html, nothing } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { emitAction } from '../navigation/shared.js';
import { varendoFeedbackStyles, type VarendoFeedbackTone, toneColor } from './shared.js';

const ALERT_TONES: ReadonlySet<VarendoFeedbackTone> = new Set(['neutral', 'info', 'success', 'warning', 'danger']);

export class VarendoAlertElement extends VarendoFoundationElement {
  static readonly properties = {
    open: { type: Boolean, reflect: true },
    message: { type: String },
    heading: { type: String },
    tone: { type: String },
    actionLabel: { type: String, attribute: 'action-label' },
    dismissible: { type: Boolean },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    ...varendoFeedbackStyles,
    css`
      :host {
        display: block;
      }
      [part='alert'] {
        background: color-mix(in srgb, var(--varendo-color-surface, #f8fafc) 92%, var(--varendo-color-info, #1d4ed8));
        border-inline-start: 0.25rem solid var(--varendo-color-info, #1d4ed8);
        border-radius: var(--varendo-radius-medium, 0.625rem);
        display: grid;
        gap: var(--varendo-space-4, 0.25rem);
        grid-template-columns: 1fr auto;
        padding: var(--varendo-space-12, 0.75rem) var(--varendo-space-16, 1rem);
      }
      [part='heading'] {
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
      }
      [part='message'] {
        overflow-wrap: anywhere;
      }
      button {
        background: transparent;
        border: 0;
        cursor: pointer;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        padding-inline: var(--varendo-space-8, 0.5rem);
      }
      [part='actions'] {
        grid-column: 1 / -1;
      }
    `,
  ];

  open = true;
  message = '';
  heading = '';
  tone: VarendoFeedbackTone = 'info';
  actionLabel = '';
  dismissible = false;

  private dismiss(): void {
    if (emitAction(this, 'varendo-alert-dismiss', {})) this.open = false;
  }
  private action(): void {
    emitAction(this, 'varendo-alert-action', {});
  }
  protected override render() {
    const tone = ALERT_TONES.has(this.tone) ? this.tone : 'info';
    return html`<div
      part="alert"
      role=${tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      aria-live=${tone === 'danger' ? 'assertive' : 'polite'}
      ?hidden=${!this.open}
      style=${`border-inline-start-color: ${toneColor(tone as VarendoFeedbackTone)}`}
    >
      <div>
        ${this.heading ? html`<div part="heading">${this.heading}</div>` : nothing}
        <div part="message">${this.message || html`<slot></slot>`}</div>
      </div>
      ${this.dismissible ? html`<button part="close" type="button" aria-label="Dismiss" @click=${() => this.dismiss()}>×</button>` : nothing}
      ${this.actionLabel ? html`<div part="actions"><button type="button" @click=${this.action}>${this.actionLabel}</button></div>` : nothing}
    </div>`;
  }
}
