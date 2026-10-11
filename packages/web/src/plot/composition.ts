import { bindPlotSpec } from '@varendo/core/plot';
import { scalarIdentity, parseWireValue } from '@varendo/core';
import type { PlotSpec, PlotNode, PlotUnit, Result, ResultRef, Scalar, Outcome } from '@varendo/core';
import { compilePlotUnit } from './geometry.js';
import type { PlotGeometry, PlotDatum, PlotGeometryOptions, PlotProjection } from './geometry.js';
import { exactLabel } from './scales.js';

export interface PlotDataset {
  readonly result: ResultRef;
  readonly rows: readonly Readonly<Record<string, Scalar>>[];
}

export type CompiledPlotNode =
  | { readonly kind: 'unit'; readonly geometry: PlotGeometry; readonly displayedIdentities: readonly string[] }
  | {
      readonly kind: 'layer';
      readonly scales: 'shared-compatible' | 'independent';
      readonly children: readonly CompiledPlotNode[];
    }
  | { readonly kind: 'concat'; readonly direction: 'inline' | 'block'; readonly children: readonly CompiledPlotNode[] }
  | {
      readonly kind: 'facet';
      readonly field: string;
      readonly scales: 'shared-compatible' | 'independent';
      readonly children: readonly { readonly key: string; readonly label: string; readonly node: CompiledPlotNode }[];
    };

export interface CompiledPlot {
  readonly spec: PlotSpec;
  readonly root: CompiledPlotNode;
}

interface Prepared {
  readonly unit: PlotUnit;
  readonly result: Result;
  readonly rows: readonly PlotDatum[];
  readonly raw: unknown;
}

interface Filter {
  readonly field: string;
  readonly key: string;
}

interface PreparedUnits {
  readonly byNode: ReadonlyMap<PlotNode, Prepared>;
  readonly work: number;
}

interface CompileContext {
  readonly prepared: ReadonlyMap<PlotNode, Prepared>;
  readonly options: PlotGeometryOptions;
  work: number;
  nodes: number;
  pixels: number;
  marks: number;
}

const refKey = (ref: ResultRef): string =>
  JSON.stringify([ref.id, ref.revision, ref.sourceLineage ?? null, ref.outputId, ref.queryDigest, ref.scopeDigest]);

function fail(message: string): Outcome<never> {
  return {
    ok: false,
    diagnostics: [{ code: 'plot.composition', message, retryable: false }],
  };
}

/** Compose already authorized data. Facets are display partitions, preserving the original Result references. */
export function compilePlotComposition(
  input: unknown,
  results: readonly Result[],
  datasets: readonly PlotDataset[],
  options: PlotGeometryOptions,
): Outcome<CompiledPlot> {
  const bound = bindPlotSpec(input, results);
  if (!bound.ok) return bound;
  const datasetRows = readDatasets(datasets);
  if (!datasetRows.ok) return datasetRows;
  const prepared = prepareUnits(bound.value.units, datasetRows.value, options);
  if (!prepared.ok) return prepared;
  const context: CompileContext = {
    prepared: prepared.value.byNode,
    options,
    work: prepared.value.work,
    nodes: 0,
    pixels: 0,
    marks: 0,
  };
  const root = visitNode(context, bound.value.spec.root, []);
  if (!root.ok) return root;
  return { ok: true, value: { spec: bound.value.spec, root: root.value } };
}

function readDatasets(datasets: readonly PlotDataset[]): Outcome<ReadonlyMap<string, unknown>> {
  const inspected = parseWireValue(datasets);
  if (!inspected.ok) return inspected;
  if (!Array.isArray(inspected.value) || inspected.value.length > 128)
    return fail('The dataset list is invalid or exceeds its bound.');
  const byRef = new Map<string, unknown>();
  for (const entry of inspected.value) {
    const dataset = asDataset(entry);
    if (!dataset.ok) return dataset;
    const key = refKey(dataset.value.result);
    if (byRef.has(key)) return fail('Dataset result references must be unique.');
    byRef.set(key, dataset.value.rows);
  }
  return { ok: true, value: byRef };
}

