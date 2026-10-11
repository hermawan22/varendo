import { canonicalJSON } from '../../contracts/parse.js';
import type { Outcome } from '../../contracts/types.js';
import { validateInteractionGraph, type InteractionGraph } from '../../interaction/graph.js';
import type { PresentationRegistry, ResolvedPresentationNode } from '../types.js';
import { freezePresentation } from '../registry.js';
import type { PresentationPlanLike, PresentationTreeCacheEntry, PresentationValidationCache } from './types.js';

function samePorts(expected: readonly object[], resolved: readonly ResolvedPresentationNode[]): boolean {
  if (expected.length !== resolved.length) return false;
  for (let index = 0; index < resolved.length; index++) {
    if (expected[index] !== resolved[index]!.config.ports) return false;
  }
  return true;
}

function emptyGraph(
  resolved: readonly ResolvedPresentationNode[],
  tree: PresentationTreeCacheEntry,
  cache: PresentationValidationCache,
): InteractionGraph {
  const variants = cache.emptyGraphs.get(tree);
  const reused = variants?.find((variant) => samePorts(variant.ports, resolved));
  if (reused !== undefined) return reused.graph;

  const graph = freezePresentation({
    nodes: resolved.map((node) => ({ id: node.node.id, ports: node.config.ports })),
    links: [],
    mappings: [],
  });
  const entry = { ports: resolved.map((node) => node.config.ports), graph };
  if (variants === undefined) cache.emptyGraphs.set(tree, [entry]);
  else variants.push(entry);
  return graph;
}

function linkedGraph(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  registry: PresentationRegistry,
  cache: PresentationValidationCache,
): Outcome<InteractionGraph> {
  const input = { nodes: resolved.map((node) => ({ id: node.node.id, ports: node.config.ports })), links: plan.links };
  const key = canonicalJSON(input);
  const cached = cache.presentationGraphs.get(key);
  if (cached !== undefined) return cached;
  const graph = validateInteractionGraph(input, registry.mappings);
  cache.presentationGraphs.set(key, graph);
  return graph;
}

export function preparePresentationGraph(
  plan: PresentationPlanLike,
  resolved: readonly ResolvedPresentationNode[],
  tree: PresentationTreeCacheEntry,
  registry: PresentationRegistry,
  cache: PresentationValidationCache,
): Outcome<InteractionGraph> {
  if (plan.links.length === 0) return { ok: true, value: emptyGraph(resolved, tree, cache) };
  return linkedGraph(plan, resolved, registry, cache);
}
