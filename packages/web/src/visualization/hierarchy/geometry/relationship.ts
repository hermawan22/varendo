import type { Catalog, Outcome, Result, Scalar, SemanticType } from '@varendo/core';
import type { BoundVisualization } from '@varendo/core/visualization';
import type { VisualizationInputs, VisualizationRow } from '../../types.js';
import {
  bindForView,
  compareIdentity,
  fail,
  fieldsFor,
  keyFor,
  labelFor,
  optionsFor,
  validateGeometryBudget,
} from './shared.js';
import type {
  HierarchyGeometryOptions,
  RelationshipEdgeGeometry,
  RelationshipGeometry,
  RelationshipNodeGeometry,
} from './types.js';

const MAX_ROWS = 10_000;
const MAX_WORK = 100_000;
const MAX_GROUPS = 2_048;

type Cardinality = Catalog['relationships'][number]['cardinality'];
type RelationshipField = { readonly id: string; readonly type: SemanticType };

interface PreparedRelationship {
  readonly bound: BoundVisualization;
  readonly result: Result;
  readonly rows: readonly VisualizationRow[];
  readonly sourceFields: readonly RelationshipField[];
  readonly targetFields: readonly RelationshipField[];
  readonly labelField?: RelationshipField;
  readonly cardinality: Cardinality;
  readonly width: number;
  readonly height: number;
  readonly maxMarks: number;
}

interface RelationshipCollection {
  readonly sourceCounts: Map<string, Set<string>>;
  readonly targetCounts: Map<string, Set<string>>;
  readonly edgePairs: Set<string>;
  readonly edges: RelationshipEdgeGeometry[];
  readonly sourceNodes: Map<string, RelationshipNodeGeometry>;
  readonly targetNodes: Map<string, RelationshipNodeGeometry>;
}

function rowBudgetExceeded(rows: readonly VisualizationRow[], result: Result): boolean {
  return rows.length > MAX_ROWS || rows.length * result.fields.length > MAX_WORK;
}

function relationshipLabelField(id: string | undefined, result: Result): RelationshipField | undefined {
  if (id === undefined) return undefined;
  return result.fields.find((field) => field.id === id);
}

function prepareRelationship(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions,
): Outcome<PreparedRelationship> {
  const checked = bindForView(inputs, 'relationship');
  if (!checked.ok) return checked;
  const spec = checked.value.bound.spec;
  if (spec.view !== 'relationship') return fail('view', 'Expected a relationship visualization specification.');
  const relation = checked.value.bound.relationship;
  if (relation === undefined) return fail('relationship', 'The authorized relationship is unavailable.');
  const sourceFields = fieldsFor(checked.value.result, spec.source);
  if (!sourceFields.ok) return sourceFields;
  const targetFields = fieldsFor(checked.value.result, spec.target);
  if (!targetFields.ok) return targetFields;
  const labelField = relationshipLabelField(spec.label, checked.value.result);
  const dimensions = optionsFor(inputs, options);
  const budget = validateGeometryBudget(dimensions.width, dimensions.height, dimensions.maxMarks);
  if (!budget.ok) return budget;
  if (rowBudgetExceeded(checked.value.rows, checked.value.result))
    return fail('budget', 'The authorized relationship rows exceed the bounded materialization work budget.');
  return {
    ok: true,
    value: {
      bound: checked.value.bound,
      result: checked.value.result,
      rows: checked.value.rows,
      sourceFields: sourceFields.value,
      targetFields: targetFields.value,
      ...(labelField === undefined ? {} : { labelField }),
      cardinality: relation.cardinality,
      width: dimensions.width,
      height: dimensions.height,
      maxMarks: dimensions.maxMarks,
    },
  };
}

function endpointKey(values: Readonly<Record<string, Scalar>>, fields: readonly RelationshipField[]): Outcome<string> {
  const key = keyFor(values, fields, false);
  if (!key.ok) return key;
  if (key.value === undefined)
    return fail('relationship-endpoint', 'Relationship endpoint identities must be non-null.');
  return { ok: true, value: key.value };
}

