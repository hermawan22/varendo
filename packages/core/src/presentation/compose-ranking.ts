import type { Outcome, PresentationPlan, Result, Task, VersionRef } from '../contracts/types.js';
import { compareText, sameVersionRef, stableJson, type CanonicalCache } from '../contracts/stable.js';
import type {
  PresentationCompositionRequest,
  PresentationManifest,
  PresentationPatternManifest,
  PresentationRegistry,
  PresentationValues,
  ValidatedPresentation,
} from './types.js';
import { presentationFailure as fail, versionKey } from './registry.js';
import { stateMappingFor } from './state.js';
import type { PreparedPresentationContext } from './validate.js';

export type { CanonicalCache } from '../contracts/stable.js';

function planTopology(plan: PresentationPlan): string {
  return stableJson(
    plan.nodes
      .map((node) => [node.id, node.role, node.children])
      .sort((a, b) => compareText(String(a[0]), String(b[0]))),
  );
}

function planVariants(plan: PresentationPlan): string {
  return stableJson(plan.nodes.map((node) => [node.id, versionKey(node.representation)]).sort());
}

function planConfigurations(plan: PresentationPlan): string {
  return stableJson(plan.nodes.map((node) => [node.id, node.config]).sort());
}

function planSemantics(plan: PresentationPlan): string {
  return stableJson([plan.links, plan.coverage, plan.nodes.map((node) => [node.id, node.result]).sort()]);
}

function changePenalty(candidate: PresentationPlan, incumbent: PresentationPlan | undefined): number {
  if (incumbent === undefined) return 0;
  let penalty = 0;
  if (planTopology(candidate) !== planTopology(incumbent)) penalty += 80;
  if (planVariants(candidate) !== planVariants(incumbent)) penalty += 80;
  if (planConfigurations(candidate) !== planConfigurations(incumbent)) penalty += 20;
  if (planSemantics(candidate) !== planSemantics(incumbent)) penalty += 20;
  return penalty;
}

export function candidateScore(
  presentation: ValidatedPresentation,
  prepared: PreparedPresentationContext,
  incumbent: PresentationPlan | undefined,
): number {
  let score = 0;
  for (const node of presentation.nodes) {
    const quality = node.quality;
    if (quality === undefined) continue;
    score += quality.taskFit * 100;
    score += quality.informationDensity * 25;
    score -= quality.interactionEffort * 20;
    score -= quality.legibilityPenalty * 20;
    if (quality.cost !== undefined) score -= Math.min(100, Math.floor(quality.cost.microseconds / 1_000_000)) * 5;
  }
  // Validated plans are capped at 512 nodes, so this keeps an eligible host
  // preference ahead of bounded quality and continuity scores without infinity.
  if (
    prepared.constraints.preferredRepresentation !== undefined &&
    presentation.nodes.some((node) => node.manifest.id === prepared.constraints.preferredRepresentation)
  )
    score += 10_000_000;
  const optionalCovered = prepared.constraints.taskNeeds.filter(
    (need) => !need.required && presentation.plan.coverage.some((entry) => entry.needId === need.id),
  ).length;
  score += optionalCovered * 10;
  score -= changePenalty(presentation.plan, incumbent);
  return score;
}

interface RankedCandidate {
  readonly presentation: ValidatedPresentation;
  readonly score: number;
  readonly incumbent: boolean;
}

/** Compare schema-owned plans in canonical JSON order, stopping before unchanged suffixes. */
function compareCanonicalPlans(left: PresentationPlan, right: PresentationPlan, cache: CanonicalCache): number {
  for (const key of [
    'coverage',
    'diagnostics',
    'id',
    'links',
    'nodes',
    'preconditions',
    'revision',
    'rootId',
    'stateTransfer',
  ] as const) {
    if (left[key] === right[key]) continue;
    if (key === 'nodes') {
      const order = compareNodeSequences(left.nodes, right.nodes, cache);
      if (order !== 0) return order;
    } else {
      const order = compareText(stableJson(left[key], cache), stableJson(right[key], cache));
      if (order !== 0) return order;
    }
  }
  return 0;
}

function compareNodeSequences(
  left: PresentationPlan['nodes'],
  right: PresentationPlan['nodes'],
  cache: CanonicalCache,
): number {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index++) {
    if (left[index] === right[index]) continue;
    const order = compareText(stableJson(left[index], cache), stableJson(right[index], cache));
    if (order !== 0) return order;
  }
  if (left.length === right.length) return 0;
  return count === 0 ? left.length - right.length : right.length - left.length;
}

export function betterCandidate(
  next: RankedCandidate,
  current: RankedCandidate | undefined,
  cache: CanonicalCache,
): boolean {
  if (current === undefined) return true;
  if (next.score !== current.score) return next.score > current.score;
  if (next.incumbent !== current.incumbent) return next.incumbent;
  return compareCanonicalPlans(next.presentation.plan, current.presentation.plan, cache) < 0;
}

export function validPattern(
  candidate: {
    readonly source: 'explicit' | 'pattern';
    readonly pattern?: VersionRef;
    readonly plan: PresentationPlan;
  },
  patterns: readonly PresentationPatternManifest[],
  prepared: PreparedPresentationContext,
): Outcome<PresentationPatternManifest | undefined> {
  if (candidate.source !== 'pattern') return { ok: true, value: undefined };
  const patternRef = candidate.pattern;
  if (patternRef === undefined)
    return fail('pattern-required', 'A pattern candidate must identify its registered pattern.');
  const pattern = patterns.find((item) => sameVersionRef(item.ref, patternRef));
  if (pattern === undefined || !prepared.constraints.allowedPatterns.includes(pattern.ref.id))
    return fail('pattern-required', 'The candidate pattern is not allowed by the active experience.');
  return { ok: true, value: pattern };
}

