import { canonicalJSON } from '../../contracts/parse.js';
import type { Outcome, Result, VersionRef } from '../../contracts/types.js';
import { validateInteractionGraph, type InteractionPort } from '../../interaction/graph.js';
import type {
  PresentationManifest,
  PresentationValues,
  ResolvedPresentationConfig,
  ResolvedPresentationNode,
} from '../types.js';
import {
  freezePresentation,
  freezePresentationContainer,
  ownsPresentationRegistration,
  presentationFailure as fail,
  versionKey,
} from '../registry.js';
import type { PresentationNodeResolutionInput, PresentationPlanLike } from './types.js';
import { parsePresentationQuality, parseResolvedConfig, validateResolvedConfig } from './configuration.js';
import { refKey } from './shared.js';

function nodeMemoKey(node: PresentationPlanLike['nodes'][number]): string {
  const result = node.result;
  return JSON.stringify([
    node.id,
    node.role,
    versionKey(node.representation),
    result === undefined ? null : refKey(result),
    versionKey(node.config.schema),
    canonicalJSON(node.config.values),
    node.children,
  ]);
}

function validateManifest(
  node: PresentationPlanLike['nodes'][number],
  input: PresentationNodeResolutionInput,
): Outcome<PresentationManifest> {
  const key = versionKey(node.representation);
  const manifest = input.cache.manifests.get(key);
  if (manifest === undefined || !input.cache.renderer.has(key))
    return fail('renderer', 'The requested representation is unavailable on this renderer.');
  if (
    !input.cache.allowedRepresentations.has(manifest.ref.id) ||
    (manifest.extension && !input.cache.extensions.has(key))
  )
    return fail('restricted', 'The experience does not allow this representation.');
  if (!manifest.roles.includes(node.role) || versionKey(node.config.schema) !== versionKey(manifest.configSchema))
    return fail('configuration', 'The representation role or configuration schema does not match its registration.');
  if (node.children.length < manifest.children.min || node.children.length > manifest.children.max)
    return fail('children', 'The child count violates the representation contract.');
  return { ok: true, value: manifest };
}

function matchesDataTaskOutput(
  result: Result,
  task: Extract<PresentationNodeResolutionInput['prepared']['task'], { kind: 'data' }>,
  input: PresentationNodeResolutionInput,
): boolean {
  const output = input.cache.taskOutputs.get(result.ref.outputId);
  if (output === undefined) return false;
  if (output.kind === 'reuse') return refKey(output.result) === refKey(result.ref);
  return result.taskId === task.id;
}

function validateTaskBinding(result: Result, input: PresentationNodeResolutionInput): Outcome<undefined> {
  const task = input.prepared.task;
  switch (task.kind) {
    case 'presentation':
      if (!input.cache.taskInputs.has(refKey(result.ref)))
        return fail('binding', 'The result is not one of the queryless task inputs.');
      break;
    case 'data':
      if (!matchesDataTaskOutput(result, task, input))
        return fail('binding', 'The result does not belong to the declared task output.');
      break;
    case 'form':
      return fail('binding', 'Queryless forms do not implicitly consume result data.');
  }
  return { ok: true, value: undefined };
}

function bindResult(
  node: PresentationPlanLike['nodes'][number],
  manifest: PresentationManifest,
  input: PresentationNodeResolutionInput,
): Outcome<Result | undefined> {
  const result = node.result === undefined ? undefined : input.cache.resultsByRef.get(refKey(node.result));
  if (
    (node.result !== undefined && result === undefined) ||
    (manifest.result === 'required' && result === undefined) ||
    (manifest.result === 'none' && result !== undefined)
  )
    return fail('binding', 'The representation requires an available, compatible result binding.');
  if (result === undefined) return { ok: true, value: undefined };
  const taskBinding = validateTaskBinding(result, input);
  if (!taskBinding.ok) return taskBinding;
  return { ok: true, value: result };
}

function callConfigResolver(
  manifest: PresentationManifest,
  node: PresentationPlanLike['nodes'][number],
  result: Result | undefined,
): Outcome<unknown> {
  try {
    return { ok: true, value: manifest.resolveConfig(node.config.values, result, node) };
  } catch {
    return fail('configuration', 'The registered configuration validator failed.');
  }
}

