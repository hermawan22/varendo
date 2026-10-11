import { parsePresentationPlan } from '../../contracts/parse.js';
import { validateParsedCommitReadSet } from '../../contracts/commit.js';
import type { CommitPreconditions, Outcome, ResultRef } from '../../contracts/types.js';
import type { InteractionGraph } from '../../interaction/graph.js';
import type {
  PresentationContext,
  PresentationRegistry,
  ResolvedPresentationNode,
  ValidatedPresentation,
} from '../types.js';
import type { PresentationPlan } from '../../contracts/types.js';
import { freezePresentationContainer, presentationFailure as fail } from '../registry.js';
import type {
  CoverageCacheEntry,
  PresentationNodeResolutionInput,
  PresentationPlanLike,
  PresentationValidationCache,
  PresentationValidationOptions,
  PreparedPresentationContext,
  PresentationTreeCacheEntry,
} from './types.js';
import { preparePresentationContext, preparePresentationValidationCache } from './context.js';
import {
  preparePresentationTree,
  coverageNodes,
  prepareCoverage,
  validateSimultaneousCoverage,
} from './tree-coverage.js';
import { resolvePresentationNodes } from './nodes.js';
import { preparePresentationGraph } from './graph.js';
import { validatePresentationTransition } from './transition.js';
import { matchesPattern, patternIsAllowed } from './patterns.js';

interface PreparedPlanState {
  readonly cache: PresentationValidationCache;
  readonly tree: PresentationTreeCacheEntry;
}

interface PreparedCoverageState {
  readonly analysis: import('./types.js').PresentationCoverageAnalysis;
  readonly byId: ReadonlyMap<string, ResolvedPresentationNode> | undefined;
  readonly nodes: readonly (ResolvedPresentationNode | undefined)[];
}

function requiredResultReferences(
  plan: PresentationPlanLike,
  prepared: PreparedPresentationContext,
): readonly ResultRef[] {
  const references = [...prepared.taskStructure.resultReferences];
  for (const node of plan.nodes) if (node.result !== undefined) references.push(node.result);
  return references;
}

function findReadSetOutcome(
  references: readonly ResultRef[],
  plan: PresentationPlanLike,
  cache: PresentationValidationCache,
): Outcome<CommitPreconditions> | undefined {
  const outcomes = cache.readSetOutcomes.get(plan.preconditions as object);
  if (outcomes === undefined) return undefined;
  for (const entry of outcomes) {
    if (entry.references.length !== references.length) continue;
    if (entry.references.every((reference, index) => reference === references[index])) return entry.outcome;
  }
  return undefined;
}

function validatePlanReadSet(
  plan: PresentationPlanLike,
  prepared: PreparedPresentationContext,
  cache: PresentationValidationCache | undefined,
  ownedPlan: boolean,
): Outcome<CommitPreconditions> {
  const references = requiredResultReferences(plan, prepared);
  const memoizable = ownedPlan && cache !== undefined && Object.isFrozen(plan) && Object.isFrozen(plan.preconditions);
  if (!memoizable) return validateParsedCommitReadSet(plan.preconditions, prepared.current, references);

  let outcomes = cache.readSetOutcomes.get(plan.preconditions as object);
  if (outcomes === undefined) {
    outcomes = [];
    cache.readSetOutcomes.set(plan.preconditions as object, outcomes);
  }
  const cached = findReadSetOutcome(references, plan, cache);
  if (cached !== undefined) return cached;

  const outcome = validateParsedCommitReadSet(plan.preconditions, prepared.current, references);
  outcomes.push({ references, outcome });
  return outcome;
}

function acquireValidationCache(
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
  validationCache: PresentationValidationCache | undefined,
  manifestIndex: ReadonlyMap<string, PresentationRegistry['manifests'][number]> | undefined,
): Outcome<PresentationValidationCache> {
  if (validationCache === undefined) return preparePresentationValidationCache(prepared, registry, manifestIndex);
  if (validationCache.preparedContext !== prepared || validationCache.registry !== registry)
    return fail('cache', 'The presentation validation cache belongs to a different context or registry.');
  return { ok: true, value: validationCache };
}

function preparePlanState(
  plan: PresentationPlanLike,
  registry: PresentationRegistry,
  prepared: PreparedPresentationContext,
  validationCache: PresentationValidationCache | undefined,
  manifestIndex: ReadonlyMap<string, PresentationRegistry['manifests'][number]> | undefined,
  ownedPlan: boolean,
): Outcome<PreparedPlanState> {
  const { constraints, current } = prepared;
  if (
    constraints.task.revision !== current.taskRevision ||
    constraints.task.catalogRevision !== current.catalogRevision ||
    constraints.task.functionRegistryDigest !== current.functionRegistryDigest ||
    constraints.experience.revision !== current.experienceRevision
  )
    return fail('stale', 'The task or experience differs from the current version pins.');
  if (plan.nodes.length === 0 || plan.nodes.length > constraints.maxNodes)
    return fail('nodes', 'The candidate exceeds the permitted node count.');

  const readSet = validatePlanReadSet(plan, prepared, validationCache, ownedPlan);
  if (!readSet.ok) return readSet;
  const cache = acquireValidationCache(prepared, registry, validationCache, manifestIndex);
  if (!cache.ok) return cache;
  const tree = preparePresentationTree(plan, cache.value);
  if (!tree.ok) return tree;
  return { ok: true, value: { cache: cache.value, tree: tree.value } };
}

