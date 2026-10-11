import type { Catalog, MeaningDefinition, Outcome } from '../../contracts/types.js';
import { inspectWire } from '../../contracts/ingress.js';
import { WIRE_LIMITS } from '../../contracts/limits.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type { LogicalPlan, PlanNode, QueryLimits, QuerySchema } from '../types.js';
import { validatePlanSemantics } from '../planner.js';
import { failure, isPlainDataRecord, isRecord, planId, stable, type PlanRecord } from './shared.js';
import { validQuerySchema } from './validation-common.js';
import { sameIds, validateNode, validNodeCost, validNodeShape, type ValidNode } from './node-validation.js';

interface ValidatedPlan extends PlanRecord {
  readonly version: '1';
  readonly pins: PlanRecord;
  readonly root: string;
  readonly nodes: readonly unknown[];
  readonly output: QuerySchema;
  readonly cost: PlanRecord;
  readonly canonical: string;
  readonly planKey: string;
  readonly explain: readonly unknown[];
}

function validateWireEnvelope(input: unknown): Outcome<PlanRecord> {
  if (!isPlainDataRecord(input) || typeof input.canonical !== 'string' || typeof input.planKey !== 'string')
    return failure('query.plan', 'Logical plan must contain data properties and canonical identity strings.');
  const properties = Object.getOwnPropertyNames(input);
  if (properties.some((key) => Object.getOwnPropertyDescriptor(input, key)?.enumerable !== true))
    return failure('query.plan', 'Logical plan properties must be enumerable JSON data.');
  if (input.canonical.length > WIRE_LIMITS.bytes || input.planKey.length > WIRE_LIMITS.bytes)
    return failure('query.budget', 'Logical plan identity exceeds the bounded plan size.');
  const ingress = inspectWire({ ...input, canonical: '', planKey: '' });
  if (!ingress.ok) return ingress;
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > WIRE_LIMITS.bytes)
    return failure('query.budget', 'Logical plan exceeds the bounded document byte size.');
  return { ok: true, value: input };
}

function validPlanIdentity(input: PlanRecord): boolean {
  return (
    input.version === '1' &&
    isRecord(input.pins) &&
    planId(input.pins.catalogRevision) &&
    planId(input.pins.functionRegistryDigest) &&
    planId(input.root) &&
    typeof input.canonical === 'string' &&
    typeof input.planKey === 'string'
  );
}

function validPlanPayload(input: PlanRecord, catalog: Catalog): boolean {
  return (
    Array.isArray(input.nodes) &&
    input.nodes.length > 0 &&
    validQuerySchema(input.output, catalog) &&
    validNodeCost(input.cost) &&
    Array.isArray(input.explain)
  );
}

function validOptionalPins(pins: PlanRecord): boolean {
  for (const key of ['sourceRevision', 'scopeDigest', 'policyRevision'] as const) {
    if (pins[key] !== undefined && !planId(pins[key])) return false;
  }
  return true;
}

function validatePlanHeader(input: PlanRecord, catalog: Catalog, registry: FunctionRegistry): Outcome<ValidatedPlan> {
  if (!validPlanIdentity(input) || !validPlanPayload(input, catalog))
    return failure('query.plan', 'Logical plan shape is invalid.');
  const pins = input.pins as PlanRecord;
  if (pins.catalogRevision !== catalog.revision || pins.functionRegistryDigest !== registry.digest)
    return failure('query.stale-plan', 'The logical plan is stale for the current catalog or function registry.');
  if (!validOptionalPins(pins)) return failure('query.plan', 'Logical plan contains an invalid optional pin.');
  return { ok: true, value: input as ValidatedPlan };
}

function registerNode(value: unknown, nodes: Map<string, ValidNode>, catalog: Catalog): Outcome<void> {
  if (!isRecord(value) || !validNodeShape(value, catalog) || nodes.has(value.id))
    return failure('query.plan', 'Logical plan node identifiers must be unique and bounded.');
  nodes.set(value.id, value);
  return { ok: true, value: undefined };
}

function buildNodeMap(values: readonly unknown[], catalog: Catalog): Outcome<Map<string, ValidNode>> {
  const nodes = new Map<string, ValidNode>();
  for (const value of values) {
    const checked = registerNode(value, nodes, catalog);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: nodes };
}

function nodePlanMap(nodes: ReadonlyMap<string, ValidNode>): Map<string, PlanNode> {
  return new Map([...nodes].map(([id, node]) => [id, node as unknown as PlanNode]));
}

