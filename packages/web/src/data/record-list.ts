import { css, html, LitElement, nothing } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';
import type { ResultRef } from '@varendo/core';
import type {
  AeliqoDataColumn,
  AeliqoDataRecord,
  AeliqoDataScope,
  AeliqoDataStatus,
  AeliqoSelectionMode,
} from './types.js';
import { AeliqoDataSelectionEvent } from './events.js';
import {
  dataStyles,
  dataValueText,
  scopeText,
  selectionChangeDetail,
  stableDataRecordKey,
  statusTemplate,
} from './shared.js';

/** A compact, keyboard-scannable record collection. Selection is controlled by
 * the host: this element emits stable identity proposals and never mutates
 * `selectedKeys` itself. */
export class AeliqoRecordListElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
  static readonly properties = {
    rows: { attribute: false },
    columns: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    selection: { type: String },
    selectedKeys: { attribute: false },
    result: { attribute: false },
    title: { type: String },
    emptyLabel: { attribute: 'empty-label', type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  rows: readonly AeliqoDataRecord[] = [];
  columns: readonly AeliqoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  selection: AeliqoSelectionMode = 'none';
  selectedKeys: readonly string[] = [];
  result: ResultRef | undefined = undefined;
  title = '';
  emptyLabel = 'No records to display.';
  scope: AeliqoDataScope | undefined = undefined;
  status: AeliqoDataStatus = 'ready';
  message = '';

  protected override render() {
    const scope = scopeText(this.scope);
    const status = this.rows.length === 0 && this.status === 'ready' ? 'empty' : this.status;
    return html`
      <section part="list" aria-label=${this.title || nothing} data-status=${status}>
        ${this.title ? html`<h2 part="title">${this.title}</h2>` : nothing}
        ${
          this.rows.length > 0
            ? html`
                <ul part="records">
                  ${this.rows.map((row) => this.renderRow(row))}
                </ul>
              `
            : nothing
        }
        ${scope ? html`<p part="scope">${scope}</p>` : nothing}
        ${status === 'ready' ? nothing : statusTemplate(status, this.message)}
      </section>
    `;
  }

  private renderRow(row: AeliqoDataRecord) {
    const key = stableDataRecordKey(row, this.identity);
    const selected = key !== undefined && this.selectedKeys.includes(key);
    const primary = this.columns[0];
    const label = primary === undefined ? this.entity : dataValueText(row[primary.key]);
    const content = html`
      ${primary ? html`<span part="primary">${dataValueText(row[primary.key])}</span>` : nothing}
      <span part="facts">
        ${this.columns.slice(primary ? 1 : 0).map((column) => html`<span part="fact"><span part="field-label">${column.label}</span><span part="field-value">${dataValueText(row[column.key])}</span></span>`)}
      </span>
    `;
    return html`
      <li part="record" data-key=${key ?? 'unresolved'} ?data-selected=${selected}>
        ${
          this.selection === 'none'
            ? html`<article aria-label=${label}>${content}</article>`
            : html`
                <button
                  part="record-button"
                  type="button"
                  ?disabled=${key === undefined}
                  aria-pressed=${String(selected)}
                  aria-label=${this.selectionLabel(label, selected)}
                  @click=${() => this.requestSelection(key)}
                >
                  ${content}
                </button>
              `
        }
      </li>
    `;
  }

  private selectionLabel(label: string, selected: boolean): string {
    return `${selected ? 'Deselect' : 'Select'} ${this.entity} ${label}`;
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
    this.dispatchEvent(new AeliqoDataSelectionEvent('aeliqo-record-list-selection', detail));
  };

  static readonly styles = [
    aeliqoThemeStyles,
    dataStyles,
    css`
      h2 {
        font-size: var(--aeliqo-typography-font-size-title, 1.125rem);
        margin: 0 0 var(--aeliqo-space-8, 0.5rem);
      }
      ul {
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        min-inline-size: 0;
      }
      article,
      [part='record-button'] {
        border: var(--aeliqo-control-border-width, 0.0625rem) solid var(--aeliqo-color-border, #c9d0d8);
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        display: block;
        inline-size: 100%;
        padding: var(--aeliqo-space-12, 0.75rem);
        text-align: start;
      }
      [part='record-button'] {
        background: var(--aeliqo-color-surface, #fff);
        color: inherit;
        cursor: pointer;
        font: inherit;
      }
      [part='record-button']:hover {
        border-color: var(--aeliqo-color-accent, #4338ca);
      }
      li[data-selected] [part='record-button'] {
        border-color: var(--aeliqo-color-accent, #4338ca);
        box-shadow: inset 0 0 0 0.125rem color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 20%, transparent);
      }
      [part='primary'] {
        display: block;
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        overflow-wrap: anywhere;
      }
      [part='facts'] {
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-4, 0.25rem) var(--aeliqo-space-12, 0.75rem);
        margin-block-start: var(--aeliqo-space-8, 0.5rem);
      }
      [part='fact'] {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-4, 0.25rem);
        max-inline-size: 100%;
      }
      [part='field-label'],
      [part='scope'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      }
      [part='field-value'] {
        overflow-wrap: anywhere;
      }
      [part='scope'] {
        margin: var(--aeliqo-space-8, 0) 0 0;
      }
      @media (forced-colors: active) {
        [part='record-button'] {
          background: Canvas;
          color: CanvasText;
        }
        li[data-selected] [part='record-button'] {
          border: 0.1875rem solid Highlight;
        }
      }
    `,
  ];
}
