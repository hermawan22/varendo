import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoSurfaceAs = 'div' | 'section' | 'article';
export type VarendoSurfaceTone = 'canvas' | 'surface' | 'raised';

/** Bounded chrome primitive; it does not impose card semantics on its children. */
export class VarendoSurfaceElement extends VarendoFoundationElement {
  static readonly properties = {
    as: { type: String },
    tone: { type: String },
    labelledBy: { attribute: 'labelled-by', type: String },
    label: { type: String },
  };

  as: VarendoSurfaceAs = 'div';
  tone: VarendoSurfaceTone = 'surface';
  labelledBy = '';
  label = '';

  protected override willUpdate(): void {
    const labelledBy = this.labelledBy.trim();
    const label = this.label.trim();
    if (labelledBy.length > 0) {
      this.setAttribute('role', 'region');
      this.setAttribute('aria-labelledby', labelledBy);
      this.removeAttribute('aria-label');
    } else if (label.length > 0) {
      this.setAttribute('role', 'region');
      this.setAttribute('aria-label', label);
      this.removeAttribute('aria-labelledby');
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.removeAttribute('aria-labelledby');
    }
  }

  protected override render() {
    const tone = this.tone === 'canvas' || this.tone === 'raised' ? this.tone : 'surface';
    const content = html`<slot></slot>`;
    switch (this.as) {
      case 'section':
        return html`<section part="surface" class=${`tone-${tone}`}>${content}</section>`;
      case 'article':
        return html`<article part="surface" class=${`tone-${tone}`}>${content}</article>`;
      default:
        return html`<div part="surface" class=${`tone-${tone}`}>${content}</div>`;
    }
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      [part='surface'] {
        min-inline-size: 0;
      }
      .tone-surface {
        background: var(--varendo-color-surface, #f8fafc);
        border: var(--varendo-control-border-width, 0.0625rem) solid
          var(--_varendo-border-subtle, var(--varendo-color-border, #64748b));
        border-radius: var(--varendo-radius-medium, 0.625rem);
        padding: var(--varendo-space-16, 1rem);
      }
      .tone-raised {
        background: var(--varendo-color-surface, #f8fafc);
        border: var(--varendo-control-border-width, 0.0625rem) solid
          var(--_varendo-border-subtle, var(--varendo-color-border, #64748b));
        border-radius: var(--varendo-radius-medium, 0.625rem);
        box-shadow: var(--varendo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        padding: var(--varendo-space-16, 1rem);
      }
      .tone-canvas {
        background: var(--varendo-color-canvas, #fff);
      }
    `,
  ];
}
