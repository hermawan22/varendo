import { css, html, nothing } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from './base.js';

export type VarendoSeparatorOrientation = 'horizontal' | 'vertical';

/** Native hr for semantic horizontal separation; a nonfocusable div for decorative/vertical rules. */
export class VarendoSeparatorElement extends VarendoFoundationElement {
  static readonly properties = {
    orientation: { type: String, reflect: true },
    decorative: { type: Boolean, reflect: true },
  };

  orientation: VarendoSeparatorOrientation = 'horizontal';
  decorative = true;

  protected override render() {
    const vertical = this.orientation === 'vertical';
    if (!vertical && !this.decorative) return html`<hr part="separator" aria-orientation="horizontal" />`;
    const orientation = vertical ? 'vertical' : 'horizontal';
    return html`<div
      part="separator"
      role=${this.decorative ? nothing : 'separator'}
      aria-orientation=${this.decorative ? nothing : orientation}
    ></div>`;
  }

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: block;
      }
      [part='separator'] {
        background: var(--varendo-color-border, #64748b);
        border: 0;
        margin: 0;
      }
      hr[part='separator'] {
        block-size: var(--varendo-control-border-width, 0.0625rem);
        inline-size: 100%;
      }
      div[part='separator'] {
        block-size: var(--varendo-control-border-width, 0.0625rem);
        inline-size: 100%;
      }
      :host([orientation='vertical']) {
        align-self: stretch;
      }
      :host([orientation='vertical']) div[part='separator'] {
        block-size: 100%;
        inline-size: var(--varendo-control-border-width, 0.0625rem);
      }
    `,
  ];
}
