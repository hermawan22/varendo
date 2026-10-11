import * as z from 'zod/mini';
import { stableJson, versionRefKey } from '../contracts/stable.js';
import { inspectWire } from '../contracts/ingress.js';
import { WIRE_LIMITS } from '../contracts/limits.js';
import { idSchema, interactionLinkSchema, semanticTypeSchema, versionRefSchema } from '../contracts/schemas.js';
import type { InteractionLink, Outcome, Wire } from '../contracts/types.js';

export const INTERACTION_GRAPH_LIMITS = Object.freeze({
  nodes: WIRE_LIMITS.presentationNodes,
  links: WIRE_LIMITS.links,
  portsPerNode: 128,
  totalPorts: 2_048,
  mappings: WIRE_LIMITS.links,
});

const ids = z.array(idSchema).check(z.maxLength(128));
const portShape = {
  payload: z.enum([
    'selection',
    'filter',
    'range',
    'group',
    'page',
    'navigate',
    'draft',
    'action-request',
    'extension',
  ]),
  entity: z.optional(idSchema),
  identity: z.optional(ids),
  grain: z.optional(ids),
  type: z.optional(semanticTypeSchema),
  /** Only registered extensions may carry the canonical extension payload. */
  extension: z.optional(versionRefSchema),
};

export const interactionPortShapeSchema = z.strictObject(portShape);
export const interactionPortSchema = z.strictObject({
  id: idSchema,
  direction: z.enum(['input', 'output', 'inout']),
  ...portShape,
});
export const interactionMappingManifestSchema = z.strictObject({
  ref: versionRefSchema,
  source: interactionPortShapeSchema,
  target: interactionPortShapeSchema,
  kind: z.enum(['identity', 'registered']),
});
export const interactionGraphInputSchema = z.strictObject({
  nodes: z
    .array(
      z.strictObject({
        id: idSchema,
        ports: z.array(interactionPortSchema).check(z.maxLength(INTERACTION_GRAPH_LIMITS.portsPerNode)),
      }),
    )
    .check(z.maxLength(INTERACTION_GRAPH_LIMITS.nodes)),
  links: z.array(interactionLinkSchema).check(z.maxLength(INTERACTION_GRAPH_LIMITS.links)),
});
const mappingsSchema = z.array(interactionMappingManifestSchema).check(z.maxLength(INTERACTION_GRAPH_LIMITS.mappings));

export type InteractionPortShape = Wire<z.infer<typeof interactionPortShapeSchema>>;
export type InteractionPort = Wire<z.infer<typeof interactionPortSchema>>;
export type InteractionMappingManifest = Wire<z.infer<typeof interactionMappingManifestSchema>>;
export type InteractionGraphInput = Wire<z.infer<typeof interactionGraphInputSchema>>;
export type InteractionNode = InteractionGraphInput['nodes'][number];
export interface InteractionGraph extends InteractionGraphInput {
  readonly mappings: readonly InteractionMappingManifest[];
}

const failure = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});
const endpointKey = (endpoint: { readonly node: string; readonly port: string }): string =>
  JSON.stringify([endpoint.node, endpoint.port]);
const versionKey = versionRefKey;
type ValidationFailure = Outcome<never> | undefined;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function shapeOf(port: InteractionPortShape): InteractionPortShape {
  return {
    payload: port.payload,
    ...(port.entity === undefined ? {} : { entity: port.entity }),
    ...(port.identity === undefined ? {} : { identity: port.identity }),
    ...(port.grain === undefined ? {} : { grain: [...port.grain].sort() }),
    ...(port.type === undefined
      ? {}
      : { type: { ...port.type, ...(port.type.grain === undefined ? {} : { grain: [...port.type.grain].sort() }) } }),
    ...(port.extension === undefined ? {} : { extension: port.extension }),
  };
}

function validShape(shape: InteractionPortShape): boolean {
  for (const keys of [shape.identity, shape.grain, shape.type?.grain]) {
    if (keys !== undefined && new Set(keys).size !== keys.length) return false;
  }
  if (shape.payload === 'selection' && (shape.entity === undefined || !shape.identity?.length)) return false;
  if (shape.payload === 'extension' ? shape.extension === undefined : shape.extension !== undefined) return false;
  return true;
}

