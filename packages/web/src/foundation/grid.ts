import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoGridColumns = 1 | 2 | 3 | 4 | 5 | 6;
export type AeliqoGridGap = 4 | 8 | 12 | 16 | 24 | 32 | 48;

const GRID_COLUMNS: ReadonlySet<AeliqoGridColumns> = new Set([1, 2, 3, 4, 5, 6]);
const GRID_GAPS: ReadonlySet<AeliqoGridGap> = new Set([4, 8, 12, 16, 24, 32, 48]);

export class AeliqoGridElement extends AeliqoFoundationElement {
  static readonly properties = {
    columns: { type: Number },
    gap: { type: Number },
    minItem: { attribute: 'min-item', type: String },
  };

  columns: AeliqoGridColumns = 2;
  gap: AeliqoGridGap = 16;
  minItem: 'small' | 'medium' | 'large' = 'medium';

  protected override render() {
    const columns = GRID_COLUMNS.has(this.columns) ? this.columns : 2;
    const gap = GRID_GAPS.has(this.gap) ? this.gap : 16;
    const minItem = this.minItem === 'small' || this.minItem === 'large' ? this.minItem : 'medium';
    return html`<div part="grid" class=${`gap-${gap} min-${minItem}`} style=${`--aeliqo-grid-columns:${columns}`}>
      <slot></slot>
    </div>`;
  }

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      [part='grid'] {
        display: grid;
        grid-template-columns: repeat(var(--aeliqo-grid-columns, 2), minmax(0, 1fr));
        min-inline-size: 0;
      }
      @media (max-width: 48rem) {
        .min-small {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
        }
        .min-medium {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        }
        .min-large {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
        }
      }
      .gap-4 {
        gap: var(--aeliqo-space-4, 0.25rem);
      }
      .gap-8 {
        gap: var(--aeliqo-space-8, 0.5rem);
      }
      .gap-12 {
        gap: var(--aeliqo-space-12, 0.75rem);
      }
      .gap-16 {
        gap: var(--aeliqo-space-16, 1rem);
      }
      .gap-24 {
        gap: var(--aeliqo-space-24, 1.5rem);
      }
      .gap-32 {
        gap: var(--aeliqo-space-32, 2rem);
      }
      .gap-48 {
        gap: var(--aeliqo-space-48, 3rem);
      }
    `,
  ];
}