function stableNodeId(
  need: Task['needs'][number],
  role: string,
  used: Set<string>,
  context: PresentationCompositionRequest['context'],
): string {
  const coverage = context.incumbent?.coverage.find((entry) => entry.needId === need.id);
  const existing = coverage?.nodeIds.find((id) => {
    const node = context.incumbent?.nodes.find((candidate) => candidate.id === id);
    return node !== undefined && node.role === role && !used.has(id);
  });
  if (existing !== undefined) {
    used.add(existing);
    return existing;
  }
  const base = 'view.' + need.id;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(base + '.' + index)) index++;
  const id = base + '.' + index;
  used.add(id);
  return id;
}

function stableRootId(role: string, used: Set<string>, context: PresentationCompositionRequest['context']): string {
  const currentRoot = context.incumbent?.nodes.find((node) => node.id === context.incumbent?.rootId);
  if (currentRoot !== undefined && currentRoot.role === role && !used.has(currentRoot.id)) {
    used.add(currentRoot.id);
    return currentRoot.id;
  }
  const base = 'layout';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(base + '.' + index)) index++;
  const id = base + '.' + index;
  used.add(id);
  return id;
}

function transfersFor(
  nodes: readonly PresentationPlan['nodes'][number][],
  incumbent: PresentationPlan | undefined,
  registry: PresentationRegistry,
  context: PresentationCompositionRequest['context'],
  rootId: string,
): PresentationPlan['stateTransfer'] {
  if (incumbent === undefined) return [];
  const next = new Map(nodes.map((node) => [node.id, node]));
  return incumbent.nodes.flatMap((previous) => {
    const candidate = next.get(previous.id);
    if (
      candidate !== undefined &&
      candidate.role === previous.role &&
      sameVersionRef(candidate.representation, previous.representation)
    )
      return [{ fromNode: previous.id, toNode: previous.id, mapping: stateIdentity }];
    const target = candidate ?? next.get(rootId);
    if (target === undefined) return [];
    const phase = candidate === undefined ? 'archive' : 'transfer';
    const mapping = stateMappingFor(previous, target, registry, context, phase);
    if (mapping === undefined) return [];
    return [{ fromNode: previous.id, toNode: target.id, mapping: mapping.ref }];
  });
}

export function buildPlan(
  request: PresentationCompositionRequest,
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
  layout: PresentationManifest | undefined,
  selected: readonly PresentationManifest[],
  suggest: (
    manifest: PresentationManifest,
    needs: readonly Task['needs'][number][],
    result: Result | undefined,
  ) => Outcome<PresentationValues>,
): Outcome<PresentationPlan> {
  const required = prepared.constraints.taskNeeds.filter((need) => need.required);
  const used = new Set<string>();
  const resultFor = (need: Task['needs'][number]): Result | undefined => {
    if (need.outputId === undefined) return undefined;
    return prepared.results.find((result) => result.ref.outputId === need.outputId);
  };
  const nodes: PresentationPlan['nodes'][number][] = [];
  for (let index = 0; index < required.length; index++) {
    const need = required[index]!;
    const manifest = selected[index];
    if (manifest === undefined)
      return fail('suggestion', 'The bounded composition did not provide a representation for every required need.');
    const result = resultFor(need);
    if (manifest.result === 'required' && result === undefined)
      return fail('suggestion', 'A required-result representation has no exact task output.');
    const values = suggest(manifest, [need], result);
    if (!values.ok) return values;
    const role = manifest.roles[0]!;
    const nodeId = stableNodeId(need, role, used, request.context);
    nodes.push({
      id: nodeId,
      role,
      representation: manifest.ref,
      ...(result === undefined ? {} : { result: result.ref }),
      config: { schema: manifest.configSchema, values: values.value },
      children: [],
    });
  }
  if (layout === undefined && nodes.length !== 1)
    return fail('suggestion', 'A single leaf is required when no layout manifest is selected.');
  let rootId: string;
  if (layout === undefined) rootId = nodes[0]!.id;
  else {
    const values = suggest(layout, [], undefined);
    if (!values.ok) return values;
    rootId = stableRootId(layout.roles[0]!, used, request.context);
    nodes.unshift({
      id: rootId,
      role: layout.roles[0]!,
      representation: layout.ref,
      config: { schema: layout.configSchema, values: values.value },
      children: nodes.map((node) => node.id),
    });
  }
  return {
    ok: true,
    value: {
      id: request.id,
      revision: request.revision,
      rootId,
      preconditions: request.preconditions,
      nodes,
      links: [],
      coverage: required.map((need, index) => ({
        needId: need.id,
        nodeIds: [nodes[layout === undefined ? index : index + 1]!.id],
        operations: [need.operation],
      })),
      stateTransfer: transfersFor(nodes, request.context.incumbent, registry, request.context, rootId),
      diagnostics: [],
    },
  };
}

const stateIdentity = { id: 'aeliqo.state.identity', revision: '1' } as const;
