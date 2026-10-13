import { css, html, LitElement, nothing } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import { safeResolvedHref } from '../foundation/base.js';
import type { VarendoDataScope, VarendoDataStatus, VarendoDataValue } from './types.js';
import { dataStyles, dataValueText, scopeText, statusTemplate } from './shared.js';

export interface VarendoKeyValueItem {
  readonly key: string;
  readonly label: string;
  readonly value?: VarendoDataValue;
  readonly displayValue?: string;
  /** Application-resolved destination; unsafe protocols are rendered as text. */
  readonly href?: string;
  readonly description?: string;
}

/** Ordered facts rendered with native definition-list semantics. */
export class VarendoKeyValueElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    items: { attribute: false },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  items: readonly VarendoKeyValueItem[] = [];
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';

  protected override render() {
    const scope = scopeText(this.scope);
    return html`
      <dl part="list" data-status=${this.status}>${this.items.map((item) => this.renderItem(item))}</dl>
      ${scope ? html`<p part="scope">${scope}</p>` : nothing}
      ${this.status === 'ready' ? nothing : statusTemplate(this.status, this.message)}
    `;
  }

  private renderItem(item: VarendoKeyValueItem) {
    const descriptionId = item.description ? `description-${item.key.replace(/[^a-zA-Z0-9_-]/gu, '-')}` : undefined;
    const text = item.displayValue ?? dataValueText(item.value);
    const href = safeResolvedHref(item.href);
    return html`
      <div part="item" data-key=${item.key}>
        <dt part="label">${item.label}</dt>
        <dd part="value" aria-describedby=${descriptionId ?? nothing}>
          ${href ? html`<a part="link" href=${href}>${text}</a>` : text}
        </dd>
        ${item.description ? html`<dd id=${descriptionId} part="description">${item.description}</dd>` : nothing}
      </div>
    `;
  }

  static readonly styles = [
    varendoThemeStyles,
    dataStyles,
    css`
      dl {
        display: grid;
        gap: var(--varendo-space-12, 0.75rem);
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        margin: 0;
      }
      [part='item'] {
        min-inline-size: 0;
      }
      dt {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
        overflow-wrap: anywhere;
      }
      dd {
        margin: var(--varendo-space-4, 0.25rem) 0 0;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--varendo-color-accent, #4338ca);
      }
      [part='description'],
      [part='scope'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
        margin-block-start: var(--varendo-space-4, 0.25rem);
        overflow-wrap: anywhere;
      }
      [part='scope'] {
        margin-block-end: 0;
      }
    `,
  ];
}
