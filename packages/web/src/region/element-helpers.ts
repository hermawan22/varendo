import type { InteractionPayload, InteractionState, Result, ResultRef } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { dataStatusMessage, materializedDataStatus } from '../data/shared.js';
import { validateAeliqoDataBinding } from './data-registry.js';
import type { AeliqoRegionResult } from './types.js';
import type { AeliqoInputChangeDetail } from '../input/events.js';
import type { AeliqoTableColumn, AeliqoTableRow, AeliqoTableSelectionDetail } from '../types.js';
import { resultRefKey as refKey } from './registry-value.js';
export { refKey };

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function replacementForFocusedElement(
  target: HTMLElement,
  focusedElement: HTMLElement | undefined,
): HTMLElement | undefined {
  if (focusedElement === undefined) return undefined;
  const sameTag = [...(target.shadowRoot?.querySelectorAll<HTMLElement>(focusedElement.tagName) ?? [])];
  const attributes = ['id', 'aria-label', 'name', 'part'];
  const matching = sameTag.find((candidate) =>
    attributes.some((attribute) => {
      const value = focusedElement.getAttribute(attribute);
      return value !== null && value === candidate.getAttribute(attribute);
    }),
  );
  if (matching !== undefined) return matching;
  return sameTag.length === 1 ? sameTag[0] : undefined;
}

function resultRef(value: unknown): value is ResultRef {
  try {
    const candidate = record(value);
    return (
      candidate !== undefined &&
      typeof candidate.id === 'string' &&
      typeof candidate.revision === 'string' &&
      typeof candidate.sourceLineage === 'string' &&
      typeof candidate.outputId === 'string' &&
      typeof candidate.queryDigest === 'string' &&
      typeof candidate.scopeDigest === 'string'
    );
  } catch {
    return false;
  }
}

function customDetail(event: Event): unknown {
  try {
    return typeof CustomEvent !== 'undefined' && event instanceof CustomEvent ? event.detail : undefined;
  } catch {
    return undefined;
  }
}

function validSelectionMode(value: unknown): value is 'clear' | 'ids' {
  return value === 'clear' || value === 'ids';
}

function validSelectionKeys(mode: 'clear' | 'ids', keys: readonly string[]): boolean {
  if (mode === 'clear') return keys.length === 0;
  return keys.length > 0;
}

export function tableSelectionDetail(event: Event): AeliqoTableSelectionDetail | undefined {
  try {
    const candidate = record(customDetail(event));
    if (candidate === undefined || !validSelectionMode(candidate.mode)) return undefined;
    if (typeof candidate.entity !== 'string' || !Array.isArray(candidate.keys)) return undefined;
    const keys = candidate.keys;
    if (!keys.every((key) => typeof key === 'string')) return undefined;
    if (!validSelectionKeys(candidate.mode, keys as string[])) return undefined;
    if (candidate.result !== undefined && !resultRef(candidate.result)) return undefined;
    return {
      mode: candidate.mode,
      entity: candidate.entity,
      keys: keys as string[],
      ...(candidate.result === undefined ? {} : { result: candidate.result }),
    };
  } catch {
    return undefined;
  }
}

export function inputChangeDetail(event: Event): AeliqoInputChangeDetail<string> | undefined {
  try {
    const candidate = record(customDetail(event));
    if (candidate === undefined || candidate.source !== 'user' || typeof candidate.value !== 'string') return undefined;
    return { source: 'user', value: candidate.value };
  } catch {
    return undefined;
  }
}