function indexPorts(nodes: InteractionGraphInput['nodes']): Outcome<Map<string, InteractionPort>> {
  const ports = new Map<string, InteractionPort>();
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id))
      return failure('interaction.duplicate-node', 'Interaction node identities must be unique.');
    nodeIds.add(node.id);
    for (const port of node.ports) {
      const key = endpointKey({ node: node.id, port: port.id });
      if (ports.has(key))
        return failure('interaction.duplicate-port', 'A node cannot register the same interaction port twice.');
      if (!validShape(port))
        return failure(
          'interaction.invalid-port',
          'A port requires consistent identity, grain and registered extension semantics.',
        );
      ports.set(key, port);
      if (ports.size > INTERACTION_GRAPH_LIMITS.totalPorts)
        return failure('interaction.graph-budget', 'The graph exceeds its total registered port limit.');
    }
  }
  return { ok: true, value: ports };
}

function indexMappings(
  manifests: readonly InteractionMappingManifest[],
): Outcome<Map<string, InteractionMappingManifest>> {
  const mappings = new Map<string, InteractionMappingManifest>();
  for (const mapping of manifests) {
    const key = versionKey(mapping.ref);
    if (mappings.has(key))
      return failure('interaction.duplicate-mapping', 'A mapping version can be registered only once.');
    if (!validShape(mapping.source) || !validShape(mapping.target))
      return failure('interaction.invalid-mapping', 'Registered mappings require valid source and target semantics.');
    if (mapping.kind === 'identity' && stableJson(shapeOf(mapping.source)) !== stableJson(shapeOf(mapping.target)))
      return failure(
        'interaction.invalid-identity',
        'An identity mapping cannot change payload, entity, identity, grain, unit or temporal semantics.',
      );
    mappings.set(key, mapping);
  }
  return { ok: true, value: mappings };
}

interface LinkState {
  readonly links: Set<string>;
  readonly usedMappings: Set<string>;
  readonly directed: InteractionLink[];
  readonly parents: Map<string, string>;
  find(key: string): string;
}

function createLinkState(ports: ReadonlyMap<string, InteractionPort>): LinkState {
  const parents = new Map([...ports.keys()].map((key) => [key, key]));
  const find = (key: string): string => {
    let root = key;
    while (parents.get(root) !== root) root = parents.get(root)!;
    while (key !== root) {
      const next = parents.get(key)!;
      parents.set(key, root);
      key = next;
    }
    return root;
  };
  return { links: new Set(), usedMappings: new Set(), directed: [], parents, find };
}

function matchLinkPorts(
  link: InteractionLink,
  ports: ReadonlyMap<string, InteractionPort>,
  mappings: ReadonlyMap<string, InteractionMappingManifest>,
): Outcome<{
  readonly source: InteractionPort;
  readonly target: InteractionPort;
  readonly mapping: InteractionMappingManifest;
}> {
  const source = ports.get(endpointKey(link.source));
  const target = ports.get(endpointKey(link.target));
  const mapping = mappings.get(versionKey(link.mapping));
  if (source === undefined || target === undefined)
    return failure('interaction.missing-port', 'Every interaction endpoint must name a registered node port.');
  if (source.direction === 'input' || target.direction === 'output')
    return failure('interaction.port-direction', 'A link must connect an emitting port to a receiving port.');
  if (mapping === undefined)
    return failure('interaction.unknown-mapping', 'The requested mapping version is not registered.');
  if (
    stableJson(shapeOf(source)) !== stableJson(shapeOf(mapping.source)) ||
    stableJson(shapeOf(target)) !== stableJson(shapeOf(mapping.target))
  )
    return failure(
      'interaction.port-mismatch',
      'The mapping does not match the declared payload, identity, grain, unit or temporal semantics of both ports.',
    );
  return { ok: true, value: { source, target, mapping } };
}

