import { parseInteraction } from '@varendo/core';
import { validateInteractionGraph, INTERACTION_GRAPH_LIMITS } from '@varendo/core/interaction';
import { canonicalJson as canonical } from '../canonical.js';
import type {
  InteractionEvent,
  InteractionFailure,
  InteractionGraph,
  InteractionGraphDefinition,
  InteractionGraphOptions,
  InteractionLink,
  InteractionMappingRegistration,
  InteractionMappingContext,
  InteractionOutcome,
  InteractionPayload,
  InteractionPort,
  InteractionPortShape,
  InteractionRoute,
  InteractionRoutedPayload,
} from './types.js';

const DEFAULT_MAX_HOPS = 32;
const DEFAULT_MAX_ROUTES = 256;
const failure = <T>(code: InteractionFailure['code'], message: string): InteractionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});
const refKey = (ref: { readonly id: string; readonly revision: string }): string =>
  JSON.stringify([ref.id, ref.revision]);
const routeKey = (route: InteractionRoute): string => `${route.nodeId}\u0000${route.portId}`;

function shapeKey(shape: InteractionPortShape): string {
  const type =
    shape.type === undefined
      ? undefined
      : { ...shape.type, ...(shape.type.grain === undefined ? {} : { grain: [...shape.type.grain].sort() }) };
  return canonical({
    payload: shape.payload,
    ...(shape.entity === undefined ? {} : { entity: shape.entity }),
    ...(shape.identity === undefined ? {} : { identity: shape.identity }),
    ...(shape.grain === undefined ? {} : { grain: [...shape.grain].sort() }),
    ...(type === undefined ? {} : { type }),
    ...(shape.extension === undefined ? {} : { extension: shape.extension }),
  });
}

function portMap(definition: InteractionGraphDefinition): Map<string, InteractionPort> {
  const ports = new Map<string, InteractionPort>();
  for (const node of definition.nodes) for (const port of node.ports) ports.set(`${node.id}\u0000${port.id}`, port);
  return ports;
}

function endpoint(link: InteractionLink, side: 'source' | 'target'): InteractionRoute {
  return side === 'source'
    ? { nodeId: link.source.node, portId: link.source.port }
    : { nodeId: link.target.node, portId: link.target.port };
}

function validDefinition(input: InteractionGraphDefinition): InteractionOutcome<InteractionGraphDefinition> {
  const checked = validateInteractionGraph({ nodes: input.nodes, links: input.links }, input.mappings);
  if (!checked.ok) return failure('runtime.interaction-invalid', checked.diagnostics[0]!.message);
  return { ok: true, value: checked.value };
}

function graphLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > INTERACTION_GRAPH_LIMITS.links)
    throw new TypeError(`${name} must be a bounded positive integer.`);
  return limit;
}

function addLink(grouped: Map<string, InteractionLink[]>, link: InteractionLink): void {
  const key = routeKey(endpoint(link, 'source'));
  const links = grouped.get(key) ?? [];
  links.push(link);
  grouped.set(key, links);
}

function sourceLinks(links: readonly InteractionLink[]): Map<string, readonly InteractionLink[]> {
  const grouped = new Map<string, InteractionLink[]>();
  for (const link of links) {
    addLink(grouped, link);
    if (link.propagation !== 'identity-equivalence') continue;
    addLink(grouped, { ...link, source: link.target, target: link.source });
  }
  return new Map([...grouped].map(([key, values]) => [key, Object.freeze([...values])]));
}

function matchesMapping(
  declared: InteractionMappingRegistration['manifest'],
  supplied: InteractionMappingRegistration['manifest'],
): boolean {
  return (
    refKey(declared.ref) === refKey(supplied.ref) &&
    declared.kind === supplied.kind &&
    shapeKey(declared.source) === shapeKey(supplied.source) &&
    shapeKey(declared.target) === shapeKey(supplied.target)
  );
}

function callbackMatchesKind(
  kind: InteractionMappingRegistration['manifest']['kind'],
  callback: InteractionMappingRegistration['map'],
): boolean {
  if (kind === 'registered') return typeof callback === 'function';
  return callback === undefined;
}

