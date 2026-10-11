import { css, html, nothing } from 'lit';
import { AeliqoActionElement, type AeliqoActionType } from './action-base.js';
import { aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoIconButtonSize = 'small' | 'medium' | 'large';

/** Compact native button whose accessible name is supplied independently of its icon slot. */
export class AeliqoIconButtonElement extends AeliqoActionElement {
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
  size: AeliqoIconButtonSize = 'medium';
  override type: AeliqoActionType = 'button';

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
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        align-items: center;
        background: transparent;
        border: var(--aeliqo-control-border-width, 0.0625rem) solid var(--aeliqo-color-border, #64748b);
        border-radius: 50%;
        color: var(--aeliqo-color-text, #111827);
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: var(--aeliqo-typography-font-size-sm, 0.875rem);
        inline-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
        justify-content: center;
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
        padding: var(--aeliqo-space-8, 0.5rem);
      }

      button.size-small {
        inline-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-compact-target, 2rem));
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-compact-target, 2rem));
        padding: var(--aeliqo-space-4, 0.25rem);
      }

      button.size-large {
        inline-size: 3.25rem;
        min-block-size: 3.25rem;
      }

      button:not(:disabled):hover {
        background: var(--aeliqo-color-surface, #f8fafc);
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
        animation: aeliqo-icon-pending 0.9s linear infinite;
        block-size: 0.9em;
        border: 0.125rem solid currentColor;
        border-block-end-color: transparent;
        border-radius: 50%;
        inline-size: 0.9em;
        position: absolute;
      }

      @keyframes aeliqo-icon-pending {
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
