import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from './base.js';

export type AeliqoTextAs = 'span' | 'p' | 'div' | 'small' | 'strong' | 'em' | 'label';

const textRenderers = {
  span: (content: unknown, className: string) => html`<span part="text" class=${className}>${content}</span>`,
  p: (content: unknown, className: string) => html`<p part="text" class=${className}>${content}</p>`,
  div: (content: unknown, className: string) => html`<div part="text" class=${className}>${content}</div>`,
  small: (content: unknown, className: string) => html`<small part="text" class=${className}>${content}</small>`,
  strong: (content: unknown, className: string) => html`<strong part="text" class=${className}>${content}</strong>`,
  em: (content: unknown, className: string) => html`<em part="text" class=${className}>${content}</em>`,
  label: (content: unknown, className: string) => html`<label part="text" class=${className}>${content}</label>`,
} satisfies Record<AeliqoTextAs, (content: unknown, className: string) => ReturnType<typeof html>>;

/** Plain text primitive. Text is interpolated as text, never as HTML. */
export class AeliqoTextElement extends AeliqoFoundationElement {
  static readonly properties = {
    text: { type: String },
    as: { type: String },
    muted: { type: Boolean, reflect: true },
  };

  text = '';
  as: AeliqoTextAs = 'span';
  muted = false;

  protected override render() {
    const content = html`<slot>${this.text}</slot>`;
    const renderer = textRenderers[this.as] ?? textRenderers.span;
    return renderer(content, this.muted ? 'muted' : '');
  }

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: inline;
        max-inline-size: 100%;
      }
      [part='text'] {
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .muted {
        color: var(--aeliqo-color-muted, #4b5563);
      }
    `,
  ];
}
