import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_TONES: ReadonlySet<VarendoBadgeTone> = new Set(['neutral', 'info', 'success', 'warning', 'danger']);

/** Text-first status/category marker; tone never carries the only meaning. */
export class VarendoBadgeElement extends VarendoFoundationElement {
  static readonly properties = {
    text: { type: String },
    tone: { type: String },
  };

  text = '';
  tone: VarendoBadgeTone = 'neutral';

  protected override render() {
    const tone = BADGE_TONES.has(this.tone) ? this.tone : 'neutral';
    return html`<span part="badge" class=${`tone-${tone}`}><slot>${this.text}</slot></span>`;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: inline-block;
        max-inline-size: 100%;
      }
      [part='badge'] {
        background: var(--varendo-color-surface, #f8fafc);
        border: var(--varendo-control-border-width, 0.0625rem) solid
          var(--_varendo-border-subtle, var(--varendo-color-border, #64748b));
        border-radius: 999px;
        color: var(--varendo-color-text, #111827);
        display: inline-flex;
        font-size: var(--varendo-typography-font-size-caption, 0.75rem);
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
        line-height: var(--varendo-typography-line-height-tight, 1.25);
        max-inline-size: 100%;
        overflow-wrap: anywhere;
        padding: var(--varendo-space-4, 0.25rem) var(--varendo-space-8, 0.5rem);
      }
      .tone-info {
        background: var(--_varendo-info-subtle, var(--varendo-color-surface, #f8fafc));
        border-color: color-mix(in srgb, var(--varendo-color-info, #1d4ed8) 28%, var(--varendo-color-surface, #f8fafc));
        color: var(--varendo-color-info, #1d4ed8);
      }
      .tone-success {
        background: color-mix(in srgb, var(--varendo-color-success, #166534) 8%, var(--varendo-color-surface, #f8fafc));
        border-color: color-mix(
          in srgb,
          var(--varendo-color-success, #166534) 28%,
          var(--varendo-color-surface, #f8fafc)
        );
        color: var(--varendo-color-success, #166534);
      }
      .tone-warning {
        background: var(--_varendo-warning-subtle, var(--varendo-color-surface, #f8fafc));
        border-color: color-mix(
          in srgb,
          var(--varendo-color-warning, #854d0e) 28%,
          var(--varendo-color-surface, #f8fafc)
        );
        color: var(--varendo-color-warning, #854d0e);
      }
      .tone-danger {
        background: var(--_varendo-danger-subtle, var(--varendo-color-surface, #f8fafc));
        border-color: color-mix(
          in srgb,
          var(--varendo-color-danger, #b91c1c) 28%,
          var(--varendo-color-surface, #f8fafc)
        );
        color: var(--varendo-color-danger, #b91c1c);
      }
    `,
  ];
}