function checkedConfig(
  node: PresentationPlanLike['nodes'][number],
  manifest: PresentationManifest,
  result: Result | undefined,
  input: PresentationNodeResolutionInput,
): Outcome<{ readonly config: ResolvedPresentationConfig; readonly operations: readonly VersionRef[] }> {
  const callback = callConfigResolver(manifest, node, result);
  if (!callback.ok) return callback;
  const parsed = parseResolvedConfig(callback.value, node.config.values as PresentationValues, input.cache);
  if (!parsed.ok) return parsed;
  const valid = validateResolvedConfig(
    parsed.value,
    manifest.operations,
    result === undefined ? undefined : input.cache.resultFields.get(result),
    input.cache,
  );
  if (!valid.ok) return valid;
  return { ok: true, value: { config: parsed.value, operations: valid.value } };
}

function validateNodePorts(
  node: PresentationPlanLike['nodes'][number],
  config: ResolvedPresentationConfig,
  input: PresentationNodeResolutionInput,
): Outcome<readonly InteractionPort[]> {
  // This private, link-free graph returns only ports. Preserve ID wire byte costs.
  const graphInput = {
    nodes: [
      {
        id: ownsPresentationRegistration(input.registry) ? node.id.replace(/\w/g, 'x') : node.id,
        ports: config.ports,
      },
    ],
    links: [],
  };
  const key = canonicalJSON(graphInput);
  let graph = input.cache.nodeGraphs.get(key);
  if (graph === undefined) {
    graph = validateInteractionGraph(graphInput, input.registry.mappings);
    input.cache.nodeGraphs.set(key, graph);
  }
  if (!graph.ok) return graph;
  return { ok: true, value: graph.value.nodes[0]!.ports };
}

function freezeResolvedConfig(
  config: ResolvedPresentationConfig,
  operations: readonly VersionRef[],
  ports: readonly InteractionPort[],
): ResolvedPresentationConfig {
  return freezePresentationContainer({
    values: freezePresentation(config.values as PresentationValues),
    fields: freezePresentation(config.fields),
    ports: freezePresentation(ports),
    operations: freezePresentation(operations),
  });
}

function assessQuality(
  manifest: PresentationManifest,
  config: ResolvedPresentationConfig,
  result: Result | undefined,
  input: PresentationNodeResolutionInput,
): Outcome<import('../types.js').PresentationQuality | undefined> {
  if (manifest.assess === undefined) return { ok: true, value: undefined };
  let raw: unknown;
  try {
    raw = manifest.assess(config, result, input.prepared.environment);
  } catch {
    return fail('quality', 'The registered presentation assessor failed.');
  }
  return parsePresentationQuality(raw);
}

function validateUncachedNode(
  node: PresentationPlanLike['nodes'][number],
  input: PresentationNodeResolutionInput,
): Outcome<ResolvedPresentationNode> {
  const registered = validateManifest(node, input);
  if (!registered.ok) return registered;
  const bound = bindResult(node, registered.value, input);
  if (!bound.ok) return bound;
  freezePresentation(node);

  const resolved = checkedConfig(node, registered.value, bound.value, input);
  if (!resolved.ok) return resolved;
  const ports = validateNodePorts(node, resolved.value.config, input);
  if (!ports.ok) return ports;
  const config = freezeResolvedConfig(resolved.value.config, resolved.value.operations, ports.value);
  const quality = assessQuality(registered.value, config, bound.value, input);
  if (!quality.ok) return quality;

  return {
    ok: true,
    value: freezePresentationContainer({
      node,
      manifest: registered.value.ref,
      config,
      result: bound.value,
      ...(quality.value === undefined ? {} : { quality: quality.value }),
    }),
  };
}

export function resolvePresentationNodes(
  input: PresentationNodeResolutionInput,
): Outcome<readonly ResolvedPresentationNode[]> {
  const resolved: ResolvedPresentationNode[] = [];
  for (const node of input.plan.nodes) {
    const identity = input.nodeIdentityMemo?.get(node as object);
    if (identity !== undefined) {
      resolved.push(identity);
      continue;
    }
    const key = input.nodeMemo === undefined ? undefined : nodeMemoKey(node);
    const cached = key === undefined ? undefined : input.nodeMemo?.get(key);
    if (cached !== undefined) {
      resolved.push(cached);
      continue;
    }
    const checked = validateUncachedNode(node, input);
    if (!checked.ok) return checked;
    resolved.push(checked.value);
    input.nodeIdentityMemo?.set(node as object, checked.value);
    if (key !== undefined) input.nodeMemo?.set(key, checked.value);
  }
  return { ok: true, value: resolved };
}
