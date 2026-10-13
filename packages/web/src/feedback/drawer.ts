import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { nextFrame, emitAction, safeElementId } from '../navigation/shared.js';
import { OverlayFocus } from './focus-trap.js';
import { varendoFeedbackStyles } from './shared.js';

export type VarendoDrawerMode = 'inline' | 'modal';
export type VarendoDrawerSide = 'start' | 'end';

export class VarendoDrawerElement extends VarendoFoundationElement {
  static readonly properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String },
    mode: { type: String },
    side: { type: String },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    ...varendoFeedbackStyles,
    css`
      :host {
        display: block;
      }
      [part='inline'] {
        background: var(--varendo-color-surface, #f8fafc);
        border-inline-start: 0.0625rem solid var(--varendo-color-border, #64748b);
        border-inline-end: 0.0625rem solid var(--varendo-color-border, #64748b);
        max-block-size: 100%;
        overflow: auto;
      }
      dialog {
        background: var(--varendo-color-surface, #f8fafc);
        border: 0;
        border-block: 0.0625rem solid var(--varendo-color-border, #64748b);
        color: inherit;
        inset-block: 0;
        margin: 0;
        max-block-size: none;
        max-inline-size: min(28rem, 92vw);
        padding: 0;
        position: fixed;
        width: min(28rem, 92vw);
      }
      dialog[data-side='end'] {
        inset-inline-end: 0;
      }
      dialog[data-side='start'] {
        inset-inline-start: 0;
      }
      dialog::backdrop {
        background: rgb(15 23 42 / 0.45);
      }
      [part='header'] {
        align-items: center;
        border-block-end: 0.0625rem solid var(--varendo-color-border, #64748b);
        display: flex;
        justify-content: space-between;
        padding: var(--varendo-space-12, 0.75rem) var(--varendo-space-16, 1rem);
      }
      [part='content'] {
        max-block-size: calc(100vh - 5rem);
        overflow: auto;
        padding: var(--varendo-space-16, 1rem);
      }
      [part='close'] {
        background: transparent;
        border: 0;
        cursor: pointer;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        min-inline-size: var(--varendo-control-min-target, 2.75rem);
      }
    `,
  ];

  open = false;
  heading = 'Details';
  mode: VarendoDrawerMode = 'inline';
  side: VarendoDrawerSide = 'end';
  private readonly overlayFocus = new OverlayFocus(this);

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('mode') || !this.open) return;
    this.overlayFocus.capturePending();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open') && !changed.has('mode')) return;
    const epoch = this.overlayFocus.nextEpoch();
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog');
    if (this.mode === 'modal' && dialog !== null) {
      this.syncModalDialog(dialog, epoch);
      return;
    }
    if (this.mode === 'inline' && this.open) this.focusInlineTarget();
  }

  private syncModalDialog(dialog: HTMLDialogElement, epoch: number): void {
    if (!this.open) {
      this.closeModalDialog(dialog);
      return;
    }
    this.overlayFocus.rememberOpener();
    if (!dialog.open) this.showModalDialog(dialog);
    const target = this.overlayFocus.takePending();
    this.overlayFocus.focusIfNeeded(dialog, epoch, this.open, target, true);
    nextFrame(() => this.overlayFocus.focusIfNeeded(dialog, epoch, this.open, target, false));
  }

  private showModalDialog(dialog: HTMLDialogElement): void {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  private closeModalDialog(dialog: HTMLDialogElement): void {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    this.overlayFocus.restoreOpener();
  }

  private focusInlineTarget(): void {
    const target = this.overlayFocus.takePending();
    if (target?.isConnected) target.focus();
  }

  private keydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog');
    if (dialog === null) return;
    this.overlayFocus.trapTab(event, dialog);
  }

  private close(): void {
    if (emitAction(this, 'varendo-drawer-close', {})) this.open = false;
  }
  protected override render() {
    const headingId = safeElementId(`${this.id || 'varendo-drawer'}-heading`, 'varendo-drawer-heading');
    if (this.mode === 'modal')
      return html`<dialog
        part="modal"
        data-side=${this.side}
        aria-labelledby=${headingId}
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.close();
        }}
        @keydown=${this.keydown}
      >
        <header part="header">
          <h2 id=${headingId}>${this.heading}</h2>
          <button part="close" type="button" aria-label="Close" @click=${() => this.close()}>×</button>
        </header>
        <div part="content"><slot></slot></div>
      </dialog>`;
    return html`<aside part="inline" aria-labelledby=${headingId} ?hidden=${!this.open}>
      <header part="header">
        <h2 id=${headingId}>${this.heading}</h2>
        <button part="close" type="button" aria-label="Close" @click=${() => this.close()}>×</button>
      </header>
      <div part="content"><slot></slot></div>
    </aside>`;
  }
}