function matchingCoverageEntry(
  variants: readonly CoverageCacheEntry[] | undefined,
  nodes: PreparedCoverageState['nodes'],
): CoverageCacheEntry | undefined {
  return variants?.find(
    (entry) => entry.nodes.length === nodes.length && entry.nodes.every((node, index) => node === nodes[index]),
  );
}

function prepareCandidateCoverage(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  tree: PresentationTreeCacheEntry,
  cache: PresentationValidationCache,
): Outcome<PreparedCoverageState> {
  const nodes = coverageNodes(plan, resolved, tree);
  const variants = cache.coverageAnalyses.get(plan.coverage as object);
  const cached = matchingCoverageEntry(variants, nodes);
  if (cached !== undefined) {
    if (!cached.outcome.ok) return cached.outcome;
    return { ok: true, value: { analysis: cached.outcome.value, byId: undefined, nodes } };
  }

  const byId = new Map(resolved.map((node) => [node.node.id, node]));
  const outcome = prepareCoverage(plan, byId, cache);
  const entry = { nodes, outcome };
  if (variants === undefined) cache.coverageAnalyses.set(plan.coverage as object, [entry]);
  else variants.push(entry);
  if (!outcome.ok) return outcome;
  return { ok: true, value: { analysis: outcome.value, byId, nodes } };
}

function validateCandidateCoverage(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  tree: PresentationTreeCacheEntry,
  cache: PresentationValidationCache,
): Outcome<undefined> {
  const coverage = prepareCandidateCoverage(plan, resolved, tree, cache);
  if (!coverage.ok) return coverage;
  return validateSimultaneousCoverage(
    coverage.value.analysis,
    cache.preparedContext.task.needs,
    tree.parents,
    resolved,
    cache,
    coverage.value.byId,
  );
}

function finalPlan(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  ownedPlan: boolean,
): PresentationPlan {
  const canReuse =
    ownedPlan &&
    Object.isFrozen(plan) &&
    Object.isFrozen(plan.nodes) &&
    resolved.every((node, index) => node.node === plan.nodes[index]);
  if (canReuse) return plan as PresentationPlan;
  return freezePresentationContainer({
    ...plan,
    nodes: freezePresentationContainer(resolved.map((node) => node.node)),
  }) as PresentationPlan;
}

function finalizeValidatedPresentation(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
  options: PresentationValidationOptions,
  ownedPlan: boolean,
  graph: InteractionGraph,
): Outcome<ValidatedPresentation> {
  const acceptedPlan = finalPlan(plan, resolved, ownedPlan);
  if (
    options.requiredPattern !== undefined &&
    (!patternIsAllowed(options.requiredPattern, prepared) ||
      !matchesPattern(acceptedPlan, prepared, registry, options.requiredPattern))
  )
    return fail('pattern-required', 'The candidate does not match its allowed registered pattern.');
  if (!prepared.constraints.allowWithoutPreset && !matchesPattern(acceptedPlan, prepared, registry))
    return fail('pattern-required', 'This presentation requires an allowed registered pattern match.');

  const finalResolved = freezePresentationContainer(resolved);
  return {
    ok: true,
    value: freezePresentationContainer({
      plan: acceptedPlan,
      nodes: finalResolved,
      graph,
      environment: prepared.environment,
    }),
  };
}

export function validatePresentationPlan(
  input: unknown,
  context: PresentationContext,
  registry: PresentationRegistry,
  options: PresentationValidationOptions = {},
): Outcome<ValidatedPresentation> {
  const parsed = parsePresentationPlan(input);
  if (!parsed.ok) return parsed;
  const prepared = preparePresentationContext(context);
  if (!prepared.ok) return prepared;
  return validatePreparedPresentationPlan(parsed.value, context, registry, prepared.value, options);
}

export function validatePreparedPresentationPlan(
  input: PresentationPlanLike,
  context: PresentationContext,
  registry: PresentationRegistry,
  preparedContext: PreparedPresentationContext,
  options: PresentationValidationOptions = {},
  nodeMemo?: Map<string, ResolvedPresentationNode>,
  nodeIdentityMemo?: WeakMap<object, ResolvedPresentationNode>,
  manifestIndex?: ReadonlyMap<string, PresentationRegistry['manifests'][number]>,
  validationCache?: PresentationValidationCache,
  ownedPlan = false,
): Outcome<ValidatedPresentation> {
  const state = preparePlanState(input, registry, preparedContext, validationCache, manifestIndex, ownedPlan);
  if (!state.ok) return state;

  const nodeInput: PresentationNodeResolutionInput = {
    plan: input,
    prepared: preparedContext,
    registry,
    cache: state.value.cache,
    ...(nodeMemo === undefined ? {} : { nodeMemo }),
    ...(nodeIdentityMemo === undefined ? {} : { nodeIdentityMemo }),
  };
  const resolved = resolvePresentationNodes(nodeInput);
  if (!resolved.ok) return resolved;
  const coverage = validateCandidateCoverage(input, resolved.value, state.value.tree, state.value.cache);
  if (!coverage.ok) return coverage;

  const transition = validatePresentationTransition(input, context, preparedContext, registry);
  if (!transition.ok) return transition;
  const graph = preparePresentationGraph(input, resolved.value, state.value.tree, registry, state.value.cache);
  if (!graph.ok) return graph;
  return finalizeValidatedPresentation(
    input,
    resolved.value,
    preparedContext,
    registry,
    options,
    ownedPlan,
    graph.value,
  );
}
