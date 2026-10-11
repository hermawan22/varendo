import { html, nothing, type TemplateResult } from 'lit';
import { dataStatusMessage, displaysStatusSection, scopeText } from '../data/shared.js';
import type { AeliqoDataScope, AeliqoDataStatus, AeliqoSortState } from '../data/types.js';

export function sortDescription(
  active: boolean,
  direction: AeliqoSortState['direction'] | undefined,
  sortable: boolean,
) {
  if (!active) return sortable ? 'none' : nothing;
  return direction === 'asc' ? 'ascending' : 'descending';
}

export function sortIndicator(active: boolean, direction: AeliqoSortState['direction'] | undefined): string {
  if (!active) return '';
  return direction === 'asc' ? ' ↑' : ' ↓';
}

export function tableStatusSection(status: AeliqoDataStatus, message: string): TemplateResult | typeof nothing {
  if (!displaysStatusSection(status)) return nothing;
  const role = status === 'loading' ? 'status' : 'alert';
  return html`<p part="status" class=${status} role=${role}>${dataStatusMessage(status, message)}</p>`;
}

/** Inputs for the scope summary rendered below the table. */
export interface TableScopeView {
  readonly scope: AeliqoDataScope | undefined;
  readonly totalRows: number | undefined;
  readonly rowCount: number;
  readonly loadedRows: number;
  readonly renderedCount: number;
  readonly virtualized: boolean;
  readonly entity: string;
}

export function tableScopeSection(view: TableScopeView): TemplateResult | typeof nothing {
  const loaded = view.scope?.loaded ?? view.loadedRows;
  const total = view.totalRows ?? view.scope?.filteredTotal ?? view.scope?.populationTotal ?? view.rowCount;
  const description = scopeText(view.scope);
  if (view.virtualized && view.renderedCount !== loaded)
    return virtualizedScope(view.renderedCount, loaded, total, description, view.entity);
  return scopeSummary(loaded, total, description, view.entity);
}

function scopeSummary(
  loaded: number,
  total: number | undefined,
  description: string | undefined,
  entity: string,
): TemplateResult | typeof nothing {
  if (description !== undefined) return html`<p part="scope">${description}</p>`;
  if (total !== undefined && total !== loaded)
    return html`<p part="scope">Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} ${entity}s.</p>`;
  return nothing;
}

function virtualizedScope(
  rendered: number,
  loaded: number,
  total: number | undefined,
  description: string | undefined,
  entity: string,
): TemplateResult {
  let totalText = '';
  if (description !== undefined) totalText = `; ${description}`;
  else if (total !== undefined && total !== loaded) totalText = `; ${total.toLocaleString()} matching ${entity}s`;
  return html`<p part="scope">
    ${rendered.toLocaleString()} of ${loaded.toLocaleString()} ${entity}s on screen${totalText}.
  </p>`;
}

export function tablePaginationSection(
  page: number,
  pageSize: number,
  totalRows: number | undefined,
  requestPage: (page: number) => void,
): TemplateResult | typeof nothing {
  if (pageSize <= 0 || totalRows === undefined || totalRows <= pageSize) return nothing;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  return html`<nav part="pagination" aria-label="Pages">
    <button type="button" part="previous" ?disabled=${page <= 1} @click=${() => requestPage(page - 1)}>Previous</button>
    <span part="page-status">Page ${page} of ${pages}</span>
    <button type="button" part="next" ?disabled=${page >= pages} @click=${() => requestPage(page + 1)}>Next</button>
  </nav>`;
}
