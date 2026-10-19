import { parseWireValue, WIRE_LIMITS, type MeaningDefinition, type Outcome, type VersionRef } from '@varendo/core';
import { boundedId as validId, isRecord } from '../guards.js';
import type {
  AgentCapabilityContext,
  AgentCapabilityHandlerResult,
  AgentCapabilityManifest,
} from '../capabilities/types.js';
import type {
  MeaningActivationCapabilityOptions,
  MeaningProposalCapabilityOptions,
  MeaningProposalInput,
} from './types.js';

const PROPOSAL_REF: VersionRef = Object.freeze({ id: 'varendo.meaning.proposal', revision: '1' });
const ACTIVATION_REF: VersionRef = Object.freeze({ id: 'varendo.meaning.activation', revision: '1' });

function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function proposalMeaning(object: Record<string, unknown>): Record<string, unknown> | undefined {
  const nested = asRecord(object.meaning);
  if (nested !== undefined) return nested;
  if ('implementation' in object) return object;
  return undefined;
}

function parseAssumptions(value: unknown): Outcome<readonly string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length > WIRE_LIMITS.diagnostics || value.some((item) => typeof item !== 'string'))
    return failure('agent.meaning-proposal', 'Meaning assumptions are malformed.', ['assumptions']);
  return { ok: true, value: Object.freeze([...value] as string[]) };
}

function parseProposalBase(value: unknown): Outcome<VersionRef | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const base = asRecord(value);
  if (base === undefined || !validId(base.id) || !validId(base.revision))
    return failure('agent.meaning-proposal', 'The proposed meaning base reference is malformed.', ['base']);
  return { ok: true, value: Object.freeze({ id: base.id, revision: base.revision }) };
}

/** Parse only bounded JSON data; semantic meaning validation remains in runtime. */
export function parseMeaningProposalInput(input: unknown): Outcome<MeaningProposalInput> {
  const wire = parseWireValue(input);
  if (!wire.ok) return wire;
  const object = asRecord(wire.value);
  if (object === undefined) return failure('agent.meaning-proposal', 'A meaning proposal must be a bounded object.');
  const candidate = proposalMeaning(object);
  if (candidate === undefined)
    return failure('agent.meaning-proposal', 'A meaning proposal requires a canonical definition.', ['meaning']);
  const assumptions = parseAssumptions(object.assumptions);
  if (!assumptions.ok) return assumptions;
  const base = parseProposalBase(object.base);
  if (!base.ok) return base;
  return {
    ok: true,
    value: Object.freeze({
      meaning: candidate as unknown as MeaningDefinition,
      ...(assumptions.value === undefined ? {} : { assumptions: assumptions.value }),
      ...(base.value === undefined ? {} : { base: base.value }),
    }),
  };
}

export function parseMeaningActivationInput(input: unknown): Outcome<VersionRef> {
  const wire = parseWireValue(input);
  if (!wire.ok) return wire;
  const object = asRecord(wire.value);
  const nested = object?.meaning;
  const candidate = nested === undefined ? object : asRecord(nested);
  if (candidate === undefined || !validId(candidate.id) || !validId(candidate.revision))
    return failure('agent.meaning-activation', 'A meaning activation reference is malformed.', ['meaning']);
  return { ok: true, value: Object.freeze({ id: candidate.id, revision: candidate.revision }) };
}

function output<T>(state: AgentCapabilityHandlerResult<T>['state'], value: T): AgentCapabilityHandlerResult<T> {
  return { state, value };
}

/** Diagnostic-code substrings classify an activation failure; the first match wins. */
const FAILURE_MARKERS: readonly {
  readonly markers: readonly string[];
  readonly state: AgentCapabilityHandlerResult<unknown>['state'];
}[] = [
  { markers: ['cancelled'], state: 'cancelled' },
  { markers: ['stale', 'revoked'], state: 'stale' },
  { markers: ['unsupported'], state: 'unsupported' },
  { markers: ['unknown', 'invalid', 'conflict', 'shape'], state: 'invalid' },
];

function activationFailureState(codes: readonly string[]): AgentCapabilityHandlerResult<unknown>['state'] {
  for (const { markers, state } of FAILURE_MARKERS) {
    if (codes.some((code) => markers.some((marker) => code.includes(marker)))) return state;
  }
  return 'denied';
}

/** Registered proposal adapter; it never activates or executes a meaning. */
export function createMeaningProposalCapability<
  C extends import('@varendo/core').Catalog = import('@varendo/core').Catalog,
>(options: MeaningProposalCapabilityOptions<C>): AgentCapabilityManifest<MeaningProposalInput, MeaningDraftJson> {
  if (options === null || typeof options !== 'object' || options.authoring === undefined)
    throw new TypeError('Meaning proposal authoring is required.');
  const ref = options.ref ?? PROPOSAL_REF;
  return Object.freeze({
    ref: Object.freeze({ id: ref.id, revision: ref.revision }),
    operation: 'meaning.propose' as const,
    label: 'Propose a typed meaning',
    description: 'Validate an AI-assisted hypothesis through the canonical meaning authoring route.',
    parse: parseMeaningProposalInput,
    invoke(
      input: MeaningProposalInput,
      _context: AgentCapabilityContext,
    ): AgentCapabilityHandlerResult<MeaningDraftJson> {
      const proposed = options.authoring.propose(input);
      if (!proposed.ok)
        return {
          state: proposed.diagnostics.some((item) => item.code === 'agent.meaning-scope') ? 'denied' : 'invalid',
          diagnostics: proposed.diagnostics,
        };
      return output('accepted', proposed.value as unknown as MeaningDraftJson);
    },
  });
}

/** Registered activation adapter; authority is read by the runtime registry host. */
export function createMeaningActivationCapability(
  options: MeaningActivationCapabilityOptions,
): AgentCapabilityManifest<VersionRef, MeaningActivationJson> {
  if (options === null || typeof options !== 'object' || options.registry === undefined)
    throw new TypeError('Meaning registry is required.');
  const ref = options.ref ?? ACTIVATION_REF;
  return Object.freeze({
    ref: Object.freeze({ id: ref.id, revision: ref.revision }),
    operation: 'meaning.activate' as const,
    label: 'Activate an authorized meaning',
    description: 'Recheck host policy and publish one exact immutable meaning revision.',
    parse: parseMeaningActivationInput,
    async invoke(
      input: VersionRef,
      context: AgentCapabilityContext,
    ): Promise<AgentCapabilityHandlerResult<MeaningActivationJson>> {
      try {
        const activated = await options.registry.activate(input, {
          signal: context.signal,
          expectedAuthority: {
            principalKey: context.authority.principalKey,
            ...(context.authority.current === undefined ? {} : { readSet: context.authority.current }),
          },
        });
        if (!activated.ok) {
          const codes = activated.diagnostics.map((item) => item.code);
          return { state: activationFailureState(codes), diagnostics: activated.diagnostics };
        }
        return output('accepted', activated.value as unknown as MeaningActivationJson);
      } catch {
        return {
          state: 'failed',
          diagnostics: [
            { code: 'agent.meaning-activation', message: 'Meaning activation failed safely.', retryable: false },
          ],
        };
      }
    },
  });
}

/** JSON-shaped aliases keep capability outputs on the dispatcher wire boundary. */
export type MeaningDraftJson = import('../capabilities/types.js').AgentJsonValue;
export type MeaningActivationJson = import('../capabilities/types.js').AgentJsonValue;
