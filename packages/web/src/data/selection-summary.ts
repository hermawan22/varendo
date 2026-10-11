import { css, html, LitElement, nothing } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';
import type { ResultRef } from '@varendo/core';
import type { AeliqoDataScope, AeliqoDataStatus, AeliqoFilterPredicate, AeliqoSelectionDetail } from './types.js';
import { AeliqoDataSelectionEvent } from './events.js';
import { dataStyles, displaysStatusSection, scopeText, statusTemplate } from './shared.js';

export interface AeliqoSelectionScope {
  readonly kind: 'ids' | 'predicate';
  readonly matched?: number;
  readonly predicate?: AeliqoFilterPredicate;
  readonly label?: string;
}

/** Makes selection scope explicit. A predicate selection is never described
 * as a list of observed IDs or as an unqualified global selection. */
export class AeliqoSelectionSummaryElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
  static readonly properties = {
    selectedKeys: { attribute: false },
    selectionScope: { attribute: false },
    entity: { type: String },
    result: { attribute: false },
    scope: { attribute: false },
    label: { type: String },
    clearable: { type: Boolean },
    status: { type: String },
    message: { type: String },
  };

  selectedKeys: readonly string[] = [];
  selectionScope: AeliqoSelectionScope | undefined = undefined;
  entity = 'record';
  result: ResultRef | undefined = undefined;
  scope: AeliqoDataScope | undefined = undefined;
  label = 'Selection';
  clearable = true;
  status: AeliqoDataStatus = 'ready';
  message = '';

  protected override render() {
    const text = this.summaryText();
    const status = this.status;
    return html`
      <div part="summary" aria-live="polite" data-status=${status}>
        <span part="label">${this.label}</span>
        <span part="text">${text}</span>
        ${this.clearable && (this.selectedKeys.length > 0 || this.selectionScope?.kind === 'predicate') ? html`<button part="clear" type="button" @click=${this.clearSelection}>Clear selection</button>` : nothing}
        ${scopeText(this.scope) ? html`<span part="scope">${scopeText(this.scope)}</span>` : nothing}
      </div>
      ${displaysStatusSection(status) ? statusTemplate(status, this.message) : nothing}
    `;
  }

  private summaryText(): string {
    const selection = this.selectionScope;
    if (selection?.kind === 'predicate') {
      const matched = selection.matched === undefined ? 'matching' : `${selection.matched.toLocaleString()} matching`;
      return selection.label ?? `All ${matched} ${this.entity} in the active server filter`;
    }
    if (this.selectedKeys.length === 0) return `No ${this.entity}s selected`;
    const count = this.selectedKeys.length.toLocaleString();
    return `${count} ${this.entity}${this.selectedKeys.length === 1 ? '' : 's'} selected`;
  }

  private readonly clearSelection = (): void => {
    const detail: AeliqoSelectionDetail = {
      mode: 'clear',
      entity: this.entity,
      keys: [],
      ...(this.result === undefined ? {} : { result: this.result }),
      ...(this.scope === undefined ? {} : { scope: this.scope }),
    };
    this.dispatchEvent(new AeliqoDataSelectionEvent('aeliqo-selection-clear', detail));
  };

  static readonly styles = [
    aeliqoThemeStyles,
    dataStyles,
    css`
      [part='summary'] {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-8, 0.5rem);
        min-inline-size: 0;
      }
      [part='label'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      }
      [part='text'] {
        overflow-wrap: anywhere;
      }
      [part='scope'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
        inline-size: 100%;
      }
      [part='clear'] {
        background: transparent;
        border: 0;
        color: var(--aeliqo-color-accent, #4338ca);
        cursor: pointer;
        font: inherit;
        min-block-size: var(--aeliqo-control-compact-target, 2rem);
        padding-inline: var(--aeliqo-space-4, 0.25rem);
        text-decoration: underline;
      }
      @media (forced-colors: active) {
        [part='clear'] {
          color: LinkText;
        }
      }
    `,
  ];
}