export function temporalTime(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function temporalLabel(value: unknown): string {
  if (typeof value === 'string' && temporalTime(value) !== undefined) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return 'Invalid date';
}

export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const decimal = record(value);
  if (decimal !== undefined && Object.keys(decimal).length === 1 && typeof decimal.decimal === 'string') {
    const parsed = Number(decimal.decimal);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

export function decimalText(value: unknown): string | undefined {
  const decimal = record(value);
  return decimal !== undefined && Object.keys(decimal).length === 1 && typeof decimal.decimal === 'string'
    ? decimal.decimal
    : undefined;
}

export function resultFor(
  node: { readonly result: Result | undefined },
  results: readonly AeliqoRegionResult[],
): AeliqoRegionResult | undefined {
  try {
    if (node.result === undefined || !Array.isArray(results)) return undefined;
    const matches = results.filter((candidate) => refKey(candidate.ref) === refKey(node.result!.ref));
    if (matches.length !== 1) return undefined;
    const current = matches[0]!;
    const checked = validateAeliqoDataBinding({
      result: node.result,
      rows: current.rows,
      ...(current.columns === undefined ? {} : { columns: current.columns }),
      ...(current.scope === undefined ? {} : { scope: current.scope }),
    });
    if (!checked.ok) return undefined;
    const rows = checked.value.rows.map((source) => {
      const row: Record<string, AeliqoTableRow[string]> = {};
      for (const [field, value] of Object.entries(source)) if (value !== undefined) row[field] = value;
      return row;
    });
    return {
      ref: checked.value.result.ref,
      rows,
      columns: checked.value.columns,
      scope: checked.value.scope,
      ...(current.visualizationContext === undefined ? {} : { visualizationContext: current.visualizationContext }),
    };
  } catch {
    return undefined;
  }
}

export function resultColumns(
  node: { readonly result: Result | undefined },
  bound: AeliqoRegionResult | undefined,
): readonly AeliqoTableColumn[] {
  if (bound?.columns !== undefined) return bound.columns;
  return node.result?.fields.map((field) => ({ key: field.id, label: field.label })) ?? [];
}

export function valuesOf(node: {
  readonly config: { readonly values: Readonly<Record<string, unknown>> };
}): Record<string, unknown> {
  return node.config.values as Record<string, unknown>;
}

export function fieldLabel(node: ValidatedPresentation['nodes'][number], field: string): string {
  return node.result?.fields.find((candidate) => candidate.id === field)?.label ?? field;
}

export function tableSelectionMode(value: unknown): 'none' | 'single' | 'multiple' {
  if (value === 'single' || value === 'multiple') return value;
  return 'none';
}

export function tableDisplayState(
  node: ValidatedPresentation['nodes'][number],
  bound: AeliqoRegionResult | undefined,
): { readonly emptyLabel: string; readonly status: string; readonly message: string } {
  const emptyLabel = bound === undefined ? 'Data unavailable.' : 'No rows to display.';
  const message = bound === undefined ? 'Data unavailable.' : '';
  if (bound === undefined || node.result === undefined) return { emptyLabel, status: 'unavailable', message };
  return { emptyLabel, status: materializedDataStatus(node.result), message };
}

export function trendSummary(bound: AeliqoRegionResult | undefined, result: Result | undefined): string {
  if (bound === undefined) return 'Data unavailable.';
  if (result === undefined) return '';
  return dataStatusMessage(materializedDataStatus(result)) ?? '';
}

export function filterPort(
  node: ValidatedPresentation['nodes'][number],
  field: string,
  outputId: string,
): ValidatedPresentation['nodes'][number]['config']['ports'][number] | undefined {
  if (field.length === 0 || outputId.length === 0 || node.result === undefined) return undefined;
  if (outputId !== node.result.ref.outputId) return undefined;
  const descriptor = node.result.fields.find((candidate) => candidate.id === field);
  if (descriptor?.type.value !== 'text') return undefined;
  return node.config.ports.find((candidate) => candidate.payload === 'filter');
}

export function filterPredicates(
  values: Record<string, unknown>,
  field: string,
  value: string,
): Extract<InteractionPayload, { readonly kind: 'filter' }>['predicates'] {
  if (value.length === 0) return [];
  const entity = values.entity === undefined ? {} : { entity: text(values.entity) };
  return [{ op: 'compare', field, ...entity, comparison: 'eq', value }];
}

export function configColumns(
  values: Record<string, unknown>,
  fallback: readonly AeliqoTableColumn[],
): readonly AeliqoTableColumn[] {
  if (!Array.isArray(values.columns)) return fallback;
  return values.columns.flatMap((value) => {
    const candidate = record(value);
    if (candidate === undefined) return [];
    const key = text(candidate.key);
    const label = text(candidate.label, key);
    return key.length === 0 ? [] : [{ key, label }];
  });
}

export function selectionKeys(nodeId: string, interaction: InteractionState | undefined): readonly string[] {
  const entry = interaction?.values.find(
    (candidate) => candidate.nodeId === nodeId && candidate.payload.kind === 'selection',
  );
  if (entry?.payload.kind !== 'selection' || entry.payload.selection.mode !== 'ids') return [];
  return entry.payload.selection.keys;
}

export function filterValue(nodeId: string, field: string, interaction: InteractionState | undefined): string {
  const entry = interaction?.values.find(
    (candidate) => candidate.nodeId === nodeId && candidate.payload.kind === 'filter',
  );
  if (entry?.payload.kind !== 'filter') return '';
  const predicate = entry.payload.predicates.find(
    (candidate) => candidate.op === 'compare' && candidate.field === field && candidate.comparison === 'eq',
  );
  if (predicate?.op !== 'compare') return '';
  return typeof predicate.value === 'string' ? predicate.value : '';
}
