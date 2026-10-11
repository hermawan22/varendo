import type { InteractionEvent, InteractionGraph, InteractionOutcome, InteractionRoute } from './types.js';
import { failure } from './controller-common.js';

export function resolveSourceRoute(
  graph: InteractionGraph,
  event: InteractionEvent,
  sourcePortId: string | undefined,
): InteractionOutcome<InteractionRoute> {
  const node = graph.definition.nodes.find((candidate) => candidate.id === event.originNodeId);
  if (node === undefined)
    return failure('runtime.interaction-invalid', 'The interaction origin node is not registered.');
  if (sourcePortId !== undefined) return explicitSourceRoute(node, sourcePortId);
  const candidates = node.ports.filter((port) => port.payload === event.payload.kind && port.direction !== 'input');
  if (candidates.length !== 1)
    return failure('runtime.interaction-invalid', 'The interaction source port is ambiguous; provide sourcePortId.');
  return { ok: true, value: { nodeId: node.id, portId: candidates[0]!.id } };
}

function explicitSourceRoute(
  node: InteractionGraph['definition']['nodes'][number],
  sourcePortId: string,
): InteractionOutcome<InteractionRoute> {
  const port = node.ports.find((candidate) => candidate.id === sourcePortId);
  if (port === undefined)
    return failure('runtime.interaction-invalid', 'The interaction source port is not registered.');
  return { ok: true, value: { nodeId: node.id, portId: sourcePortId } };
}
