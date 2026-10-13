import { css, html, nothing, type TemplateResult } from 'lit';
import { scalarIdentity } from '@varendo/core';
import type { Result, ResultRef } from '@varendo/core';
import type {
  VarendoDataRecord,
  VarendoDataScope,
  VarendoDataStatus,
  VarendoDataValue,
  VarendoSelectionDetail,
  VarendoSelectionMode,
} from './types.js';

/** Materialized observations remain readable even when population coverage is unknown. */
export function materializedDataStatus(result: Result): VarendoDataStatus {
  return result.coverage.kind === 'partial' || result.coverage.kind === 'sample' ? 'partial' : 'ready';
}

/** Stable, typed identity encoding. It deliberately excludes render position. */
export function stableDataValueKey(value: VarendoDataValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'null:';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (typeof value === 'boolean') return `boolean:${value ? 'true' : 'false'}`;
  if (typeof value === 'number') return finiteNumberKey(value);
  return decimalValueKey(value);
}

function finiteNumberKey(value: number): string | undefined {
  return Number.isFinite(value) ? `number:${String(value)}` : undefined;
}

function decimalValueKey(value: VarendoDataValue): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (Object.keys(value).length !== 1 || typeof value.decimal !== 'string') return undefined;
  const identity = scalarIdentity(value, { value: 'decimal', nullable: false });
  if (!identity.ok) return undefined;
  return `decimal:${identity.value}`;
}

export function stableDataRecordKey(record: VarendoDataRecord, identity: readonly string[]): string | undefined {
  if (identity.length === 0) return undefined;
  const keys = identity.map((field) => stableDataValueKey(record[field]));
  if (keys.some((key) => key === undefined)) return undefined;
  return keys.length === 1 ? keys[0] : JSON.stringify(keys);
}

export function dataValueText(value: VarendoDataValue | undefined, missing = '—'): string {
  if (value === undefined || value === null) return missing;
  if (typeof value === 'object' && !Array.isArray(value) && typeof value.decimal === 'string') return value.decimal;
  return String(value);
}

const statusCopy: Record<VarendoDataStatus, readonly [string | undefined, string | undefined]> = {
  loading: ['Loading…', 'Memuat…'],
  empty: ['No data to display.', 'Tidak ada data untuk ditampilkan.'],
  partial: ['Showing a partial result.', 'Menampilkan hasil sebagian.'],
  stale: ['This result may be out of date.', 'Hasil ini mungkin sudah kedaluwarsa.'],
  error: ['The data could not be loaded.', 'Data tidak dapat dimuat.'],
  unavailable: ['Value unavailable.', 'Nilai tidak tersedia.'],
  ready: [undefined, undefined],
};

export function dataStatusMessage(status: VarendoDataStatus, message?: string, locale?: string): string | undefined {
  if (message !== undefined && message.length > 0) return message;
  return statusCopy[status][/^id(?:-|$)/i.test(locale ?? '') ? 1 : 0];
}

