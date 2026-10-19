import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { varendoNavigationStyles, emitAction } from './shared.js';

export class VarendoPaginationElement extends VarendoFoundationElement {
  static readonly properties = {
    page: { type: Number },
    pageCount: { type: Number, attribute: 'page-count' },
    hasPrevious: { type: Boolean, attribute: 'has-previous' },
    hasNext: { type: Boolean, attribute: 'has-next' },
    label: { type: String },
    pending: { type: Boolean, reflect: true },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    varendoNavigationStyles,
    css`
      :host {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-8, 0.5rem);
        justify-content: space-between;
      }
      nav {
        align-items: center;
        display: inline-flex;
        gap: var(--varendo-space-4, 0.25rem);
      }
      button {
        background: var(--varendo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--varendo-color-border, #64748b);
        border-radius: var(--varendo-radius-small, 0.375rem);
        cursor: pointer;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        min-inline-size: var(--varendo-control-min-target, 2.75rem);
        padding-inline: var(--varendo-space-8, 0.5rem);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      [part='status'] {
        color: var(--varendo-color-muted, #4b5563);
      }
    `,
  ];

  page = 1;
  pageCount?: number;
  hasPrevious = false;
  hasNext = false;
  label = 'Pagination';
  pending = false;

  private normalizedPage(): number {
    return Number.isSafeInteger(this.page) && this.page > 0 ? this.page : 1;
  }

  private normalizedPageCount(): number | undefined {
    return Number.isSafeInteger(this.pageCount) && this.pageCount! > 0 ? this.pageCount : undefined;
  }

  private move(direction: 'previous' | 'next'): void {
    const page = this.normalizedPage();
    const pageCount = this.normalizedPageCount();
    const next = direction === 'next' ? page + 1 : Math.max(1, page - 1);
    const allowed = direction === 'next' ? this.hasNext : this.hasPrevious;
    if (this.pending || !allowed || (pageCount !== undefined && next > pageCount)) return;
    if (!emitAction(this, 'varendo-page-change', { page: next, previousPage: page, direction })) return;
    this.page = next;
  }

  protected override render() {
    const page = this.normalizedPage();
    const pageCount = this.normalizedPageCount();
    const total = pageCount === undefined ? '' : ` of ${pageCount}`;
    const atFirst = page <= 1;
    const atLast = pageCount !== undefined && page >= pageCount;
    return html`<nav aria-label=${this.label}>
      <button
        part="previous"
        type="button"
        aria-label="Previous page"
        ?disabled=${this.pending || !this.hasPrevious || atFirst}
        @click=${() => this.move('previous')}
      >
        ‹
      </button>
      <span part="status" aria-live="polite">Page ${page}${total}</span>
      <button
        part="next"
        type="button"
        aria-label="Next page"
        ?disabled=${this.pending || !this.hasNext || atLast}
        @click=${() => this.move('next')}
      >
        ›
      </button>
    </nav>`;
  }
}
