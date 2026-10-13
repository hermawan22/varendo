import { css, html, nothing } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { varendoFeedbackStyles } from './shared.js';

export class VarendoTooltipElement extends VarendoFoundationElement {
  static readonly properties = {
    label: { type: String },
    content: { type: String },
    open: { type: Boolean, reflect: true },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    ...varendoFeedbackStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      [part='trigger'] {
        background: transparent;
        border: 0;
        cursor: help;
        display: inline-flex;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        padding: var(--varendo-space-4, 0.25rem);
      }
      [part='tooltip'] {
        background: var(--varendo-color-text, #111827);
        border-radius: var(--varendo-radius-small, 0.375rem);
        color: var(--varendo-color-canvas, #fff);
        inset-block-start: calc(100% + var(--varendo-space-4, 0.25rem));
        inset-inline-start: 0;
        max-inline-size: min(22rem, calc(100vw - 2rem));
        padding: var(--varendo-space-8, 0.5rem);
        position: absolute;
        width: max-content;
        z-index: 20;
      }
    `,
  ];

  label = 'More information';
  content = '';
  open = false;
  private closeTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  private show(): void {
    clearTimeout(this.closeTimer);
    this.open = true;
  }
  private hide(immediate = false): void {
    clearTimeout(this.closeTimer);
    if (immediate) {
      this.open = false;
      return;
    }
    this.closeTimer = setTimeout(() => {
      this.open = false;
    }, 100);
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide(true);
    }
  }

  disconnectedCallback(): void {
    clearTimeout(this.closeTimer);
    super.disconnectedCallback();
  }

  protected override render() {
    const tooltipId = `${this.id || 'varendo-tooltip'}-content`;
    return html`<button
        part="trigger"
        type="button"
        aria-label=${this.label}
        aria-describedby=${this.open ? tooltipId : nothing}
        @mouseenter=${this.show}
        @focus=${this.show}
        @mouseleave=${() => this.hide()}
        @blur=${() => this.hide()}
        @keydown=${this.keydown}
      >
        ${this.label}
      </button>
      <span
        part="tooltip"
        id=${tooltipId}
        role="tooltip"
        ?hidden=${!this.open}
        @mouseenter=${this.show}
        @mouseleave=${() => this.hide()}
        >${this.content || html`<slot></slot>`}</span
      >`;
  }
}