function validateNodeInputs(
  nodes: ReadonlyMap<string, ValidNode>,
  registry: FunctionRegistry,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
): Outcome<void> {
  const planNodes = nodePlanMap(nodes);
  for (const node of nodes.values()) {
    for (const inputId of node.inputs) {
      if (!planNodes.has(inputId)) return failure('query.plan', `Logical plan input ${inputId} is missing.`);
    }
    const inputs = node.inputs.map((inputId) => planNodes.get(inputId)!);
    const checked = validateNode(node, inputs, nodes, catalog, registry, definitions);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function visitNode(
  id: string,
  nodes: ReadonlyMap<string, PlanNode>,
  visiting: Set<string>,
  visited: Set<string>,
  maxDepth: number,
  depth: number,
): Outcome<void> {
  if (depth > maxDepth) return failure('query.budget', 'Logical plan exceeds the effective depth budget.');
  if (visiting.has(id)) return failure('query.plan', 'Logical plan contains a cycle.');
  if (visited.has(id)) return { ok: true, value: undefined };
  visiting.add(id);
  const node = nodes.get(id);
  if (node === undefined) return failure('query.plan', `Logical plan input ${id} is missing.`);
  for (const inputId of node.inputs) {
    const checked = visitNode(inputId, nodes, visiting, visited, maxDepth, depth + 1);
    if (!checked.ok) return checked;
  }
  visiting.delete(id);
  visited.add(id);
  return { ok: true, value: undefined };
}

function validateGraph(nodes: ReadonlyMap<string, PlanNode>, root: string, maxDepth: number): Outcome<void> {
  if (!nodes.has(root)) return failure('query.plan', 'Logical plan root is missing.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const checked = visitNode(root, nodes, visiting, visited, maxDepth, 1);
  if (!checked.ok) return checked;
  if (visited.size !== nodes.size) return failure('query.plan', 'Logical plan contains unreachable nodes.');
  return { ok: true, value: undefined };
}

function validateNodeBudgets(nodes: readonly PlanNode[], cost: PlanRecord): Outcome<void> {
  if (cost.nodes !== nodes.length) return failure('query.plan', 'Logical plan node cost sequence is invalid.');
  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]!.cost;
    if (current.nodes !== index + 1) return failure('query.plan', 'Logical plan node cost sequence is invalid.');
    const previous = nodes[index - 1]?.cost;
    if (previous !== undefined && current.operations < previous.operations)
      return failure('query.plan', 'Logical plan operation costs are not monotonic.');
  }
  return { ok: true, value: undefined };
}

function validateRootMetadata(plan: ValidatedPlan, nodes: ReadonlyMap<string, PlanNode>): Outcome<void> {
  const root = nodes.get(plan.root);
  if (root === undefined) return failure('query.plan', 'Logical plan root is missing.');
  if (stable(plan.output) === stable(root.output) && stable(plan.cost) === stable(root.cost))
    return { ok: true, value: undefined };
  return failure('query.plan', 'Logical plan cost or output metadata is inconsistent.');
}

function validateCanonicalIdentity(plan: ValidatedPlan): Outcome<void> {
  const canonical = stable({ version: '1', pins: plan.pins, root: plan.root, nodes: plan.nodes });
  if (plan.canonical === canonical && plan.planKey === `query-${canonical}`) return { ok: true, value: undefined };
  return failure('query.plan', 'Logical plan canonical identity does not match its contents.');
}

function explanationInputIds(entry: unknown): readonly string[] {
  if (!isRecord(entry) || !Array.isArray(entry.inputIds)) return [];
  return entry.inputIds.filter((id): id is string => typeof id === 'string');
}

function validateExplanationEntry(entry: unknown, node: PlanNode): boolean {
  return (
    isRecord(entry) &&
    entry.operation === node.op &&
    sameIds(explanationInputIds(entry), node.inputs) &&
    entry.estimatedRows === node.cost.estimatedRows &&
    entry.estimatedBytes === node.cost.estimatedBytes
  );
}

function validateExplanation(plan: ValidatedPlan, nodes: readonly PlanNode[]): Outcome<void> {
  if (plan.explain.length !== nodes.length)
    return failure('query.plan', 'Logical plan explanation is not aligned with its nodes.');
  const ids = plan.explain.map((entry) => (isRecord(entry) ? String(entry.nodeId) : ''));
  if (
    !sameIds(
      ids,
      nodes.map((node) => node.id),
    )
  )
    return failure('query.plan', 'Logical plan explanation is not aligned with its nodes.');
  for (let index = 0; index < plan.explain.length; index += 1) {
    if (!validateExplanationEntry(plan.explain[index], nodes[index]!))
      return failure('query.plan', 'Logical plan explanation metadata is inconsistent.');
  }
  return { ok: true, value: undefined };
}

function validatePlanNodes(
  plan: ValidatedPlan,
  limits: QueryLimits,
  registry: FunctionRegistry,
  catalog: Catalog,
  definitions: readonly MeaningDefinition[],
): Outcome<Map<string, ValidNode>> {
  if (plan.nodes.length > limits.maxNodes)
    return failure('query.budget', 'Logical plan exceeds the effective node budget.');
  const map = buildNodeMap(plan.nodes, catalog);
  if (!map.ok) return map;
  const inputs = validateNodeInputs(map.value, registry, catalog, definitions);
  if (!inputs.ok) return inputs;
  return map;
}

function validatePlanMetadata(plan: ValidatedPlan, nodes: ReadonlyMap<string, PlanNode>): Outcome<void> {
  const root = validateRootMetadata(plan, nodes);
  if (!root.ok) return root;
  const ordered = plan.nodes as readonly PlanNode[];
  const costs = validateNodeBudgets(ordered, plan.cost);
  if (!costs.ok) return costs;
  const identity = validateCanonicalIdentity(plan);
  if (!identity.ok) return identity;
  return validateExplanation(plan, ordered);
}

export function validateLogicalPlan(
  input: unknown,
  catalog: Catalog,
  registry: FunctionRegistry,
  limits: QueryLimits,
  definitions: readonly MeaningDefinition[] = [],
): Outcome<LogicalPlan> {
  const envelope = validateWireEnvelope(input);
  if (!envelope.ok) return envelope;
  const header = validatePlanHeader(envelope.value, catalog, registry);
  if (!header.ok) return header;
  const nodeMap = validatePlanNodes(header.value, limits, registry, catalog, definitions);
  if (!nodeMap.ok) return nodeMap;
  const nodes = nodePlanMap(nodeMap.value);
  const graph = validateGraph(nodes, header.value.root, limits.maxDepth);
  if (!graph.ok) return graph;
  const metadata = validatePlanMetadata(header.value, nodes);
  if (!metadata.ok) return metadata;
  const plan = header.value as unknown as LogicalPlan;
  const semantics = validatePlanSemantics(plan, catalog, registry);
  return semantics.ok ? { ok: true, value: plan } : semantics;
}
