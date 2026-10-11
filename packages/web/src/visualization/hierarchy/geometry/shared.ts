import { bindVisualizationSpec } from '@varendo/core/visualization';
import { scalarIdentity } from '@varendo/core';
import type { BoundVisualization } from '@varendo/core/visualization';
import type { Outcome, Result, ResultRef, Scalar, SemanticType } from '@varendo/core';
import { materializeVisualizationRows } from '../../materialization.js';
import type { VisualizationInputs, VisualizationRow } from '../../types.js';
import type { HierarchyGeometryOptions } from './types.js';

const MAX_ROWS = 10_000;
const MAX_WORK = 100_000;
const MAX_MARKS = 50_000;
const MAX_DEPTH = 128;
const MAX_PIXELS = 4_000_000;

export const compareIdentity = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const fail = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `visualization.${code}`, message, retryable: false }],
});

function refKey(ref: ResultRef): string {
  return JSON.stringify([
    ref.id,
    ref.revision,
    ref.sourceLineage ?? null,
    ref.outputId,
    ref.queryDigest,
    ref.scopeDigest,
  ]);
}

function saneDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function optionsFor(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions = {},
): Required<HierarchyGeometryOptions> {
  const width = saneDimension(options.width ?? inputs.width, 640);
  const height = saneDimension(options.height ?? inputs.height, 360);
  const requestedMarks = options.maxMarks ?? inputs.maxMarks;
  const maxMarks = Number.isSafeInteger(requestedMarks) ? requestedMarks : 0;
  const maxDepth = resolveMaxDepth(options.maxDepth);
  return { width, height, maxMarks, maxDepth };
}

function resolveMaxDepth(requested: number | undefined): number {
  if (requested === undefined || !Number.isSafeInteger(requested) || requested <= 0) return MAX_DEPTH;
  return Math.min(MAX_DEPTH, requested);
}

export function validateGeometryBudget(width: number, height: number, maxMarks: number): Outcome<true> {
  if (width < 64 || height < 64 || width > 4_000 || height > 4_000 || width * height > MAX_PIXELS)
    return fail('pixels', 'The visualization dimensions exceed the bounded pixel budget.');
  if (maxMarks < 1 || maxMarks > MAX_MARKS) return fail('marks', 'The visualization mark budget is unsupported.');
  return { ok: true, value: true };
}

export function bindForView(
  inputs: VisualizationInputs,
  view: 'tree' | 'treemap' | 'relationship',
): Outcome<{ bound: BoundVisualization; result: Result; rows: readonly VisualizationRow[] }> {
  if (inputs.visualization === undefined) return fail('input', 'A visualization specification is required.');
  if (inputs.visualization.view !== view) return fail('view', `Expected a ${view} visualization specification.`);
  const checked = bindVisualizationSpec(inputs.visualization, inputs.context);
  if (!checked.ok) return checked;
  const bound = checked.value;
  const selectedRef = 'result' in inputs.visualization ? inputs.visualization.result : bound.results[0]!.ref;
  const result = bound.results.find((candidate) => refKey(candidate.ref) === refKey(selectedRef));
  if (result === undefined) return fail('result', 'The bound result is unavailable.');
  const materialized = materializeVisualizationRows(bound, result.ref, inputs.datasets);
  if (!materialized.ok) return materialized;
  return { ok: true, value: { bound, result, rows: materialized.value } };
}

export function fieldsFor(
  result: Result,
  ids: readonly string[],
): Outcome<readonly { readonly id: string; readonly type: SemanticType }[]> {
  const fields: { id: string; type: SemanticType }[] = [];
  for (const id of ids) {
    const field = result.fields.find((candidate) => candidate.id === id);
    if (field === undefined) return fail('field', `The field ${id} is unavailable in the bound result.`);
    fields.push({ id: field.id, type: field.type });
  }
  return { ok: true, value: fields };
}

export function keyFor(
  values: Readonly<Record<string, Scalar>>,
  fields: readonly { readonly id: string; readonly type: SemanticType }[],
  allowAllNull: boolean,
): Outcome<string | undefined> {
  const identities: string[] = [];
  let nullCount = 0;
  for (const field of fields) {
    const value = values[field.id];
    if (value === null) {
      nullCount += 1;
      identities.push('null');
      continue;
    }
    const identity = scalarIdentity(value, field.type);
    if (!identity.ok) return identity;
    identities.push(identity.value);
  }
  if (nullCount !== 0) return nullIdentity(nullCount, fields.length, allowAllNull);
  return { ok: true, value: JSON.stringify(identities) };
}

function nullIdentity(nullCount: number, fieldCount: number, allowAllNull: boolean): Outcome<string | undefined> {
  if (!allowAllNull || nullCount !== fieldCount)
    return fail('hierarchy-parent', 'Parent keys must be wholly null for roots or wholly non-null for descendants.');
  return { ok: true, value: undefined };
}

export function labelFor(
  values: Readonly<Record<string, Scalar>>,
  field: { readonly id: string; readonly type: SemanticType } | undefined,
  fallback: string,
): string {
  if (field === undefined) return fallback;
  const value = values[field.id];
  if (value === null) return 'Missing';
  if (typeof value === 'object') return value.decimal;
  return String(value);
}

export interface PreparedHierarchy {
  readonly bound: BoundVisualization;
  readonly result: Result;
  readonly rows: readonly VisualizationRow[];
  readonly nodeFields: readonly { readonly id: string; readonly type: SemanticType }[];
  readonly parentFields: readonly { readonly id: string; readonly type: SemanticType }[];
  readonly labelField?: { readonly id: string; readonly type: SemanticType };
}

export interface PreparedHierarchyInput {
  readonly prepared: PreparedHierarchy;
  readonly dimensions: Required<HierarchyGeometryOptions>;
}

export function prepareHierarchy(
  inputs: VisualizationInputs,
  view: 'tree' | 'treemap',
  options: HierarchyGeometryOptions,
): Outcome<PreparedHierarchyInput> {
  const checked = bindForView(inputs, view);
  if (!checked.ok) return checked;
  const spec = checked.value.bound.spec;
  if (spec.view !== view) return fail('view', `Expected a ${view} visualization specification.`);
  const nodeFields = fieldsFor(checked.value.result, spec.node);
  if (!nodeFields.ok) return nodeFields;
  const parentFields = fieldsFor(checked.value.result, spec.parent);
  if (!parentFields.ok) return parentFields;
  const labelField = findLabelField(spec.label, checked.value.result);
  const dimensions = optionsFor(inputs, options);
  const budget = validateGeometryBudget(dimensions.width, dimensions.height, dimensions.maxMarks);
  if (!budget.ok) return budget;
  if (exceedsRowBudget(checked.value.rows, checked.value.result))
    return fail('budget', 'The authorized hierarchy rows exceed the bounded materialization work budget.');
  return {
    ok: true,
    value: {
      prepared: {
        bound: checked.value.bound,
        result: checked.value.result,
        rows: checked.value.rows,
        nodeFields: nodeFields.value,
        parentFields: parentFields.value,
        ...(labelField === undefined ? {} : { labelField }),
      },
      dimensions,
    },
  };
}

function findLabelField(id: string | undefined, result: Result): PreparedHierarchy['labelField'] {
  if (id === undefined) return undefined;
  return result.fields.find((field) => field.id === id);
}

function exceedsRowBudget(rows: readonly VisualizationRow[], result: Result): boolean {
  return rows.length > MAX_ROWS || rows.length * result.fields.length > MAX_WORK;
}
