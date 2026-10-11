import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { listenOutside, nextFrame, emitAction, safeElementId } from '../navigation/shared.js';
import { OverlayFocus } from './focus-trap.js';
import { aeliqoFeedbackStyles } from './shared.js';

export class AeliqoPopoverElement extends AeliqoFoundationElement {
  static readonly properties = {
    label: { type: String },
    content: { type: String },
    open: { type: Boolean, reflect: true },
    modal: { type: Boolean },
    closeOnOutside: { type: Boolean, attribute: 'close-on-outside' },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    ...aeliqoFeedbackStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      [part='trigger'] {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        cursor: pointer;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding-inline: var(--aeliqo-space-12, 0.75rem);
      }
      [part='popover'] {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        box-shadow: var(--aeliqo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        inset-block-start: calc(100% + var(--aeliqo-space-4, 0.25rem));
        inset-inline-start: 0;
        max-block-size: min(70vh, 32rem);
        max-inline-size: min(28rem, calc(100vw - 2rem));
        overflow: auto;
        padding: var(--aeliqo-space-16, 1rem);
        position: absolute;
        width: max-content;
        z-index: 15;
      }
      dialog[part='popover'] {
        inset: 50% auto auto 50%;
        max-block-size: min(70vh, 32rem);
        position: fixed;
        transform: translate(-50%, -50%);
      }
      dialog::backdrop {
        background: rgb(15 23 42 / 0.45);
      }
      [part='close'] {
        background: transparent;
        border: 0;
        color: inherit;
        cursor: pointer;
        float: inline-end;
        min-inline-size: var(--aeliqo-control-min-target, 2.75rem);
      }
      [part='close'],
      [part='trigger'] {
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
      }
    `,
  ];

  label = 'Open details';
  content = '';
  open = false;
  modal = false;
  closeOnOutside = true;
  private readonly overlayFocus = new OverlayFocus(this);
  private stopOutside: (() => void) | undefined = undefined;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('modal') || !this.open) return;
    this.overlayFocus.capturePending();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open') && !changed.has('closeOnOutside') && !changed.has('modal')) return;
    const epoch = this.overlayFocus.nextEpoch();
    this.stopOutside?.();
    this.stopOutside = undefined;
    if (!this.open) {
      this.closePopover();
      return;
    }
    this.openPopover(epoch);
  }

  private openPopover(epoch: number): void {
    this.overlayFocus.rememberOpener();
    if (this.closeOnOutside) this.stopOutside = listenOutside(this, () => this.close());
    const surface = this.renderRoot.querySelector<HTMLElement>("[part='popover']");
    this.showModalPopover(surface);
    const pending = this.overlayFocus.takePending();
    // Preserve a focused slotted control during a mode switch synchronously.
    // The queued fallback only fills an empty focus surface and cannot steal a
    // focus that the consumer moved after opening.
    if (this.modal || pending?.isConnected) this.overlayFocus.focusIfNeeded(surface, epoch, this.open, pending, true);
    if (this.modal && surface !== null)
      nextFrame(() => this.overlayFocus.focusIfNeeded(surface, epoch, this.open, pending, false));
  }

  private showModalPopover(surface: HTMLElement | null): void {
    if (!this.modal || !(surface instanceof HTMLDialogElement) || surface.open) return;
    if (typeof surface.showModal === 'function') surface.showModal();
    else if (typeof surface.show === 'function') surface.show();
    else surface.setAttribute('open', '');
  }

  private closePopover(): void {
    this.overlayFocus.takePending();
    const surface = this.renderRoot.querySelector<HTMLDialogElement>("dialog[part='popover']");
    if (surface?.open) {
      if (typeof surface.close === 'function') surface.close();
      else surface.removeAttribute('open');
    }
    this.overlayFocus.restoreOpener();
  }

  disconnectedCallback(): void {
    this.stopOutside?.();
    super.disconnectedCallback();
  }
  private close(): void {
    if (emitAction(this, 'aeliqo-popover-close', {})) this.open = false;
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (!this.modal || event.key !== 'Tab') return;
    const surface = this.renderRoot.querySelector<HTMLElement>("[part='popover']");
    if (surface === null) return;
    this.overlayFocus.trapTab(event, surface);
  }

  private cancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected override render() {
    const id = safeElementId(`${this.id || 'aeliqo-popover'}-surface`, 'aeliqo-popover-surface');
    const content = html`<button part="close" type="button" aria-label="Close" @click=${() => this.close()}>×</button>
      ${this.content || html`<slot></slot>`}`;
    return html`<button
        part="trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-controls=${id}
        @keydown=${(event: KeyboardEvent) => {
          if (this.open && event.key === 'Escape') this.keydown(event);
        }}
        @click=${() => {
          this.overlayFocus.rememberOpener();
          this.open = !this.open;
        }}
      >
        ${this.label}
      </button>
      ${
        this.modal
          ? html`<dialog
              part="popover"
              id=${id}
              role="dialog"
              aria-label=${this.label}
              aria-modal="true"
              @cancel=${this.cancel}
              @keydown=${this.keydown}
            >
              ${content}
            </dialog>`
          : html`<section
              part="popover"
              id=${id}
              role="dialog"
              aria-label=${this.label}
              aria-modal="false"
              ?hidden=${!this.open}
              @keydown=${this.keydown}
            >
              ${content}
            </section>`
      }`;
  }
}
