import type { Outcome, Task } from '../../contracts/types.js';
import type { ResolvedPresentationNode } from '../types.js';
import { presentationFailure as fail, versionKey } from '../registry.js';
import type {
  PresentationCoverageAnalysis,
  PresentationPlanLike,
  PresentationTreeCacheEntry,
  PresentationValidationCache,
} from './types.js';

function sameTreeShape(entry: PresentationTreeCacheEntry, plan: PresentationPlanLike): boolean {
  if (entry.rootId !== plan.rootId || entry.nodeIds.length !== plan.nodes.length) return false;
  for (let index = 0; index < plan.nodes.length; index++) {
    const cachedChildren = entry.children[index]!;
    const candidate = plan.nodes[index]!;
    const candidateChildren = candidate.children;
    if (entry.nodeIds[index] !== candidate.id) return false;
    if (cachedChildren === candidateChildren) continue;
    if (cachedChildren.length !== candidateChildren.length) return false;
    if (cachedChildren.some((child, childIndex) => child !== candidateChildren[childIndex])) return false;
  }
  return true;
}

function visitReachableTree(
  rootId: string,
  childrenById: ReadonlyMap<string, readonly string[]>,
): Set<string> | undefined {
  const pending = [rootId];
  const visited = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]!;
    if (visited.has(id)) return undefined;
    visited.add(id);
    pending.push(...childrenById.get(id)!);
  }
  return visited;
}

function buildTreeEntry(
  plan: PresentationPlanLike,
  cache: PresentationValidationCache,
): Outcome<PresentationTreeCacheEntry> {
  for (const entry of cache.treeEntries) {
    if (sameTreeShape(entry, plan)) return { ok: true, value: entry };
  }
  const nodeIds = plan.nodes.map((node) => node.id);
  const children = plan.nodes.map((node) => node.children);

  const childrenById = new Map(plan.nodes.map((node) => [node.id, node.children]));
  if (childrenById.size !== plan.nodes.length || !childrenById.has(plan.rootId))
    return fail('tree', 'Node IDs must be unique and the root must exist.');
  const parents = new Map<string, string>();
  for (const node of plan.nodes) {
    for (const child of node.children) {
      if (!childrenById.has(child) || child === plan.rootId || parents.has(child))
        return fail('tree', 'Rendered nodes must form one tree with unique parent ownership.');
      parents.set(child, node.id);
    }
  }
  const reachable = visitReachableTree(plan.rootId, childrenById);
  if (reachable === undefined) return fail('tree', 'Containment cycles are not allowed.');
  if (reachable.size !== childrenById.size) return fail('tree', 'All nodes must be reachable from the declared root.');

  const entry: PresentationTreeCacheEntry = {
    rootId: plan.rootId,
    nodeIds,
    nodeIndexes: new Map(nodeIds.map((id, index) => [id, index])),
    children,
    childrenById,
    parents,
  };
  cache.treeEntries.push(entry);
  return { ok: true, value: entry };
}

export function preparePresentationTree(
  plan: PresentationPlanLike,
  cache: PresentationValidationCache,
): Outcome<PresentationTreeCacheEntry> {
  return buildTreeEntry(plan, cache);
}

export function coverageNodes(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  tree: PresentationTreeCacheEntry,
): readonly (ResolvedPresentationNode | undefined)[] {
  const nodes: (ResolvedPresentationNode | undefined)[] = [];
  for (const entry of plan.coverage) {
    for (const id of entry.nodeIds) {
      const index = tree.nodeIndexes.get(id);
      nodes.push(index === undefined ? undefined : resolved[index]);
    }
  }
  return nodes;
}

type CoverageEntry = PresentationPlanLike['coverage'][number];

function validateCoverageShape(entry: CoverageEntry, coverage: ReadonlyMap<string, CoverageEntry>): Outcome<undefined> {
  const duplicateNodes = new Set(entry.nodeIds).size !== entry.nodeIds.length;
  const duplicateOperations = new Set(entry.operations.map(versionKey)).size !== entry.operations.length;
  if (coverage.has(entry.needId) || duplicateNodes || duplicateOperations)
    return fail('coverage', 'Coverage entries must identify unique needs, nodes and operations.');
  return { ok: true, value: undefined };
}

function findCoverageNeed(entry: CoverageEntry, cache: PresentationValidationCache): Outcome<Task['needs'][number]> {
  const need = cache.taskNeeds.get(entry.needId);
  if (need === undefined || !entry.operations.some((operation) => versionKey(operation) === versionKey(need.operation)))
    return fail('coverage', 'Coverage must identify a declared task operation.');
  return { ok: true, value: need };
}

