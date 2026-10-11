import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { emitAction } from '../navigation/shared.js';
import { aeliqoFeedbackStyles, type AeliqoFeedbackTone, toneColor } from './shared.js';

const TOAST_TONES: ReadonlySet<AeliqoFeedbackTone> = new Set(['neutral', 'info', 'success', 'warning', 'danger']);

export class AeliqoToastElement extends AeliqoFoundationElement {
  static readonly properties = {
    open: { type: Boolean, reflect: true },
    message: { type: String },
    tone: { type: String },
    duration: { type: Number },
    dismissible: { type: Boolean },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    ...aeliqoFeedbackStyles,
    css`
      :host {
        display: block;
        max-inline-size: min(28rem, calc(100vw - 2rem));
      }
      [part='toast'] {
        align-items: start;
        background: var(--aeliqo-color-surface, #f8fafc);
        border-inline-start: 0.25rem solid var(--aeliqo-color-info, #1d4ed8);
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        box-shadow: var(--aeliqo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        display: flex;
        gap: var(--aeliqo-space-12, 0.75rem);
        padding: var(--aeliqo-space-12, 0.75rem) var(--aeliqo-space-16, 1rem);
      }
      [part='message'] {
        flex: 1;
        overflow-wrap: anywhere;
      }
      [part='close'] {
        background: transparent;
        border: 0;
        cursor: pointer;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        min-inline-size: var(--aeliqo-control-min-target, 2.75rem);
      }
    `,
  ];

  open = false;
  message = '';
  tone: AeliqoFeedbackTone = 'info';
  duration = 5000;
  dismissible = true;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;

  protected override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open') && !changed.has('duration') && !changed.has('tone')) return;
    clearTimeout(this.timer);
    const duration = Number.isFinite(this.duration) ? Math.min(60_000, Math.max(0, this.duration)) : 0;
    if (this.open && this.tone !== 'danger' && duration > 0) this.timer = setTimeout(() => this.dismiss(), duration);
  }
  disconnectedCallback(): void {
    clearTimeout(this.timer);
    super.disconnectedCallback();
  }
  private dismiss(): void {
    if (emitAction(this, 'aeliqo-toast-dismiss', {})) this.open = false;
  }
  protected override render() {
    const tone = TOAST_TONES.has(this.tone) ? this.tone : 'info';
    return html`<div
      part="toast"
      role=${tone === 'danger' ? 'alert' : 'status'}
      aria-live=${tone === 'danger' ? 'assertive' : 'polite'}
      ?hidden=${!this.open}
      style=${`border-inline-start-color: ${toneColor(tone as AeliqoFeedbackTone)}`}
    >
      <span part="message">${this.message || html`<slot></slot>`}</span
      >${this.dismissible ? html`<button part="close" type="button" aria-label="Dismiss" @click=${() => this.dismiss()}>×</button>` : nothing}
    </div>`;
  }
}