function endpointLabel(values: Readonly<Record<string, Scalar>>, fields: readonly RelationshipField[]): string {
  return fields.map((field) => labelFor(values, field, 'Missing')).join(', ');
}

function rememberNode(
  nodes: Map<string, RelationshipNodeGeometry>,
  identity: string,
  namespace: 'source' | 'target',
  label: string,
): void {
  if (nodes.has(identity)) return;
  nodes.set(identity, { identity, namespace, label, x: 0, y: 0 });
}

function rememberEndpointCount(counts: Map<string, Set<string>>, key: string, related: string): void {
  const values = counts.get(key) ?? new Set<string>();
  values.add(related);
  counts.set(key, values);
}

function rowEdge(
  row: VisualizationRow,
  prepared: PreparedRelationship,
): Outcome<{
  readonly source: string;
  readonly target: string;
  readonly edge: RelationshipEdgeGeometry;
}> {
  const sourceKey = endpointKey(row.values, prepared.sourceFields);
  if (!sourceKey.ok) return sourceKey;
  const targetKey = endpointKey(row.values, prepared.targetFields);
  if (!targetKey.ok) return targetKey;
  const source = 'source:' + sourceKey.value;
  const target = 'target:' + targetKey.value;
  const sourceText = endpointLabel(row.values, prepared.sourceFields);
  const targetText = endpointLabel(row.values, prepared.targetFields);
  const edge: RelationshipEdgeGeometry = {
    identity: row.identity,
    source,
    target,
    sourceLabel: sourceText,
    targetLabel: targetText,
    ...(prepared.labelField === undefined ? {} : { label: labelFor(row.values, prepared.labelField, '') }),
  };
  return { ok: true, value: { source, target, edge } };
}

function addRow(
  row: VisualizationRow,
  prepared: PreparedRelationship,
  collection: RelationshipCollection,
): Outcome<true> {
  const edge = rowEdge(row, prepared);
  if (!edge.ok) return edge;
  const sourceKey = edge.value.source.slice('source:'.length);
  const targetKey = edge.value.target.slice('target:'.length);
  const pair = sourceKey + '\u0000' + targetKey;
  if (prepared.cardinality !== 'many-to-many' && collection.edgePairs.has(pair))
    return fail('cardinality', 'The materialized relationship repeats an edge under a unique endpoint cardinality.');
  collection.edgePairs.add(pair);
  rememberNode(collection.sourceNodes, edge.value.source, 'source', edge.value.edge.sourceLabel);
  rememberNode(collection.targetNodes, edge.value.target, 'target', edge.value.edge.targetLabel);
  rememberEndpointCount(collection.sourceCounts, sourceKey, targetKey);
  rememberEndpointCount(collection.targetCounts, targetKey, sourceKey);
  collection.edges.push(edge.value.edge);
  return { ok: true, value: true };
}

function collectRelationshipRows(prepared: PreparedRelationship): Outcome<RelationshipCollection> {
  const collection: RelationshipCollection = {
    sourceCounts: new Map(),
    targetCounts: new Map(),
    edgePairs: new Set(),
    edges: [],
    sourceNodes: new Map(),
    targetNodes: new Map(),
  };
  for (const row of prepared.rows) {
    const added = addRow(row, prepared, collection);
    if (!added.ok) return added;
  }
  return { ok: true, value: collection };
}

function hasMultiple(values: Map<string, Set<string>>): boolean {
  return [...values.values()].some((related) => related.size > 1);
}

const CARDINALITY_VIOLATIONS: Readonly<Partial<Record<Cardinality, (collection: RelationshipCollection) => boolean>>> =
  {
    'one-to-one': (collection) => hasMultiple(collection.sourceCounts) || hasMultiple(collection.targetCounts),
    'many-to-one': (collection) => hasMultiple(collection.sourceCounts),
    'one-to-many': (collection) => hasMultiple(collection.targetCounts),
  };