function asDataset(value: unknown): Outcome<PlotDataset> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('A dataset must be a record.');
  const dataset = value as PlotDataset;
  if (dataset.result === null || typeof dataset.result !== 'object' || !Array.isArray(dataset.rows))
    return fail('A dataset requires a result reference and row array.');
  return { ok: true, value: dataset };
}

function prepareUnits(
  units: readonly { readonly node: PlotUnit; readonly result: Result }[],
  datasets: ReadonlyMap<string, unknown>,
  options: PlotGeometryOptions,
): Outcome<PreparedUnits> {
  const byNode = new Map<PlotNode, Prepared>();
  let work = 0;
  for (const unit of units) {
    const raw = datasets.get(refKey(unit.result.ref));
    if (raw === undefined) return fail('An exact result dataset is unavailable.');
    work += unit.result.counts.loaded;
    if (work > 50_000) return fail('Composition exceeds its row-work budget.');
    const geometry = compilePlotUnit(unit.node, unit.result, raw, options);
    if (!geometry.ok) return geometry;
    byNode.set(unit.node, { unit: unit.node, result: unit.result, rows: geometry.value.rows, raw });
  }
  return { ok: true, value: { byNode, work } };
}

function descendants(node: PlotNode, prepared: ReadonlyMap<PlotNode, Prepared>): Prepared[] {
  switch (node.kind) {
    case 'unit':
      return [prepared.get(node)!];
    case 'facet':
      return descendants(node.child, prepared);
    default:
      return node.children.flatMap((child) => descendants(child, prepared));
  }
}

function matches(prepared: Prepared, row: PlotDatum, filters: readonly Filter[]): boolean {
  return filters.every((filter) => matchesFilter(prepared, row, filter));
}

function matchesFilter(prepared: Prepared, row: PlotDatum, filter: Filter): boolean {
  const field = prepared.result.fields.find((candidate) => candidate.id === filter.field);
  if (field === undefined) return false;
  const identity = scalarIdentity(row.values[filter.field], field.type);
  return identity.ok && identity.value === filter.key;
}

function collectDomains(
  node: PlotNode,
  filters: readonly Filter[],
  prepared: ReadonlyMap<PlotNode, Prepared>,
): PlotProjection['domains'] {
  const x: Scalar[] = [];
  const y: Scalar[] = [];
  for (const entry of descendants(node, prepared)) {
    for (const row of entry.rows) {
      if (!matches(entry, row, filters)) continue;
      appendUnitDomains(entry.unit, row, x, y);
    }
  }
  return { x, y };
}

function appendUnitDomains(unit: PlotUnit, row: PlotDatum, x: Scalar[], y: Scalar[]): void {
  const { encoding } = unit;
  x.push(row.values[encoding.x.field]!);
  y.push(row.values[encoding.y.field]!);
  if (encoding.x2) x.push(row.values[encoding.x2.field]!);
  if (encoding.y2) y.push(row.values[encoding.y2.field]!);
}

function resolveSharedDomains(
  node: PlotNode,
  filters: readonly Filter[],
  inherited: PlotProjection['domains'] | undefined,
  prepared: ReadonlyMap<PlotNode, Prepared>,
): Outcome<PlotProjection['domains'] | undefined> {
  if (inherited !== undefined) return { ok: true, value: inherited };
  if (node.kind === 'unit' || node.kind === 'concat') return { ok: true, value: undefined };
  if (node.scales !== 'shared-compatible') return { ok: true, value: undefined };
  const domains = collectDomains(node, filters, prepared);
  if (domains === undefined) return { ok: true, value: undefined };
  if (domains.x.length > 10_000 || domains.y.length > 10_000)
    return fail('Shared scale domains exceed their value budget.');
  return { ok: true, value: domains };
}

function visitNode(
  context: CompileContext,
  node: PlotNode,
  filters: readonly Filter[],
  inherited?: PlotProjection['domains'],
): Outcome<CompiledPlotNode> {
  context.nodes += 1;
  if (context.nodes > 128) return fail('Expanded plot composition exceeds 128 nodes.');
  if (node.kind === 'unit') return visitUnit(context, node, filters, inherited);
  const domains = resolveSharedDomains(node, filters, inherited, context.prepared);
  if (!domains.ok) return domains;
  if (node.kind === 'facet') return visitFacet(context, node, filters, domains.value);
  return visitChildren(context, node, filters, domains.value);
}

