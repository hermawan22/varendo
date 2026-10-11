import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { nextFrame, emitAction, safeElementId } from '../navigation/shared.js';
import { OverlayFocus } from './focus-trap.js';
import { aeliqoFeedbackStyles } from './shared.js';

export class AeliqoDialogElement extends AeliqoFoundationElement {
  static readonly properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    modal: { type: Boolean },
    closeOnEscape: { type: Boolean, attribute: 'close-on-escape' },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    ...aeliqoFeedbackStyles,
    css`
      dialog {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-large, 0.875rem);
        box-shadow: var(--aeliqo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        color: inherit;
        inline-size: min(40rem, calc(100vw - 2rem));
        max-block-size: min(80vh, 48rem);
        padding: 0;
      }
      dialog::backdrop {
        background: rgb(15 23 42 / 0.55);
      }
      [part='header'] {
        align-items: center;
        border-block-end: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-8, 0.5rem);
        justify-content: space-between;
        padding: var(--aeliqo-space-12, 0.75rem) min(var(--aeliqo-space-16, 1rem), 5vw);
      }
      [part='content'] {
        overflow: auto;
        padding: var(--aeliqo-space-16, 1rem) min(var(--aeliqo-space-16, 1rem), 5vw);
      }
      [part='header'] h2 {
        flex: 1 1 auto;
        margin: 0;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      [part='close'] {
        background: transparent;
        border: 0;
        cursor: pointer;
        flex-shrink: 0;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        min-inline-size: var(--aeliqo-control-min-target, 2.75rem);
      }
      ::slotted(button) {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: var(--aeliqo-control-border-width, 0.0625rem) solid var(--aeliqo-color-border, #64748b);
        color: var(--aeliqo-color-text, #111827);
        font: inherit;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        min-inline-size: var(--aeliqo-control-min-target, 2.75rem);
        padding: var(--aeliqo-space-8, 0.5rem) var(--aeliqo-control-inline-padding, 0.875rem);
      }
      @media (forced-colors: active) {
        ::slotted(button) {
          background: Canvas;
          color: CanvasText;
        }
      }
    `,
  ];

  open = false;
  heading = 'Dialog';
  modal = true;
  closeOnEscape = true;
  private readonly overlayFocus = new OverlayFocus(this);
  private shownModal: boolean | undefined = undefined;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('modal') || !this.open) return;
    this.overlayFocus.capturePending();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open') && !changed.has('modal')) return;
    const epoch = this.overlayFocus.nextEpoch();
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog');
    if (dialog === null) return;
    if (!this.open) {
      this.closeDialog(dialog);
      return;
    }
    this.openDialog(dialog, epoch);
  }

  private openDialog(dialog: HTMLDialogElement, epoch: number): void {
    this.overlayFocus.rememberOpener();
    this.syncDialogMode(dialog);
    const target = this.overlayFocus.takePending();
    this.overlayFocus.focusIfNeeded(dialog, epoch, this.open, target, true);
    nextFrame(() => this.overlayFocus.focusIfNeeded(dialog, epoch, this.open, target, false));
  }

  private syncDialogMode(dialog: HTMLDialogElement): void {
    if (!dialog.open) {
      this.showDialog(dialog);
      this.shownModal = this.modal;
      return;
    }
    if (this.shownModal === undefined || this.shownModal === this.modal) return;
    if (typeof dialog.close === 'function') dialog.close();
    this.shownModal = undefined;
    this.showDialog(dialog);
    this.shownModal = this.modal;
  }

  private showDialog(dialog: HTMLDialogElement): void {
    if (this.modal && typeof dialog.showModal === 'function') dialog.showModal();
    else if (typeof dialog.show === 'function') dialog.show();
    else dialog.setAttribute('open', '');
  }

  private closeDialog(dialog: HTMLDialogElement): void {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    this.shownModal = undefined;
    this.overlayFocus.restoreOpener();
  }

  private close(): void {
    if (emitAction(this, 'aeliqo-dialog-close', {})) this.open = false;
  }
  private cancel(event: Event): void {
    if (!this.closeOnEscape) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    this.close();
  }
  private keydown(event: KeyboardEvent): void {
    if (!this.modal || event.key !== 'Tab') return;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog');
    if (dialog === null) return;
    this.overlayFocus.trapTab(event, dialog);
  }
  protected override render() {
    const headingId = safeElementId(`${this.id || 'aeliqo-dialog'}-heading`, 'aeliqo-dialog-heading');
    return html`<dialog part="dialog" aria-labelledby=${headingId} @cancel=${this.cancel} @keydown=${this.keydown}>
      <div part="header">
        <h2 id=${headingId}>${this.heading}</h2>
        <button part="close" type="button" aria-label="Close" @click=${() => this.close()}>×</button>
      </div>
      <div part="content"><slot></slot></div>
    </dialog>`;
  }
}
