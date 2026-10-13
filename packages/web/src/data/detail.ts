import { css, html, LitElement, nothing } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import type { VarendoDataColumn, VarendoDataRecord, VarendoDataScope, VarendoDataStatus } from './types.js';
import { dataStyles, dataValueText, scopeText, stableDataRecordKey, statusTemplate } from './shared.js';

/** A selected record view. Fields are rendered even when missing so the
 * meaning of an absent field is visible and the record identity is stable. */
export class VarendoDetailElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    record: { attribute: false },
    fields: { attribute: false },
    identity: { attribute: false },
    entity: { type: String },
    title: { type: String },
    showIdentity: { attribute: 'show-identity', type: Boolean },
    missingLabel: { attribute: 'missing-label', type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  record: VarendoDataRecord | undefined = undefined;
  fields: readonly VarendoDataColumn[] = [];
  identity: readonly string[] = [];
  entity = 'record';
  title = 'Details';
  showIdentity = false;
  missingLabel = 'Not available';
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';

  protected override render() {
    const identityKey = this.record === undefined ? undefined : stableDataRecordKey(this.record, this.identity);
    const status = this.record === undefined && this.status === 'ready' ? 'empty' : this.status;
    const scope = scopeText(this.scope);
    return html`
      <section part="detail" data-identity=${identityKey ?? 'unresolved'} aria-label=${this.title}>
        <header part="header">
          <h2>${this.title}</h2>
          ${this.showIdentity && identityKey ? html`<span part="identity">${this.entity}: ${identityKey}</span>` : nothing}
        </header>
        ${
          this.record !== undefined
            ? html`
                <dl part="facts">
                  ${this.fields.map(
                    (field) => html`
                      <div part="fact" data-field=${field.key}>
                        <dt>${field.label}</dt>
                        <dd>${dataValueText(this.record?.[field.key], this.missingLabel)}</dd>
                      </div>
                    `,
                  )}
                </dl>
              `
            : nothing
        }
        ${scope ? html`<p part="scope">${scope}</p>` : nothing}
        ${status === 'ready' ? nothing : statusTemplate(status, this.message)}
      </section>
    `;
  }

  static readonly styles = [
    varendoThemeStyles,
    dataStyles,
    css`
      section {
        min-inline-size: 0;
      }
      header {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-8, 0.5rem);
        justify-content: space-between;
        margin-block-end: var(--varendo-space-12, 0.75rem);
      }
      h2 {
        font-size: var(--varendo-typography-font-size-title, 1.125rem);
        margin: 0;
        overflow-wrap: anywhere;
      }
      [part='identity'],
      [part='scope'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
        overflow-wrap: anywhere;
      }
      dl {
        display: grid;
        gap: var(--varendo-space-8, 0.5rem) var(--varendo-space-16, 1rem);
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        margin: 0;
      }
      [part='fact'] {
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
      [part='scope'] {
        grid-column: 1 / -1;
        margin-block-start: var(--varendo-space-4, 0.25rem);
      }
    `,
  ];
}
