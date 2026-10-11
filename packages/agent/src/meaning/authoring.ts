import {
  createMeaningAuthoring,
  createMeaningEvaluator,
  type MeaningAuthoring,
  type MeaningDefinitionInput,
  type MeaningDraft,
  type MeaningDiff,
  type MeaningEvaluator,
} from '@varendo/runtime/meaning';
import type { Catalog, MeaningDefinition, Outcome } from '@varendo/core';
import { parseWireValue } from '@varendo/core';
import type {
  AgentMeaningAuthoring,
  AgentMeaningAuthoringOptions,
  MeaningProposalInput,
  MeaningProposalPolicy,
} from './types.js';
import { isRecord } from '../guards.js';

function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

const DEFAULT_SCOPES: readonly MeaningDefinition['scope'][] = Object.freeze(['session', 'personal']);

function isPolicyObject(policy: unknown): policy is MeaningProposalPolicy {
  return isRecord(policy);
}

function validatePolicyShape(policy: MeaningProposalPolicy): Outcome<void> {
  if (policy.allowedScopes !== undefined && !Array.isArray(policy.allowedScopes))
    return failure('agent.meaning-policy', 'AI meaning proposal scopes must be an array.', [
      'proposalPolicy',
      'allowedScopes',
    ]);
  if (policy.requireHypothesis !== undefined && typeof policy.requireHypothesis !== 'boolean')
    return failure('agent.meaning-policy', 'AI meaning hypothesis policy must be boolean.', [
      'proposalPolicy',
      'requireHypothesis',
    ]);
  if (policy.requireDraft !== undefined && typeof policy.requireDraft !== 'boolean')
    return failure('agent.meaning-policy', 'AI meaning draft policy must be boolean.', [
      'proposalPolicy',
      'requireDraft',
    ]);
  return { ok: true, value: undefined };
}

function snapshotAllowedScopes(
  scopes: MeaningProposalPolicy['allowedScopes'],
): Outcome<readonly MeaningDefinition['scope'][] | undefined> {
  if (scopes === undefined) return { ok: true, value: undefined };
  const inspected = parseWireValue(scopes);
  if (!inspected.ok) return { ok: false, diagnostics: inspected.diagnostics };
  if (
    !Array.isArray(inspected.value) ||
    !inspected.value.every((scope): scope is MeaningDefinition['scope'] => typeof scope === 'string')
  )
    return failure('agent.meaning-policy', 'AI meaning proposal scopes must be bounded strings.', [
      'proposalPolicy',
      'allowedScopes',
    ]);
  return { ok: true, value: Object.freeze([...inspected.value]) };
}

function snapshotProposalPolicy(policy: MeaningProposalPolicy | undefined): Outcome<MeaningProposalPolicy | undefined> {
  if (policy === undefined) return { ok: true, value: undefined };
  if (!isPolicyObject(policy))
    return failure('agent.meaning-policy', 'AI meaning proposal policy must be a bounded object.', ['proposalPolicy']);
  const valid = validatePolicyShape(policy);
  if (!valid.ok) return valid;
  const scopes = snapshotAllowedScopes(policy.allowedScopes);
  if (!scopes.ok) return scopes;
  const allowedScopes = scopes.value;
  return {
    ok: true,
    value: Object.freeze({
      ...(allowedScopes === undefined ? {} : { allowedScopes }),
      ...(policy.requireHypothesis === undefined ? {} : { requireHypothesis: policy.requireHypothesis }),
      ...(policy.requireDraft === undefined ? {} : { requireDraft: policy.requireDraft }),
    }) as MeaningProposalPolicy,
  };
}

function checkPolicy(meaning: MeaningDefinition, policy: MeaningProposalPolicy | undefined): Outcome<void> {
  if (meaning === null || typeof meaning !== 'object' || Array.isArray(meaning))
    return failure('agent.meaning-proposal', 'An AI meaning proposal requires a canonical definition.', ['meaning']);
  const violation = [
    scopeViolation(meaning, policy),
    authorityViolation(meaning, policy),
    lifecycleViolation(meaning, policy),
    originViolation(meaning),
  ].find((item) => item !== undefined);
  if (violation !== undefined) return failure(violation.code, violation.message, violation.path);
  return { ok: true, value: undefined };
}

interface PolicyViolation {
  readonly code: string;
  readonly message: string;
  readonly path: readonly string[];
}

function scopeViolation(
  meaning: MeaningDefinition,
  policy: MeaningProposalPolicy | undefined,
): PolicyViolation | undefined {
  if (!(policy?.allowedScopes ?? DEFAULT_SCOPES).includes(meaning.scope))
    return {
      code: 'agent.meaning-scope',
      message: 'AI meaning proposals are limited to the configured low-risk scope.',
      path: ['scope'],
    };
  return undefined;
}

function authorityViolation(
  meaning: MeaningDefinition,
  policy: MeaningProposalPolicy | undefined,
): PolicyViolation | undefined {
  if ((policy?.requireHypothesis ?? true) && meaning.authority !== 'hypothesis')
    return {
      code: 'agent.meaning-authority',
      message: 'AI meaning proposals must retain hypothesis authority.',
      path: ['authority'],
    };
  return undefined;
}

