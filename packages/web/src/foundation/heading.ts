import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type AeliqoHeadingSize = 'display' | 'heading' | 'title' | 'body';

const HEADING_SIZES: ReadonlySet<AeliqoHeadingSize> = new Set(['display', 'heading', 'title', 'body']);

/** Heading level controls document hierarchy; visual size is independently selectable. */
export class AeliqoHeadingElement extends AeliqoFoundationElement {
  static readonly properties = {
    level: { type: Number },
    size: { type: String },
    text: { type: String },
  };

  level: AeliqoHeadingLevel = 2;
  size: AeliqoHeadingSize = 'heading';
  text = '';

  protected override render() {
    const size = HEADING_SIZES.has(this.size) ? this.size : 'heading';
    const content = html`<slot>${this.text}</slot>`;
    switch (this.level) {
      case 1:
        return html`<h1 part="heading" class=${size}>${content}</h1>`;
      case 3:
        return html`<h3 part="heading" class=${size}>${content}</h3>`;
      case 4:
        return html`<h4 part="heading" class=${size}>${content}</h4>`;
      case 5:
        return html`<h5 part="heading" class=${size}>${content}</h5>`;
      case 6:
        return html`<h6 part="heading" class=${size}>${content}</h6>`;
      default:
        return html`<h2 part="heading" class=${size}>${content}</h2>`;
    }
  }

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: block;
        max-inline-size: 100%;
      }
      [part='heading'] {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .display {
        font-size: var(--aeliqo-typography-font-size-display, 2rem);
        line-height: var(--aeliqo-typography-line-height-tight, 1.25);
      }
      .heading {
        font-size: var(--aeliqo-typography-font-size-heading, 1.5rem);
        line-height: var(--aeliqo-typography-line-height-tight, 1.25);
      }
      .title {
        font-size: var(--aeliqo-typography-font-size-title, 1.25rem);
        line-height: var(--aeliqo-typography-line-height-tight, 1.25);
      }
      .body {
        font-size: var(--aeliqo-typography-font-size-body-large, 1rem);
        line-height: var(--aeliqo-typography-line-height-normal, 1.5);
      }
    `,
  ];
}
