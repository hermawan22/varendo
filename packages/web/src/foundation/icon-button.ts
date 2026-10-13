import { css, html, nothing } from 'lit';
import { VarendoActionElement, type VarendoActionType } from './action-base.js';
import { varendoFoundationThemeStyles } from './base.js';

export type VarendoIconButtonSize = 'small' | 'medium' | 'large';

/** Compact native button whose accessible name is supplied independently of its icon slot. */
export class VarendoIconButtonElement extends VarendoActionElement {
  static readonly properties = {
    disabled: { type: Boolean, reflect: true },
    pending: { type: Boolean, reflect: true },
    type: { type: String },
    name: { type: String, reflect: true },
    value: { type: String },
    label: { type: String },
    size: { type: String },
  };

  label = 'Action';
  size: VarendoIconButtonSize = 'medium';
  override type: VarendoActionType = 'button';

  protected override render() {
    const size = this.size === 'small' || this.size === 'large' ? this.size : 'medium';
    return html`
      <button
        part="button"
        type=${this.actionType}
        name=${this.name || nothing}
        value=${this.value || nothing}
        class=${`size-${size}`}
        ?disabled=${this.actionDisabled}
        aria-label=${this.label || 'Action'}
        aria-busy=${this.pending ? 'true' : nothing}
        @click=${(event: Event) => this.handleActionClick(event, 'icon-button')}
      >
        <span part="icon"><slot name="icon"></slot></span>
        ${this.pending ? html`<span part="pending" aria-hidden="true"></span>` : nothing}
      </button>
    `;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        align-items: center;
        background: transparent;
        border: var(--varendo-control-border-width, 0.0625rem) solid var(--varendo-color-border, #64748b);
        border-radius: 50%;
        color: var(--varendo-color-text, #111827);
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: var(--varendo-typography-font-size-sm, 0.875rem);
        inline-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-min-target, 2.75rem));
        justify-content: center;
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-min-target, 2.75rem));
        padding: var(--varendo-space-8, 0.5rem);
      }

      button.size-small {
        inline-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-compact-target, 2rem));
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-compact-target, 2rem));
        padding: var(--varendo-space-4, 0.25rem);
      }

      button.size-large {
        inline-size: 3.25rem;
        min-block-size: 3.25rem;
      }

      button:not(:disabled):hover {
        background: var(--varendo-color-surface, #f8fafc);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.62;
      }

      [part='icon'] {
        align-items: center;
        display: inline-flex;
        justify-content: center;
        line-height: 1;
      }

      [part='pending'] {
        animation: varendo-icon-pending 0.9s linear infinite;
        block-size: 0.9em;
        border: 0.125rem solid currentColor;
        border-block-end-color: transparent;
        border-radius: 50%;
        inline-size: 0.9em;
        position: absolute;
      }

      @keyframes varendo-icon-pending {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        [part='pending'] {
          animation-duration: 0ms;
        }
      }
    `,
  ];
}
