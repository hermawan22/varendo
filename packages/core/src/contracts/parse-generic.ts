import { contractSchemas } from './schemas-registry.js';
import { inspectWire } from './ingress.js';
import { wireFailure } from '../diagnostics/wire.js';
import { canonicalJSON, parseInspectedSchema } from './parse-schema.js';
import type { Contract, ContractKind, Outcome } from './types.js';

const VERSIONED_CONTRACT_KINDS: ReadonlySet<ContractKind> = new Set(['catalog', 'task', 'result', 'experience']);

/** A successful parse validates wire shape only. It grants no effect or business meaning. */
export function parseContract<K extends ContractKind>(kind: K, input: unknown): Outcome<Contract<K>> {
  const inspected = inspectWire(input);
  if (!inspected.ok) return inspected;
  if (!Object.hasOwn(contractSchemas, kind)) return wireFailure('wire.kind', 'The contract kind is not supported.');
  return parseInspectedSchema(isVersionedContract(kind), inspected.value, contractSchemas[kind]) as Outcome<
    Contract<K>
  >;
}

function isVersionedContract(kind: ContractKind): boolean {
  return VERSIONED_CONTRACT_KINDS.has(kind);
}

/** Stable object-key ordering; arrays, decimal scale and signed zero are preserved. */
export function serializeContract<K extends ContractKind>(kind: K, value: Contract<K>): Outcome<string> {
  const parsed = parseContract(kind, value);
  return parsed.ok ? { ok: true, value: canonicalJSON(parsed.value) } : parsed;
}