function validateIdentityEquivalence(
  link: InteractionLink,
  source: InteractionPort,
  target: InteractionPort,
  mapping: InteractionMappingManifest,
  state: LinkState,
): ValidationFailure {
  if (
    mapping.kind !== 'identity' ||
    source.payload !== 'selection' ||
    source.direction !== 'inout' ||
    target.direction !== 'inout'
  )
    return failure(
      'interaction.nonconvergent',
      'Selection equivalence requires identity mappings and bidirectional selection ports.',
    );
  state.parents.set(state.find(endpointKey(link.target)), state.find(endpointKey(link.source)));
  return undefined;
}

function validateLink(
  link: InteractionLink,
  ports: ReadonlyMap<string, InteractionPort>,
  mappings: ReadonlyMap<string, InteractionMappingManifest>,
  state: LinkState,
): ValidationFailure {
  if (state.links.has(link.id))
    return failure('interaction.duplicate-link', 'Interaction link identities must be unique.');
  state.links.add(link.id);
  const matched = matchLinkPorts(link, ports, mappings);
  if (!matched.ok) return matched;
  state.usedMappings.add(versionKey(link.mapping));
  if (link.propagation === 'identity-equivalence')
    return validateIdentityEquivalence(link, matched.value.source, matched.value.target, matched.value.mapping, state);
  state.directed.push(link);
  return undefined;
}

function validateDirectedGraph(state: LinkState, ports: ReadonlyMap<string, InteractionPort>): ValidationFailure {
  const roots = new Set([...ports.keys()].map(state.find));
  const indegree = new Map([...roots].map((root) => [root, 0]));
  const successors = new Map<string, Set<string>>();
  for (const link of state.directed) {
    const source = state.find(endpointKey(link.source));
    const target = state.find(endpointKey(link.target));
    if (source === target)
      return failure(
        'interaction.feedback',
        'Directed feedback within a selection equivalence class is not supported.',
      );
    const next = successors.get(source) ?? new Set<string>();
    if (!next.has(target)) {
      next.add(target);
      indegree.set(target, indegree.get(target)! + 1);
    }
    successors.set(source, next);
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([key]) => key);
  for (let index = 0; index < ready.length; index += 1) {
    for (const target of successors.get(ready[index]!) ?? []) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  if (ready.length !== roots.size)
    return failure('interaction.feedback', 'Directed interaction mappings cannot form a feedback cycle.');
  return undefined;
}

/**
 * Check explicit port links using host-registered semantic manifests. This pure
 * pass does not authorize effects, run mapping callbacks or infer port semantics
 * from a model's declarations. Callers resolve nodes from their trusted component
 * registry and supply registeredMappings separately from proposed links.
 *
 * Identity-equivalence links form selection equivalence classes. Every directed
 * edge between those classes must form a DAG. Runtime propagation implements the
 * identity operation itself; a callback cannot self-certify convergence.
 */
export function validateInteractionGraph(
  input: unknown,
  registeredMappings: readonly InteractionMappingManifest[],
): Outcome<InteractionGraph> {
  const inputWire = inspectWire(input);
  if (!inputWire.ok) return inputWire;
  const registryWire = inspectWire(registeredMappings);
  if (!registryWire.ok) return registryWire;
  const parsed = z.safeParse(interactionGraphInputSchema, inputWire.value);
  const registry = z.safeParse(mappingsSchema, registryWire.value);
  if (!parsed.success || !registry.success)
    return failure(
      'interaction.invalid-graph',
      'The interaction graph or registered mapping manifests are invalid or exceed their limits.',
    );
  const graph = parsed.data as InteractionGraphInput;
  const ports = indexPorts(graph.nodes);
  if (!ports.ok) return ports;
  const mappings = indexMappings(registry.data as readonly InteractionMappingManifest[]);
  if (!mappings.ok) return mappings;
  const state = createLinkState(ports.value);
  for (const link of graph.links) {
    const validationFailure = validateLink(link, ports.value, mappings.value, state);
    if (validationFailure !== undefined) return validationFailure;
  }
  const validationFailure = validateDirectedGraph(state, ports.value);
  if (validationFailure !== undefined) return validationFailure;
  return {
    ok: true,
    value: freeze({
      ...graph,
      mappings: [...mappings.value].filter(([key]) => state.usedMappings.has(key)).map(([, mapping]) => mapping),
    }),
  };
}
