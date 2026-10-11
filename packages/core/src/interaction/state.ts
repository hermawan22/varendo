import * as z from 'zod/mini';
import { inspectWire } from '../contracts/ingress.js';
import { interactionStateSchema } from '../contracts/schemas.js';
import type { InteractionState, Outcome } from '../contracts/types.js';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const invalid = (message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: 'interaction.invalid-state', message, retryable: false }],
});

/** Shape/identity validation only. Host permissions and result membership remain separate. */
export function parseInteractionState(input: unknown): Outcome<InteractionState> {
  const wire = inspectWire(input);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(interactionStateSchema, wire.value);
  if (!parsed.success) return invalid('Interaction state must match its bounded versioned schema.');
  const routes = new Set<string>();
  for (const entry of parsed.data.values) {
    const key = JSON.stringify([entry.nodeId, entry.portId]);
    if (routes.has(key)) return invalid('An interaction state cannot contain duplicate port values.');
    routes.add(key);
    const payload = entry.payload;
    if (
      payload.kind === 'selection' &&
      payload.selection.mode === 'ids' &&
      new Set(payload.selection.keys).size !== payload.selection.keys.length
    )
      return invalid('An explicit selection cannot contain duplicate identities.');
  }
  const drafts = new Set<string>();
  for (const draft of parsed.data.drafts) {
    const key = JSON.stringify([draft.domain, draft.entity, draft.key, draft.field]);
    if (drafts.has(key)) return invalid('A domain entity field can have only one current draft.');
    drafts.add(key);
    if (draft.conflict?.entityRevision === draft.entityRevision)
      return invalid('A draft conflict must identify a different entity revision.');
  }
  // Ingress rejects present undefined before optional schema properties are read.
  return { ok: true, value: freeze(parsed.data as InteractionState) };
}

export { interactionStateSchema };
