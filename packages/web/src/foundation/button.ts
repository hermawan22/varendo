import { css, html, nothing } from 'lit';
import { VarendoActionElement, type VarendoActionType } from './action-base.js';
import { varendoFoundationThemeStyles } from './base.js';

export type VarendoButtonVariant = 'solid' | 'outline' | 'ghost' | 'danger';
export type VarendoButtonSize = 'small' | 'medium' | 'large';

const BUTTON_VARIANTS: ReadonlySet<VarendoButtonVariant> = new Set(['solid', 'outline', 'ghost', 'danger']);

/** Native button behavior with an explicit, cancellable application action proposal. */
export class VarendoButtonElement extends VarendoActionElement {
  static readonly properties = {
    disabled: { type: Boolean, reflect: true },
    pending: { type: Boolean, reflect: true },
    type: { type: String },
    name: { type: String, reflect: true },
    value: { type: String },
    label: { type: String },
    variant: { type: String },
    size: { type: String },
  };

  label = '';
  variant: VarendoButtonVariant = 'solid';
  size: VarendoButtonSize = 'medium';

  override type: VarendoActionType = 'button';

  protected override render() {
    const variant = BUTTON_VARIANTS.has(this.variant) ? this.variant : 'solid';
    const size = this.size === 'small' || this.size === 'large' ? this.size : 'medium';
    return html`
      <button
        part="button"
        type=${this.actionType}
        name=${this.name || nothing}
        value=${this.value || nothing}
        class=${`variant-${variant} size-${size}`}
        ?disabled=${this.actionDisabled}
        aria-busy=${this.pending ? 'true' : nothing}
        @click=${(event: Event) => this.handleActionClick(event, 'button')}
      >
        <slot>${this.label}</slot>
        ${this.pending ? html`<span part="pending" aria-hidden="true"></span>` : nothing}
      </button>
    `;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: inline-block;
        max-inline-size: 100%;
      }

      button {
        align-items: center;
        border: var(--varendo-control-border-width, 0.0625rem) solid transparent;
        border-radius: var(--varendo-radius-medium, 0.625rem);
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: var(--varendo-typography-font-size-sm, 0.875rem);
        gap: var(--varendo-space-8, 0.5rem);
        justify-content: center;
        max-inline-size: 100%;
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-min-target, 2.75rem));
        padding-inline: var(--varendo-control-inline-padding, 0.75rem);
        white-space: normal;
      }

      button.variant-solid {
        background: var(--varendo-color-accent, #4338ca);
        color: var(--varendo-color-on-accent, #fff);
        box-shadow: var(--varendo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
      }

      button.variant-outline {
        background: transparent;
        border-color: var(--varendo-color-accent, #4338ca);
        color: var(--varendo-color-accent, #4338ca);
      }

      button.variant-ghost {
        background: transparent;
        color: var(--varendo-color-accent, #4338ca);
      }

      button.variant-danger {
        background: var(--varendo-color-danger, #b91c1c);
        color: var(--varendo-color-on-accent, #fff);
      }

      button.variant-solid:not(:disabled):hover {
        background: color-mix(in srgb, var(--varendo-color-accent, #4338ca) 90%, var(--varendo-color-on-accent, #fff));
      }

      button.variant-outline:not(:disabled):hover,
      button.variant-ghost:not(:disabled):hover {
        background: var(
          --_varendo-accent-subtle,
          color-mix(in srgb, var(--varendo-color-accent, #4338ca) 8%, transparent)
        );
      }

      button.variant-danger:not(:disabled):hover {
        background: color-mix(in srgb, var(--varendo-color-danger, #b91c1c) 90%, var(--varendo-color-on-accent, #fff));
      }

      button:not(:disabled):active {
        transform: translateY(1px);
      }

      button:disabled {
        background: var(--varendo-color-surface, #f8fafc);
        border-color: var(--_varendo-border-subtle, var(--varendo-color-border, #64748b));
        box-shadow: none;
        color: var(--varendo-color-muted, #4b5563);
        cursor: not-allowed;
      }

      button.size-small {
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-compact-target, 2rem));
        padding-inline: var(--varendo-space-8, 0.5rem);
      }

      button.size-large {
        min-block-size: 3.25rem;
        padding-inline: var(--varendo-space-16, 1rem);
      }

      [part='pending'] {
        animation: varendo-button-pending 0.9s linear infinite;
        block-size: 0.9em;
        border: 0.125rem solid currentColor;
        border-block-end-color: transparent;
        border-radius: 50%;
        inline-size: 0.9em;
      }

      @keyframes varendo-button-pending {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        [part='pending'] {
          animation-duration: 0ms;
        }
      }
      @media (forced-colors: active) {
        button:is(.variant-solid, .variant-outline, .variant-ghost, .variant-danger) {
          background: ButtonFace;
          color: ButtonText;
          border-color: ButtonText;
        }
        button:not(:disabled):hover {
          background: ButtonFace;
        }
        button:disabled {
          color: GrayText;
          border-color: GrayText;
        }
      }
    `,
  ];
}