function validHopBudget(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function callbackFailure(kind: InteractionMappingRegistration['manifest']['kind']): string {
  if (kind === 'registered') return 'Registered interaction mappings require a local callback.';
  return 'Identity mappings use built-in propagation and cannot install callbacks.';
}

interface RouteItem {
  readonly route: InteractionRoute;
  readonly payload: InteractionPayload;
  readonly hops: number;
}

interface RouteContext {
  readonly event: InteractionEvent;
  readonly ports: ReadonlyMap<string, InteractionPort>;
  readonly definition: InteractionGraphDefinition;
  readonly mappings: ReadonlyMap<string, InteractionMappingRegistration>;
  readonly bySource: ReadonlyMap<string, readonly InteractionLink[]>;
  readonly maxRoutes: number;
  readonly maxHops: number;
  readonly signal: AbortSignal;
}

function applyRegisteredMapping(
  registration: InteractionMappingRegistration,
  payload: InteractionPayload,
  context: InteractionMappingContext,
): InteractionOutcome<InteractionPayload> {
  if (registration.map === undefined)
    return failure('runtime.interaction-invalid', 'A registered interaction mapping callback is unavailable.');
  try {
    return registration.map(payload, context);
  } catch {
    return failure('runtime.interaction-invalid', 'A registered interaction mapping callback failed.');
  }
}

function mapPayload(
  context: RouteContext,
  current: RouteItem,
  target: InteractionRoute,
  link: InteractionLink,
  mapping: InteractionGraphDefinition['mappings'][number],
): InteractionOutcome<InteractionPayload> {
  if (link.propagation === 'identity-equivalence') {
    if (current.payload.kind !== 'selection' || mapping.kind !== 'identity')
      return failure(
        'runtime.interaction-invalid',
        'Only identity selection mappings may propagate an equivalence cycle.',
      );
    return { ok: true, value: current.payload };
  }
  const registration = context.mappings.get(refKey(mapping.ref));
  if (registration === undefined)
    return failure('runtime.interaction-invalid', 'A registered interaction mapping callback is unavailable.');
  return applyRegisteredMapping(registration, current.payload, {
    event: context.event,
    source: current.route,
    target,
    signal: context.signal,
  });
}

function targetPayload(
  context: RouteContext,
  target: InteractionRoute,
  payload: InteractionPayload,
): InteractionOutcome<InteractionPayload> {
  const checked = parseInteraction({ ...context.event, originNodeId: target.nodeId, payload });
  if (!checked.ok)
    return failure(
      'runtime.interaction-invalid',
      'A mapping callback returned a payload outside the canonical interaction contract.',
    );
  const port = context.ports.get(routeKey(target));
  if (port === undefined || port.direction === 'output' || port.payload !== checked.value.payload.kind)
    return failure('runtime.interaction-invalid', 'A mapped payload does not match its target input port.');
  return { ok: true, value: checked.value.payload };
}

function routeLink(
  context: RouteContext,
  current: RouteItem,
  link: InteractionLink,
  visited: Set<string>,
  routed: InteractionRoutedPayload[],
): InteractionOutcome<RouteItem | undefined> {
  if (context.signal.aborted) return failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
  const target = endpoint(link, 'target');
  const mapping = context.definition.mappings.find((candidate) => refKey(candidate.ref) === refKey(link.mapping));
  if (mapping === undefined)
    return failure('runtime.interaction-invalid', 'The interaction link references an unknown mapping.');
  const mapped = mapPayload(context, current, target, link, mapping);
  if (!mapped.ok) return mapped;
  const checked = targetPayload(context, target, mapped.value);
  if (!checked.ok) return checked;
  const visitKey = `${routeKey(target)}\u0000${canonical(checked.value)}`;
  if (visited.has(visitKey)) return { ok: true, value: undefined };
  if (routed.length >= context.maxRoutes)
    return failure('runtime.interaction-budget', 'The interaction produced too many routed payloads.');
  visited.add(visitKey);
  routed.push(
    Object.freeze({ route: target, payload: checked.value, mapping: link.mapping, causationId: context.event.eventId }),
  );
  return { ok: true, value: { route: target, payload: checked.value, hops: current.hops + 1 } };
}

function walkRoutes(
  context: RouteContext,
  source: InteractionRoute,
): InteractionOutcome<readonly InteractionRoutedPayload[]> {
  const queue: RouteItem[] = [{ route: source, payload: context.event.payload, hops: 0 }];
  const visited = new Set<string>();
  const routed: InteractionRoutedPayload[] = [];
  while (queue.length > 0) {
    if (context.signal.aborted) return failure('runtime.interaction-cancelled', 'The interaction was cancelled.');
    const current = queue.shift()!;
    if (current.hops > context.maxHops)
      return failure('runtime.interaction-budget', 'The interaction propagation exceeded its bounded hop budget.');
    const links = context.bySource.get(routeKey(current.route)) ?? [];
    for (const link of links) {
      const result = routeLink(context, current, link, visited, routed);
      if (!result.ok) return result;
      if (result.value !== undefined) queue.push(result.value);
    }
  }
  return { ok: true, value: Object.freeze(routed) };
}

class InteractionGraphImpl implements InteractionGraph {
  readonly definition: InteractionGraphDefinition;
  private readonly mappings = new Map<string, InteractionMappingRegistration>();
  private readonly bySource = new Map<string, readonly InteractionLink[]>();
  private readonly maxHops: number;
  private readonly maxRoutes: number;
  private disposed = false;

  constructor(definition: InteractionGraphDefinition, options: InteractionGraphOptions = {}) {
    const checked = validDefinition(definition);
    if (!checked.ok) throw new TypeError(checked.diagnostics[0]!.message);
    this.definition = checked.value;
    this.maxHops = graphLimit(options.maxHops, DEFAULT_MAX_HOPS, 'maxHops');
    this.maxRoutes = graphLimit(options.maxRoutes, DEFAULT_MAX_ROUTES, 'maxRoutes');
    for (const [key, links] of sourceLinks(this.definition.links)) this.bySource.set(key, links);
  }

  registerMapping(mapping: InteractionMappingRegistration): InteractionOutcome<void> {
    if (this.disposed) return failure('runtime.interaction-disposed', 'The interaction graph has been disposed.');
    if (mapping === null || typeof mapping !== 'object')
      return failure('runtime.interaction-invalid', 'A mapping registration is required.');
    const declared = this.definition.mappings.find((candidate) => matchesMapping(candidate, mapping.manifest));
    if (declared === undefined)
      return failure('runtime.interaction-invalid', 'A mapping callback does not match the trusted graph manifest.');
    if (!callbackMatchesKind(declared.kind, mapping.map))
      return failure('runtime.interaction-invalid', callbackFailure(declared.kind));
    const key = refKey(mapping.manifest.ref);
    if (this.mappings.has(key))
      return failure('runtime.interaction-invalid', 'An interaction mapping callback is already registered.');
    this.mappings.set(key, Object.freeze({ ...mapping }));
    return { ok: true, value: undefined };
  }

  route(
    event: InteractionEvent,
    source: InteractionRoute,
    signal: AbortSignal,
    maxHops = this.maxHops,
  ): InteractionOutcome<readonly InteractionRoutedPayload[]> {
    if (this.disposed) return failure('runtime.interaction-disposed', 'The interaction graph has been disposed.');
    if (!validHopBudget(maxHops, this.maxHops))
      return failure('runtime.interaction-budget', 'The interaction propagation hop budget is invalid.');
    const ports = portMap(this.definition);
    const sourcePort = ports.get(routeKey(source));
    if (sourcePort === undefined || sourcePort.direction === 'input')
      return failure('runtime.interaction-invalid', 'The interaction source port is not a registered output.');
    if (sourcePort.payload !== event.payload.kind)
      return failure('runtime.interaction-invalid', 'The interaction payload does not match its source port.');
    return walkRoutes(
      {
        event,
        ports,
        definition: this.definition,
        mappings: this.mappings,
        bySource: this.bySource,
        maxRoutes: this.maxRoutes,
        maxHops,
        signal,
      },
      source,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.mappings.clear();
    this.bySource.clear();
  }
}

export function createInteractionGraph(
  input: InteractionGraphDefinition,
  options?: InteractionGraphOptions,
): InteractionGraph {
  return new InteractionGraphImpl(input, options);
}
