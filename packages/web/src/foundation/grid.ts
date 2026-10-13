import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoGridColumns = 1 | 2 | 3 | 4 | 5 | 6;
export type VarendoGridGap = 4 | 8 | 12 | 16 | 24 | 32 | 48;

const GRID_COLUMNS: ReadonlySet<VarendoGridColumns> = new Set([1, 2, 3, 4, 5, 6]);
const GRID_GAPS: ReadonlySet<VarendoGridGap> = new Set([4, 8, 12, 16, 24, 32, 48]);

export class VarendoGridElement extends VarendoFoundationElement {
  static readonly properties = {
    columns: { type: Number },
    gap: { type: Number },
    minItem: { attribute: 'min-item', type: String },
  };

  columns: VarendoGridColumns = 2;
  gap: VarendoGridGap = 16;
  minItem: 'small' | 'medium' | 'large' = 'medium';

  protected override render() {
    const columns = GRID_COLUMNS.has(this.columns) ? this.columns : 2;
    const gap = GRID_GAPS.has(this.gap) ? this.gap : 16;
    const minItem = this.minItem === 'small' || this.minItem === 'large' ? this.minItem : 'medium';
    return html`<div part="grid" class=${`gap-${gap} min-${minItem}`} style=${`--varendo-grid-columns:${columns}`}>
      <slot></slot>
    </div>`;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      [part='grid'] {
        display: grid;
        grid-template-columns: repeat(var(--varendo-grid-columns, 2), minmax(0, 1fr));
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
        gap: var(--varendo-space-4, 0.25rem);
      }
      .gap-8 {
        gap: var(--varendo-space-8, 0.5rem);
      }
      .gap-12 {
        gap: var(--varendo-space-12, 0.75rem);
      }
      .gap-16 {
        gap: var(--varendo-space-16, 1rem);
      }
      .gap-24 {
        gap: var(--varendo-space-24, 1.5rem);
      }
      .gap-32 {
        gap: var(--varendo-space-32, 2rem);
      }
      .gap-48 {
        gap: var(--varendo-space-48, 3rem);
      }
    `,
  ];
}
