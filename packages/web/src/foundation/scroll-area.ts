import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoScrollAreaAxis = 'x' | 'y' | 'both';

/** Native overflow region with an optional accessible name and keyboard focus. */
export class VarendoScrollAreaElement extends VarendoFoundationElement {
  static readonly properties = {
    axis: { type: String },
    label: { type: String },
    tabIndex: { attribute: 'tabindex', type: Number },
  };

  axis: VarendoScrollAreaAxis = 'y';
  label = '';
  tabIndex = 0;

  protected override render() {
    const axis = this.axis === 'x' || this.axis === 'both' ? this.axis : 'y';
    const label = this.label || 'Scrollable content';
    return html`<div part="scroll" class=${`axis-${axis}`} tabindex=${this.tabIndex} role="region" aria-label=${label}>
      <slot></slot>
    </div>`;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-block-size: 0;
        min-inline-size: 0;
      }
      [part='scroll'] {
        block-size: 100%;
        inline-size: 100%;
        max-block-size: 100%;
        max-inline-size: 100%;
        min-block-size: 0;
        min-inline-size: 0;
        outline-offset: var(--varendo-focus-offset, 0.125rem);
      }
      .axis-x {
        overflow-x: auto;
        overflow-y: hidden;
      }
      .axis-y {
        overflow-x: hidden;
        overflow-y: auto;
      }
      .axis-both {
        overflow: auto;
      }
    `,
  ];
}
