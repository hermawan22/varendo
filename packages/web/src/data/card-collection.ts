import { css, html, LitElement, nothing } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import type { ResultRef } from '@varendo/core';
import type {
  VarendoDataColumn,
  VarendoDataRecord,
  VarendoDataScope,
  VarendoDataStatus,
  VarendoSelectionMode,
} from './types.js';
import { VarendoDataLoadMoreEvent, VarendoDataSelectionEvent } from './events.js';
import {
  dataStyles,
  dataValueText,
  scopeText,
  selectionChangeDetail,
  stableDataRecordKey,
  statusTemplate,
} from './shared.js';

/** Repeated records with explicit headings and a bounded load-more affordance. */
export class VarendoCardCollectionElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    rows: { attribute: false },
    columns: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    headingKey: { attribute: 'heading-key', type: String },
    selection: { type: String },
    selectedKeys: { attribute: false },
    result: { attribute: false },
    title: { type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
    hasMore: { attribute: 'has-more', type: Boolean },
    loadingMore: { attribute: 'loading-more', type: Boolean },
    loadLabel: { attribute: 'load-label', type: String },
  };

  rows: readonly VarendoDataRecord[] = [];
  columns: readonly VarendoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  headingKey = '';
  selection: VarendoSelectionMode = 'none';
  selectedKeys: readonly string[] = [];
  result: ResultRef | undefined = undefined;
  title = '';
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';
  hasMore = false;
  loadingMore = false;
  loadLabel = 'Load more';

  protected override render() {
    const status = this.rows.length === 0 && this.status === 'ready' ? 'empty' : this.status;
    const scope = scopeText(this.scope);
    return html`
      <section part="collection" aria-label=${this.title || nothing} data-status=${status}>
        ${this.title ? html`<h2 part="title">${this.title}</h2>` : nothing}
        ${
          this.rows.length > 0
            ? html` <div part="cards">${this.rows.map((row) => this.renderCard(row))}</div> `
            : nothing
        }
        ${scope ? html`<p part="scope">${scope}</p>` : nothing}
        ${this.hasMore ? html`<button part="load-more" type="button" ?disabled=${this.loadingMore} aria-busy=${this.loadingMore ? 'true' : nothing} @click=${this.loadMore}>${this.loadingMore ? 'Loading…' : this.loadLabel}</button>` : nothing}
        ${status === 'ready' ? nothing : statusTemplate(status, this.message)}
      </section>
    `;
  }

  private renderCard(row: VarendoDataRecord) {
    const key = stableDataRecordKey(row, this.identity);
    const selected = key !== undefined && this.selectedKeys.includes(key);
    const heading =
      this.headingKey.length > 0 ? dataValueText(row[this.headingKey]) : dataValueText(row[this.columns[0]?.key ?? '']);
    const fields = this.columns.filter((column) => column.key !== this.headingKey);
    const content = html`
      ${this.title ? html`<h3 part="heading">${heading}</h3>` : html`<h2 part="heading">${heading}</h2>`}
      <dl part="facts">
        ${fields.map(
          (field) =>
            html`<div part="fact">
              <dt>${field.label}</dt>
              <dd>${dataValueText(row[field.key])}</dd>
            </div>`,
        )}
      </dl>
    `;
    return html`
      <article part="card" data-key=${key ?? 'unresolved'} ?data-selected=${selected} aria-label=${heading}>
        ${content}
        ${this.selection === 'none' ? nothing : html`<button part="card-button" type="button" ?disabled=${key === undefined} aria-pressed=${String(selected)} aria-label=${`${selected ? 'Deselect' : 'Select'} ${this.entity} ${heading}`} @click=${() => this.requestSelection(key)}>${selected ? 'Selected' : 'Select'}</button>`}
      </article>
    `;
  }

  private readonly requestSelection = (key: string | undefined): void => {
    const detail = selectionChangeDetail({
      selection: this.selection,
      keys: this.selectedKeys,
      key,
      entity: this.entity,
      result: this.result,
      scope: this.scope,
    });
    if (detail === undefined) return;
    this.dispatchEvent(new VarendoDataSelectionEvent('varendo-card-selection', detail));
  };

  private readonly loadMore = (): void => {
    if (!this.loadingMore) this.dispatchEvent(new VarendoDataLoadMoreEvent());
  };

  static readonly styles = [
    varendoThemeStyles,
    dataStyles,
    css`
      h2 {
        font-size: var(--varendo-typography-font-size-title, 1.125rem);
        margin: 0 0 var(--varendo-space-8, 0.5rem);
      }
      [part='cards'] {
        display: grid;
        gap: var(--varendo-space-12, 0.75rem);
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
      }
      [part='card'] {
        border: var(--varendo-control-border-width, 0.0625rem) solid var(--varendo-color-border, #c9d0d8);
        border-radius: var(--varendo-radius-medium, 0.625rem);
        min-inline-size: 0;
        padding: var(--varendo-space-12, 0.75rem);
      }
      [part='card-button'] {
        background: transparent;
        border: 0;
        color: inherit;
        cursor: pointer;
        display: block;
        font: inherit;
        inline-size: 100%;
        padding: var(--varendo-space-8, 0.5rem);
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        text-align: start;
      }
      [part='card']:has([part='card-button']):hover {
        border-color: var(--varendo-color-accent, #4338ca);
      }
      [part='card'][data-selected] {
        border-color: var(--varendo-color-accent, #4338ca);
        box-shadow: inset 0 0 0 0.125rem color-mix(in srgb, var(--varendo-color-accent, #4338ca) 20%, transparent);
      }
      [part='heading'] {
        font-size: var(--varendo-typography-font-size-title, 1.0625rem);
        margin: 0;
        overflow-wrap: anywhere;
      }
      dl {
        display: grid;
        gap: var(--varendo-space-8, 0.5rem);
        margin: var(--varendo-space-12, 0.75rem) 0 0;
      }
      [part='fact'] {
        display: grid;
        gap: var(--varendo-space-4, 0.25rem);
        min-inline-size: 0;
      }
      dt,
      [part='scope'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      [part='scope'] {
        margin: var(--varendo-space-8, 0) 0;
      }
      [part='load-more'] {
        background: var(--varendo-color-surface, #fff);
        border: var(--varendo-control-border-width, 0.0625rem) solid var(--varendo-color-accent, #4338ca);
        border-radius: var(--varendo-radius-medium, 0.625rem);
        color: var(--varendo-color-accent, #4338ca);
        cursor: pointer;
        font: inherit;
        margin-block-start: var(--varendo-space-12, 0.75rem);
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        padding-inline: var(--varendo-space-12, 0.75rem);
      }
      @media (forced-colors: active) {
        [part='card'][data-selected] {
          outline: 0.125rem solid Highlight;
          outline-offset: -0.125rem;
        }
        [part='card'],
        [part='load-more'] {
          border-color: ButtonText;
        }
        [part='card-button'],
        [part='load-more'] {
          color: ButtonText;
        }
      }
    `,
  ];
}
