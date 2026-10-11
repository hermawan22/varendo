import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoSeparatorOrientation = 'horizontal' | 'vertical';

/** Native hr for semantic horizontal separation; a nonfocusable div for decorative/vertical rules. */
export class AeliqoSeparatorElement extends AeliqoFoundationElement {
  static readonly properties = {
    orientation: { type: String, reflect: true },
    decorative: { type: Boolean, reflect: true },
  };

  orientation: AeliqoSeparatorOrientation = 'horizontal';
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
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: block;
      }
      [part='separator'] {
        background: var(--aeliqo-color-border, #64748b);
        border: 0;
        margin: 0;
      }
      hr[part='separator'] {
        block-size: var(--aeliqo-control-border-width, 0.0625rem);
        inline-size: 100%;
      }
      div[part='separator'] {
        block-size: var(--aeliqo-control-border-width, 0.0625rem);
        inline-size: 100%;
      }
      :host([orientation='vertical']) {
        align-self: stretch;
      }
      :host([orientation='vertical']) div[part='separator'] {
        block-size: 100%;
        inline-size: var(--aeliqo-control-border-width, 0.0625rem);
      }
    `,
  ];
}