/** Plain-language counts: all rows as a count, a partial load as "Showing N of M". */
function shownOfTotal(loaded: number, total: number, population: string, indonesian: boolean): string {
  const matching = population === 'matching';
  if (indonesian) {
    const noun = matching ? 'rekaman yang cocok' : 'rekaman';
    return loaded === total
      ? `${total.toLocaleString('id-ID')} ${noun}`
      : `Menampilkan ${loaded.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} ${noun}`;
  }
  const noun = matching ? 'matching records' : 'records';
  return loaded === total
    ? `${total.toLocaleString()} ${noun}`
    : `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}

function scopeCountText(scope: VarendoDataScope, indonesian: boolean): string | undefined {
  const total = scope.filteredTotal ?? scope.populationTotal;
  const population = scope.filteredTotal === undefined ? 'population' : 'matching';
  if (scope.loaded !== undefined && total !== undefined)
    return shownOfTotal(scope.loaded, total, population, indonesian);
  if (scope.loaded !== undefined)
    return indonesian ? `${scope.loaded.toLocaleString('id-ID')} rekaman` : `${scope.loaded.toLocaleString()} records`;
  if (total === undefined) return undefined;
  return indonesian
    ? `${total.toLocaleString('id-ID')} rekaman ${scope.filteredTotal === undefined ? 'populasi' : 'yang cocok'}`
    : `${total.toLocaleString()} ${population} records`;
}

export function scopeText(scope: VarendoDataScope | undefined, locale?: string): string | undefined {
  if (scope === undefined) return undefined;
  const indonesian = /^id(?:-|$)/i.test(locale ?? '');
  const parts: string[] = [];
  if (scope.label) parts.push(scope.label);
  if (scope.kind === 'sample') parts.push(indonesian ? 'Sampel terbatas' : 'Bounded sample');
  if (scope.kind === 'unknown') parts.push(indonesian ? 'Cakupan tidak diketahui' : 'Scope unknown');
  const count = scopeCountText(scope, indonesian);
  if (count !== undefined) parts.push(count);
  return parts.length === 0 ? undefined : parts.join('; ');
}

const STATUS_BANNER_STATES: ReadonlySet<VarendoDataStatus> = new Set(['loading', 'partial', 'stale', 'empty']);
const STATUS_SECTION_STATES: ReadonlySet<VarendoDataStatus> = new Set([
  'loading',
  'partial',
  'stale',
  'error',
  'unavailable',
]);

/** Statuses that render a status banner alongside the component content. */
export function displaysStatusBanner(status: VarendoDataStatus): boolean {
  return STATUS_BANNER_STATES.has(status);
}

/** Statuses that render a standalone status section instead of content. */
export function displaysStatusSection(status: VarendoDataStatus): boolean {
  return STATUS_SECTION_STATES.has(status);
}

/** Controlled selection toggles: single mode replaces, multiple mode toggles. */
export function selectionChangeDetail(input: {
  readonly selection: VarendoSelectionMode;
  readonly keys: readonly string[];
  readonly key: string | undefined;
  readonly entity: string;
  readonly result: ResultRef | undefined;
  readonly scope: VarendoDataScope | undefined;
}): VarendoSelectionDetail | undefined {
  if (input.key === undefined || input.selection === 'none') return undefined;
  const next = new Set(input.keys);
  if (input.selection === 'single') {
    next.clear();
    next.add(input.key);
  } else if (next.has(input.key)) next.delete(input.key);
  else next.add(input.key);
  const keys = [...next];
  return keys.length === 0
    ? { mode: 'clear', entity: input.entity, keys: [], ...(input.scope === undefined ? {} : { scope: input.scope }) }
    : {
        mode: 'ids',
        entity: input.entity,
        keys,
        ...(input.result === undefined ? {} : { result: input.result }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      };
}

export function statusTemplate(status: VarendoDataStatus, message?: string): TemplateResult | typeof nothing {
  const text = dataStatusMessage(status, message);
  if (text === undefined) return nothing;
  const kind = status === 'error' || status === 'unavailable' ? 'error' : status;
  return html`<p part="status" class=${kind} role=${status === 'loading' ? 'status' : 'alert'} dir="auto">${text}</p>`;
}

export const dataStyles = /* @__PURE__ */ (() => css`
  :host {
    box-sizing: border-box;
    color: var(--varendo-color-text, #18202a);
    display: block;
    max-inline-size: 100%;
  }
  :host,
  :host * {
    box-sizing: border-box;
  }
  [part='status'] {
    background: var(--_varendo-info-subtle, var(--varendo-color-surface, #f8fafc));
    border-inline-start: 0.1875rem solid var(--varendo-color-info, #1d4ed8);
    border-radius: var(--varendo-radius-small, 0.375rem);
    color: var(--varendo-color-info, #1d4ed8);
    margin: var(--varendo-space-8, 0.5rem) 0 0;
    padding: var(--varendo-space-8, 0.5rem) var(--varendo-space-12, 0.75rem);
    overflow-wrap: anywhere;
  }
  [part='status'].error {
    background: var(--_varendo-danger-subtle, var(--varendo-color-surface, #f8fafc));
    border-inline-start-color: var(--varendo-color-danger, #b91c1c);
    color: var(--varendo-color-danger, #b91c1c);
  }
  [part='status'].partial,
  [part='status'].stale {
    background: var(--_varendo-warning-subtle, var(--varendo-color-surface, #f8fafc));
    border-inline-start-color: var(--varendo-color-warning, #854d0e);
    color: var(--varendo-color-warning, #854d0e);
  }
  :is(button, input, select, [part='number']):focus-visible {
    outline: var(--varendo-focus-width, 0.1875rem) solid var(--varendo-color-focus, #4338ca);
    outline-offset: var(--varendo-focus-offset, 0.125rem);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--varendo-color-focus, #4338ca) 16%, transparent);
  }
  button:not(:disabled):hover {
    background: var(--_varendo-accent-subtle, var(--varendo-color-surface, #f8fafc));
    border-color: var(--varendo-color-accent, #4338ca);
    color: var(--varendo-color-accent, #4338ca);
  }
  button:disabled {
    background: var(--varendo-color-surface, #f8fafc);
    border-color: var(--_varendo-border-subtle, var(--varendo-color-border, #64748b));
    color: var(--varendo-color-muted, #4b5563);
    cursor: not-allowed;
  }
  [part='scope'] {
    unicode-bidi: plaintext;
  }
  @media (forced-colors: active) {
    :is(button, input, select, [part='number']):focus-visible {
      outline: 2px solid Highlight;
    }
  }
`)();
