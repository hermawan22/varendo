import { css, html, nothing } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles, safeResolvedHref } from './base.js';
import { VarendoLinkEvent } from './events.js';

export type VarendoLinkTarget = '_self' | '_blank';

/** Application-resolved link. It never interprets an arbitrary model URL as a destination. */
export class VarendoLinkElement extends VarendoFoundationElement {
  static readonly properties = {
    href: { type: String },
    target: { type: String },
    label: { type: String },
    disabled: { type: Boolean, reflect: true },
  };

  href = '';
  target: VarendoLinkTarget = '_self';
  label = '';
  disabled = false;

  protected override render() {
    const resolved = this.disabled ? undefined : safeResolvedHref(this.href);
    if (resolved === undefined) {
      return html`<span part="link" aria-disabled=${this.disabled ? 'true' : nothing}
        ><slot>${this.label}</slot></span
      >`;
    }
    const target = this.target === '_blank' ? '_blank' : '_self';
    return html`
      <a
        part="link"
        href=${resolved}
        target=${target}
        rel=${target === '_blank' ? 'noopener noreferrer' : nothing}
        @click=${this.handleClick}
        ><slot>${this.label}</slot></a
      >
    `;
  }

  private readonly handleClick = (event: Event): void => {
    const modified =
      event instanceof MouseEvent &&
      (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0);
    const accepted = this.dispatchEvent(
      new VarendoLinkEvent({
        source: 'user',
        target: this.target === '_blank' ? '_blank' : '_self',
        ...(modified ? { modified: true } : {}),
      }),
    );
    if (!accepted) event.preventDefault();
  };

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        display: inline;
      }

      [part='link'] {
        color: var(--varendo-color-accent, #4338ca);
        overflow-wrap: anywhere;
        text-decoration-thickness: 0.1em;
        text-underline-offset: 0.15em;
      }

      a:hover {
        color: var(--varendo-color-info, #1d4ed8);
      }

      span[aria-disabled='true'] {
        color: var(--varendo-color-muted, #4b5563);
        cursor: not-allowed;
      }
    `,
  ];
}