function lifecycleViolation(
  meaning: MeaningDefinition,
  policy: MeaningProposalPolicy | undefined,
): PolicyViolation | undefined {
  if ((policy?.requireDraft ?? true) && meaning.lifecycle !== 'draft')
    return {
      code: 'agent.meaning-lifecycle',
      message: 'AI meaning proposals must remain drafts until host activation.',
      path: ['lifecycle'],
    };
  return undefined;
}

function originViolation(meaning: MeaningDefinition): PolicyViolation | undefined {
  if (meaning.origin !== 'ai-assisted')
    return {
      code: 'agent.meaning-origin',
      message: 'An AI authoring route cannot erase AI provenance.',
      path: ['origin'],
    };
  return undefined;
}

function definitionInputFailure(input: MeaningDefinitionInput): Outcome<void> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return failure('agent.meaning-proposal', 'An AI meaning definition requires a bounded input object.');
  if (input.origin !== undefined && input.origin !== 'ai-assisted')
    return failure('agent.meaning-origin', 'The AI authoring route cannot claim manual or system provenance.', [
      'origin',
    ]);
  if (input.lifecycle !== undefined && input.lifecycle !== 'draft')
    return failure('agent.meaning-lifecycle', 'The AI authoring route can only create drafts.', ['lifecycle']);
  if (input.authority !== undefined && input.authority !== 'hypothesis')
    return failure('agent.meaning-authority', 'The AI authoring route can only create hypothesis definitions.', [
      'authority',
    ]);
  return { ok: true, value: undefined };
}

function defineAiMeaning<const C extends Catalog>(
  input: MeaningDefinitionInput,
  manual: MeaningAuthoring<C>,
  policy: MeaningProposalPolicy | undefined,
): Outcome<MeaningDraft> {
  const validInput = definitionInputFailure(input);
  if (!validInput.ok) return validInput;
  const built = manual.defineMeaning({
    ...input,
    origin: 'ai-assisted',
    lifecycle: 'draft',
    authority: 'hypothesis',
    scope: input.scope ?? 'session',
  });
  if (!built.ok) return built;
  const checked = checkPolicy(built.value.meaning, policy);
  if (!checked.ok) return checked;
  return manual.draft(built.value.meaning, {
    source: aiSource(built.value.meaning),
    ...(input.assumptions === undefined ? {} : { assumptions: input.assumptions }),
  });
}

function aiSource(meaning: MeaningDefinition): {
  readonly surface: 'ai-assisted';
  readonly ownership: MeaningDefinition['scope'];
} {
  return { surface: 'ai-assisted', ownership: meaning.scope };
}

/**
 * AI-assisted authoring is a proposal adapter only. It has no model/provider
 * dependency and delegates definition construction, validation and evaluation
 * to the runtime's canonical manual authoring/evaluator surfaces.
 */
export function createAgentMeaningAuthoring<const C extends Catalog>(
  options: AgentMeaningAuthoringOptions<C>,
): Outcome<AgentMeaningAuthoring<C>> {
  const manual = createMeaningAuthoring(options);
  if (!manual.ok) return manual;
  const policyResult = snapshotProposalPolicy(options.proposalPolicy);
  if (!policyResult.ok) return policyResult;
  const policy = policyResult.value;
  const defineMeaning = (input: MeaningDefinitionInput): Outcome<MeaningDraft> =>
    defineAiMeaning(input, manual.value, policy);
  const propose = (input: MeaningProposalInput): Outcome<MeaningDraft> => {
    if (input === null || typeof input !== 'object' || Array.isArray(input) || input.meaning === undefined)
      return failure('agent.meaning-proposal', 'An AI meaning proposal requires one canonical definition.', [
        'meaning',
      ]);
    const checked = checkPolicy(input.meaning, policy);
    if (!checked.ok) return checked;
    const source = aiSource(input.meaning);
    return manual.value.draft(input.meaning, {
      source,
      ...(input.assumptions === undefined ? {} : { assumptions: input.assumptions }),
      ...(input.base === undefined ? {} : { base: input.base }),
    });
  };
  const proposeDiff = (
    base: MeaningDraft | MeaningDefinition,
    meaning: MeaningDefinition,
    diffOptions: { readonly assumptions?: readonly string[] } = {},
  ): Outcome<MeaningDiff> => {
    const checked = checkPolicy(meaning, policy);
    if (!checked.ok) return checked;
    return manual.value.proposeDiff(base, meaning, {
      source: aiSource(meaning),
      ...(diffOptions.assumptions === undefined ? {} : { assumptions: diffOptions.assumptions }),
    });
  };
  let evaluator: MeaningEvaluator | undefined;
  const evaluatorOptions = options.evaluator ?? {
    catalog: options.catalog,
    registry: options.registry,
    ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  };
  const evaluated = createMeaningEvaluator(evaluatorOptions);
  if (!evaluated.ok) return evaluated;
  evaluator = evaluated.value;
  return { ok: true, value: Object.freeze({ manual: manual.value, defineMeaning, propose, proposeDiff, evaluator }) };
}