function visitUnit(
  context: CompileContext,
  node: Extract<PlotNode, { kind: 'unit' }>,
  filters: readonly Filter[],
  inherited: PlotProjection['domains'] | undefined,
): Outcome<CompiledPlotNode> {
  context.pixels += context.options.width * context.options.height;
  if (context.pixels > 16_000_000) return fail('Composition exceeds its total display-pixel budget.');
  const prepared = context.prepared.get(node)!;
  const identities = prepared.rows.filter((row) => matches(prepared, row, filters)).map((row) => row.identity);
  context.work += prepared.rows.length;
  if (context.work > 100_000) return fail('Expanded plot composition exceeds its row-work budget.');
  const geometry = compilePlotUnit(node, prepared.result, prepared.raw, context.options, {
    identities,
    ...(inherited === undefined ? {} : { domains: inherited }),
  });
  if (!geometry.ok) return geometry;
  return registerUnitGeometry(context, geometry.value, identities);
}

function registerUnitGeometry(
  context: CompileContext,
  geometry: PlotGeometry,
  identities: readonly string[],
): Outcome<CompiledPlotNode> {
  context.marks += geometryCost(geometry);
  if (context.marks > 100_000) return fail('Composition exceeds its total geometry budget.');
  return { ok: true, value: { kind: 'unit', geometry, displayedIdentities: identities } };
}

function geometryCost(geometry: PlotGeometry): number {
  return geometry.marks.reduce((total, mark) => total + (mark.kind === 'path' ? mark.identities.length : 1), 0);
}

function visitFacet(
  context: CompileContext,
  node: Extract<PlotNode, { kind: 'facet' }>,
  filters: readonly Filter[],
  shared: PlotProjection['domains'] | undefined,
): Outcome<CompiledPlotNode> {
  const groups = collectFacetGroups(context, node.child, node.field, filters);
  if (!groups.ok) return groups;
  const children: { key: string; label: string; node: CompiledPlotNode }[] = [];
  for (const [key, label] of groups.value) {
    const child = visitNode(context, node.child, [...filters, { field: node.field, key }], shared);
    if (!child.ok) return child;
    children.push({ key, label, node: child.value });
  }
  return { ok: true, value: { kind: 'facet', field: node.field, scales: node.scales, children } };
}

function collectFacetGroups(
  context: CompileContext,
  node: PlotNode,
  fieldId: string,
  filters: readonly Filter[],
): Outcome<Map<string, string>> {
  const groups = new Map<string, string>();
  for (const prepared of descendants(node, context.prepared)) {
    for (const row of prepared.rows) {
      if (!matches(prepared, row, filters)) continue;
      const added = addFacetGroup(groups, prepared, row, fieldId);
      if (!added.ok) return added;
      if (groups.size > 32) return fail('A facet exceeds 32 display groups.');
    }
  }
  return { ok: true, value: groups };
}

function addFacetGroup(
  groups: Map<string, string>,
  prepared: Prepared,
  row: PlotDatum,
  fieldId: string,
): Outcome<void> {
  const field = prepared.result.fields.find((candidate) => candidate.id === fieldId)!;
  const identity = scalarIdentity(row.values[fieldId], field.type);
  if (!identity.ok) return identity;
  groups.set(identity.value, exactLabel(row.values[fieldId]!));
  return { ok: true, value: undefined };
}

function visitChildren(
  context: CompileContext,
  node: Extract<PlotNode, { kind: 'layer' | 'concat' }>,
  filters: readonly Filter[],
  shared: PlotProjection['domains'] | undefined,
): Outcome<CompiledPlotNode> {
  const children: CompiledPlotNode[] = [];
  for (const childNode of node.children) {
    const child = visitNode(context, childNode, filters, shared);
    if (!child.ok) return child;
    children.push(child.value);
  }
  if (node.kind === 'concat') return { ok: true, value: { kind: 'concat', direction: node.direction, children } };
  return { ok: true, value: { kind: 'layer', scales: node.scales, children } };
}