function addCoverageNodeFields(
  entry: CoverageEntry,
  need: Task['needs'][number],
  byId: ReadonlyMap<string, ResolvedPresentationNode>,
  cache: PresentationValidationCache,
  fields: Set<string>,
): Outcome<undefined> {
  for (const id of entry.nodeIds) {
    const node = byId.get(id);
    if (node === undefined) return fail('coverage', 'Coverage points to a missing node.');
    if (need.outputId !== undefined && node.result?.ref.outputId !== need.outputId)
      return fail('coverage', 'The operation is bound to a different task output.');
    const supportsOperations = entry.operations.every((operation) =>
      (node.config.operations ?? []).some((supported) => versionKey(supported) === versionKey(operation)),
    );
    if (!supportsOperations)
      return fail('coverage', 'The representation configuration does not support the claimed operation.');
    if (
      cache.allowedOperations !== undefined &&
      !entry.operations.every((operation) => cache.allowedOperations!.has(versionKey(operation)))
    )
      return fail('restricted', 'An operation is restricted by the active experience.');
    node.config.fields.forEach((field) => fields.add(field));
  }
  if (need.fields.some((field) => !fields.has(field)))
    return fail('coverage', 'The required fields are not supplied by the claimed views.');
  return { ok: true, value: undefined };
}

function requiredCoverageMissing(
  coverage: ReadonlyMap<string, CoverageEntry>,
  operations: ReadonlySet<string>,
  cache: PresentationValidationCache,
): boolean {
  for (const need of cache.taskNeeds.values()) if (need.required && !coverage.has(need.id)) return true;
  for (const operation of cache.requiredOperations) if (!operations.has(operation)) return true;
  return false;
}

export function prepareCoverage(
  plan: PresentationPlanLike,
  byId: ReadonlyMap<string, ResolvedPresentationNode>,
  cache: PresentationValidationCache,
): Outcome<PresentationCoverageAnalysis> {
  const coverage = new Map<string, CoverageEntry>();
  const operations = new Set<string>();
  for (const entry of plan.coverage) {
    const shape = validateCoverageShape(entry, coverage);
    if (!shape.ok) return shape;
    const need = findCoverageNeed(entry, cache);
    if (!need.ok) return need;
    const fields = new Set<string>();
    const nodes = addCoverageNodeFields(entry, need.value, byId, cache, fields);
    if (!nodes.ok) return nodes;
    coverage.set(need.value.id, entry);
    entry.operations.forEach((operation) => operations.add(operation.id));
  }
  if (requiredCoverageMissing(coverage, operations, cache))
    return fail('coverage', 'The candidate omits a required operation.');
  return { ok: true, value: { coverage, operations } };
}

function comparisonGroups(
  coverage: ReadonlyMap<string, CoverageEntry>,
  needs: readonly Task['needs'][number][],
): readonly ReadonlySet<string>[] {
  const groups = new Map<string, Set<string>>();
  for (const need of needs) {
    const entry = coverage.get(need.id);
    if (entry === undefined) continue;
    const key = need.simultaneousGroup ?? `need:${need.id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = new Set<string>();
      groups.set(key, group);
    }
    entry.nodeIds.forEach((id) => group!.add(id));
  }
  return [...groups.values()].filter((group) => group.size > 1);
}

function recordsExclusiveBranches(
  nodeId: string,
  parents: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, ResolvedPresentationNode>,
  manifests: PresentationValidationCache['manifests'],
  branches: Map<string, string>,
): boolean {
  let child = nodeId;
  for (let parent = parents.get(child); parent !== undefined; parent = parents.get(child)) {
    const ancestor = byId.get(parent)!;
    const manifest = manifests.get(versionKey(ancestor.manifest))!;
    if (manifest.visibility === 'exclusive') {
      const previousBranch = branches.get(parent);
      if (previousBranch !== undefined && previousBranch !== child) return false;
      branches.set(parent, child);
    }
    child = parent;
  }
  return true;
}

function groupHidesComparison(
  group: ReadonlySet<string>,
  parents: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, ResolvedPresentationNode>,
  manifests: PresentationValidationCache['manifests'],
): boolean {
  const branches = new Map<string, string>();
  for (const id of group) {
    if (!recordsExclusiveBranches(id, parents, byId, manifests, branches)) return true;
  }
  return false;
}

export function validateSimultaneousCoverage(
  analysis: PresentationCoverageAnalysis,
  needs: readonly Task['needs'][number][],
  parents: ReadonlyMap<string, string>,
  resolved: readonly ResolvedPresentationNode[],
  cache: PresentationValidationCache,
  existingById?: ReadonlyMap<string, ResolvedPresentationNode>,
): Outcome<undefined> {
  const hasPotentialComparison =
    [...analysis.coverage.values()].some((entry) => entry.nodeIds.length > 1) ||
    needs.some((need) => need.simultaneousGroup !== undefined);
  if (!hasPotentialComparison) return { ok: true, value: undefined };
  const byId = existingById ?? new Map(resolved.map((node) => [node.node.id, node]));
  const groups = comparisonGroups(analysis.coverage, needs);
  for (const group of groups) {
    if (groupHidesComparison(group, parents, byId, cache.manifests))
      return fail('simultaneous', 'An exclusive container hides an essential comparison.');
  }
  return { ok: true, value: undefined };
}
