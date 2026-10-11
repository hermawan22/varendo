import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoSurfaceAs = 'div' | 'section' | 'article';
export type AeliqoSurfaceTone = 'canvas' | 'surface' | 'raised';

/** Bounded chrome primitive; it does not impose card semantics on its children. */
export class AeliqoSurfaceElement extends AeliqoFoundationElement {
  static readonly properties = {
    as: { type: String },
    tone: { type: String },
    labelledBy: { attribute: 'labelled-by', type: String },
    label: { type: String },
  };

  as: AeliqoSurfaceAs = 'div';
  tone: AeliqoSurfaceTone = 'surface';
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
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      [part='surface'] {
        min-inline-size: 0;
      }
      .tone-surface {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: var(--aeliqo-control-border-width, 0.0625rem) solid
          var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #64748b));
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        padding: var(--aeliqo-space-16, 1rem);
      }
      .tone-raised {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: var(--aeliqo-control-border-width, 0.0625rem) solid
          var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #64748b));
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        box-shadow: var(--aeliqo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        padding: var(--aeliqo-space-16, 1rem);
      }
      .tone-canvas {
        background: var(--aeliqo-color-canvas, #fff);
      }
    `,
  ];
}
