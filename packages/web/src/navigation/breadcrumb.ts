import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles, safeResolvedHref } from '../foundation/base.js';
import { aeliqoNavigationStyles, emitAction } from './shared.js';

export interface AeliqoBreadcrumbItem {
  readonly id: string;
  readonly label: string;
  /** A host-resolved route. Arbitrary model destinations are not accepted. */
  readonly href?: string;
  readonly current?: boolean;
}

export class AeliqoBreadcrumbElement extends AeliqoFoundationElement {
  static readonly properties = { items: { attribute: false }, label: { type: String } };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    aeliqoNavigationStyles,
    css`
      nav {
        max-inline-size: 100%;
        overflow-x: auto;
      }
      ol {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-8, 0.5rem);
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        align-items: center;
        display: inline-flex;
        gap: var(--aeliqo-space-8, 0.5rem);
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
      }
      li:not(:last-child)::after {
        color: var(--aeliqo-color-muted, #4b5563);
        content: '/';
      }
      a {
        color: var(--aeliqo-color-accent, #4338ca);
        overflow-wrap: anywhere;
      }
      [aria-current='page'] {
        color: var(--aeliqo-color-text, #111827);
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
    `,
  ];

  items: readonly AeliqoBreadcrumbItem[] = [];
  label = 'Breadcrumb';

  private navigate(item: AeliqoBreadcrumbItem, event: Event): void {
    if (!emitAction(this, 'aeliqo-navigation', { id: item.id, href: item.href })) event.preventDefault();
  }

  protected override render() {
    const hasExplicitCurrent = this.items.some((candidate) => candidate.current === true);
    return html`<nav aria-label=${this.label}>
      <ol>
        ${this.items.map((item, index) => {
          const current = item.current === true || (!hasExplicitCurrent && index === this.items.length - 1);
          const href = current ? undefined : safeResolvedHref(item.href);
          return html`<li data-item-id=${item.id}>
            ${
              href === undefined || current
                ? html`<span part="item" aria-current=${current ? 'page' : nothing}>${item.label}</span>`
                : html`<a part="item" href=${href} @click=${(event: Event) => this.navigate(item, event)}
                    >${item.label}</a
                  >`
            }
          </li>`;
        })}
      </ol>
    </nav>`;
  }
}
