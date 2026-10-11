import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles, imageHref, initialsForName } from './base.js';

export type AeliqoAvatarSize = 'small' | 'medium' | 'large';

/** Optional image with a privacy-safe text fallback and explicit decorative mode. */
export class AeliqoAvatarElement extends AeliqoFoundationElement {
  static readonly properties = {
    name: { type: String },
    src: { type: String },
    alt: { type: String },
    size: { type: String },
    decorative: { type: Boolean, reflect: true },
  };

  name = '';
  src = '';
  alt = '';
  size: AeliqoAvatarSize = 'medium';
  decorative = false;
  private imageFailed = false;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('src')) this.imageFailed = false;
  }

  protected override render() {
    const size = this.size === 'small' || this.size === 'large' ? this.size : 'medium';
    const image = imageHref(this.src);
    const accessibleAlt = this.decorative ? '' : this.alt || (this.name ? `${this.name} avatar` : 'Avatar');
    return html`
      <span
        part="avatar"
        class=${`size-${size}`}
        role=${this.decorative ? nothing : 'img'}
        aria-label=${this.decorative ? nothing : accessibleAlt}
      >
        ${image !== undefined && !this.imageFailed ? html`<img part="image" src=${image} alt="" @error=${this.handleImageError} />` : nothing}
        ${image === undefined || this.imageFailed ? html`<span part="initials" aria-hidden="true">${initialsForName(this.name)}</span>` : nothing}
      </span>
    `;
  }

  private readonly handleImageError = (): void => {
    this.imageFailed = true;
    this.requestUpdate();
  };

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: inline-block;
      }
      [part='avatar'] {
        align-items: center;
        background: var(--aeliqo-color-accent, #4338ca);
        border-radius: 50%;
        color: var(--aeliqo-color-on-accent, #fff);
        display: inline-flex;
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        justify-content: center;
        overflow: hidden;
        vertical-align: middle;
      }
      .size-small {
        block-size: 2rem;
        font-size: var(--aeliqo-typography-font-size-caption, 0.75rem);
        inline-size: 2rem;
      }
      .size-medium {
        block-size: 2.75rem;
        font-size: var(--aeliqo-typography-font-size-body, 0.875rem);
        inline-size: 2.75rem;
      }
      .size-large {
        block-size: 3.5rem;
        font-size: var(--aeliqo-typography-font-size-body-large, 1rem);
        inline-size: 3.5rem;
      }
      [part='image'] {
        block-size: 100%;
        inline-size: 100%;
        object-fit: cover;
      }
      @media (forced-colors: active) {
        [part='avatar'] {
          background: Canvas;
          color: CanvasText;
          border: 1px solid CanvasText;
        }
      }
    `,
  ];
}
