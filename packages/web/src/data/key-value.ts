import { css, html, LitElement, nothing } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';
import { safeResolvedHref } from '../foundation/base.js';
import type { AeliqoDataScope, AeliqoDataStatus, AeliqoDataValue } from './types.js';
import { dataStyles, dataValueText, scopeText, statusTemplate } from './shared.js';

export interface AeliqoKeyValueItem {
  readonly key: string;
  readonly label: string;
  readonly value?: AeliqoDataValue;
  readonly displayValue?: string;
  /** Application-resolved destination; unsafe protocols are rendered as text. */
  readonly href?: string;
  readonly description?: string;
}

/** Ordered facts rendered with native definition-list semantics. */
export class AeliqoKeyValueElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
  static readonly properties = {
    items: { attribute: false },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  items: readonly AeliqoKeyValueItem[] = [];
  scope: AeliqoDataScope | undefined = undefined;
  status: AeliqoDataStatus = 'ready';
  message = '';

  protected override render() {
    const scope = scopeText(this.scope);
    return html`
      <dl part="list" data-status=${this.status}>${this.items.map((item) => this.renderItem(item))}</dl>
      ${scope ? html`<p part="scope">${scope}</p>` : nothing}
      ${this.status === 'ready' ? nothing : statusTemplate(this.status, this.message)}
    `;
  }

  private renderItem(item: AeliqoKeyValueItem) {
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
    aeliqoThemeStyles,
    dataStyles,
    css`
      dl {
        display: grid;
        gap: var(--aeliqo-space-12, 0.75rem);
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        margin: 0;
      }
      [part='item'] {
        min-inline-size: 0;
      }
      dt {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
        overflow-wrap: anywhere;
      }
      dd {
        margin: var(--aeliqo-space-4, 0.25rem) 0 0;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--aeliqo-color-accent, #4338ca);
      }
      [part='description'],
      [part='scope'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
        margin-block-start: var(--aeliqo-space-4, 0.25rem);
        overflow-wrap: anywhere;
      }
      [part='scope'] {
        margin-block-end: 0;
      }
    `,
  ];
}
