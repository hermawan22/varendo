import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoStackDirection = 'row' | 'column';
export type VarendoStackGap = 0 | 4 | 8 | 12 | 16 | 24 | 32 | 48;
export type VarendoStackAlign = 'start' | 'center' | 'end' | 'stretch';
export type VarendoStackJustify = 'start' | 'center' | 'end' | 'between';

const STACK_ALIGNS: ReadonlySet<VarendoStackAlign> = new Set(['start', 'center', 'end', 'stretch']);
const STACK_JUSTIFIES: ReadonlySet<VarendoStackJustify> = new Set(['start', 'center', 'end', 'between']);
const STACK_GAPS: ReadonlySet<VarendoStackGap> = new Set([0, 4, 8, 12, 16, 24, 32, 48]);

export class VarendoStackElement extends VarendoFoundationElement {
  static readonly properties = {
    direction: { type: String },
    gap: { type: Number },
    align: { type: String },
    justify: { type: String },
    wrap: { type: Boolean, reflect: true },
  };

  direction: VarendoStackDirection = 'column';
  gap: VarendoStackGap = 16;
  align: VarendoStackAlign = 'stretch';
  justify: VarendoStackJustify = 'start';
  wrap = false;

  protected override render() {
    const direction = this.direction === 'row' ? 'row' : 'column';
    const align = STACK_ALIGNS.has(this.align) ? this.align : 'stretch';
    const justify = STACK_JUSTIFIES.has(this.justify) ? this.justify : 'start';
    const gap = STACK_GAPS.has(this.gap) ? this.gap : 16;
    return html`<div
      part="stack"
      class=${`direction-${direction} align-${align} justify-${justify} gap-${gap}`}
      ?data-wrap=${this.wrap}
    >
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
      [part='stack'] {
        display: flex;
        min-inline-size: 0;
      }
      .direction-row {
        flex-direction: row;
      }
      .direction-column {
        flex-direction: column;
      }
      .align-start {
        align-items: flex-start;
      }
      .align-center {
        align-items: center;
      }
      .align-end {
        align-items: flex-end;
      }
      .align-stretch {
        align-items: stretch;
      }
      .justify-start {
        justify-content: flex-start;
      }
      .justify-center {
        justify-content: center;
      }
      .justify-end {
        justify-content: flex-end;
      }
      .justify-between {
        justify-content: space-between;
      }
      [data-wrap] {
        flex-wrap: wrap;
      }
      .gap-0 {
        gap: 0;
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