function validateCardinality(cardinality: Cardinality, collection: RelationshipCollection): Outcome<true> {
  if (CARDINALITY_VIOLATIONS[cardinality]?.(collection) === true)
    return fail('cardinality', `The materialized relationship violates ${cardinality} cardinality.`);
  return { ok: true, value: true };
}

function exceededGroupLimit(collection: RelationshipCollection): boolean {
  return collection.sourceNodes.size > MAX_GROUPS || collection.targetNodes.size > MAX_GROUPS;
}

function dataOnlyRelationship(prepared: PreparedRelationship, reason: string): Outcome<RelationshipGeometry> {
  return {
    ok: true,
    value: Object.freeze({
      kind: 'relationship',
      state: 'data-only',
      reason,
      bound: prepared.bound,
      result: prepared.result,
      rows: prepared.rows,
      nodes: Object.freeze([]),
      edges: Object.freeze([]),
      width: prepared.width,
      height: prepared.height,
      cardinality: prepared.cardinality,
    }),
  };
}

function arrangeNodes(
  values: readonly RelationshipNodeGeometry[],
  x: number,
  height: number,
): readonly RelationshipNodeGeometry[] {
  const gap = values.length > 1 ? (height - 88) / (values.length - 1) : 0;
  return values.map((node, index) => ({ ...node, x, y: 72 + index * gap }));
}

function orderedNodes(
  collection: RelationshipCollection,
  prepared: PreparedRelationship,
): readonly RelationshipNodeGeometry[] {
  const sourceNodes = [...collection.sourceNodes.values()].sort((left, right) =>
    compareIdentity(left.identity, right.identity),
  );
  const targetNodes = [...collection.targetNodes.values()].sort((left, right) =>
    compareIdentity(left.identity, right.identity),
  );
  return Object.freeze([
    ...arrangeNodes(sourceNodes, prepared.width * 0.25, prepared.height),
    ...arrangeNodes(targetNodes, prepared.width * 0.75, prepared.height),
  ]);
}

function exceedsGeometryBudget(
  collection: RelationshipCollection,
  nodes: readonly RelationshipNodeGeometry[],
  prepared: PreparedRelationship,
): boolean {
  if (collection.edges.length + nodes.length > prepared.maxMarks) return true;
  const crowded = Math.max(collection.sourceNodes.size, collection.targetNodes.size);
  return crowded > Math.floor((prepared.height - 88) / 24) + 1;
}

function relationshipGeometry(
  prepared: PreparedRelationship,
  collection: RelationshipCollection,
  nodes: readonly RelationshipNodeGeometry[],
): Outcome<RelationshipGeometry> {
  return {
    ok: true,
    value: Object.freeze({
      kind: 'relationship',
      state: 'geometry',
      bound: prepared.bound,
      result: prepared.result,
      rows: prepared.rows,
      nodes,
      edges: Object.freeze(collection.edges),
      width: prepared.width,
      height: prepared.height,
      cardinality: prepared.cardinality,
    }),
  };
}

export function compileRelationshipGeometry(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions = {},
): Outcome<RelationshipGeometry> {
  const prepared = prepareRelationship(inputs, options);
  if (!prepared.ok) return prepared;
  const collection = collectRelationshipRows(prepared.value);
  if (!collection.ok) return collection;
  const cardinality = validateCardinality(prepared.value.cardinality, collection.value);
  if (!cardinality.ok) return cardinality;
  if (exceededGroupLimit(collection.value)) {
    const reason =
      'Relationship endpoint groups exceed the ' +
      MAX_GROUPS +
      ' group bound. Exact values remain available in the data table.';
    return dataOnlyRelationship(prepared.value, reason);
  }
  const nodes = orderedNodes(collection.value, prepared.value);
  if (exceedsGeometryBudget(collection.value, nodes, prepared.value)) {
    const reason =
      'The relationship exceeds the configured mark budget or readable graphic density. Exact values remain available in the data table.';
    return dataOnlyRelationship(prepared.value, reason);
  }
  return relationshipGeometry(prepared.value, collection.value, nodes);
}
