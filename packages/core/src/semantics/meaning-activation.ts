import type { MeaningDefinition, Outcome, VersionRef } from '../contracts/types.js';
import { isRecord, semanticFailure } from './errors.js';
import { versionKey } from './catalog.js';
import { stableJson } from '../contracts/stable.js';
import type { MeaningActivationPolicy, MeaningActivationReceipt } from './types.js';

const authorityRank: Record<MeaningDefinition['authority'], number> = {
  hypothesis: 0,
  reviewed: 1,
  approved: 2,
};

function validateActivationInputs(meaning: MeaningDefinition, policy: MeaningActivationPolicy): Outcome<void> {
  if (!isRecord(meaning) || typeof meaning.id !== 'string' || typeof meaning.revision !== 'string')
    return semanticFailure('semantic.activation-meaning', 'Activation requires a canonical meaning definition.', [
      'meaning',
    ]);
  if (!isRecord(policy) || typeof policy.policyRevision !== 'string' || !Array.isArray(policy.allowlistedDefinitions))
    return semanticFailure(
      'semantic.activation-policy',
      'Activation requires a canonical host policy with exact definitions.',
      ['policy'],
    );
  if (policy.policyRevision.length === 0)
    return semanticFailure('semantic.activation-policy', 'Activation policy must pin a nonempty revision.', [
      'policyRevision',
    ]);
  if (meaning.lifecycle !== 'active')
    return semanticFailure('semantic.activation-lifecycle', 'Only active meanings may be considered for activation.', [
      'lifecycle',
    ]);
  return { ok: true, value: undefined };
}

function allowlistsExactMeaning(
  meaning: MeaningDefinition,
  policy: MeaningActivationPolicy,
  identity: string,
): boolean {
  const canonical = policy.allowlistedDefinitions.find(
    (candidate) =>
      isRecord(candidate) &&
      typeof candidate.id === 'string' &&
      typeof candidate.revision === 'string' &&
      versionKey(candidate as VersionRef) === identity,
  );
  return canonical !== undefined && stableJson(canonical) === stableJson(meaning);
}

function allowsMeaningReference(policy: MeaningActivationPolicy, identity: string): boolean {
  if (policy.allowlistedRefs === undefined) return true;
  if (!Array.isArray(policy.allowlistedRefs)) return false;
  return policy.allowlistedRefs.some(
    (ref) =>
      isRecord(ref) &&
      typeof ref.id === 'string' &&
      typeof ref.revision === 'string' &&
      versionKey(ref as VersionRef) === identity,
  );
}

function meetsAuthorityPolicy(meaning: MeaningDefinition, policy: MeaningActivationPolicy): boolean {
  if (policy.minAuthority === undefined) return true;
  return !(authorityRank[meaning.authority] < authorityRank[policy.minAuthority]);
}

/**
 * Activation is an effect boundary owned by the host. A definition's
 * `authority`/`lifecycle` labels are validated data, not credentials. This
 * helper requires an immutable host allowlist before returning any receipt.
 */
export function authorizeMeaningActivation(
  meaning: MeaningDefinition,
  policy: MeaningActivationPolicy,
): Outcome<MeaningActivationReceipt> {
  const inputs = validateActivationInputs(meaning, policy);
  if (!inputs.ok) return inputs;
  const identity = versionKey(meaning);
  if (!allowlistsExactMeaning(meaning, policy, identity))
    return semanticFailure(
      'semantic.activation-denied',
      'The exact canonical meaning contents are not allowlisted by host policy.',
      ['id', 'revision'],
    );
  if (!allowsMeaningReference(policy, identity))
    return semanticFailure(
      'semantic.activation-denied',
      'The immutable meaning reference is not allowlisted by host policy.',
      ['id', 'revision'],
    );
  if (!meetsAuthorityPolicy(meaning, policy))
    return semanticFailure(
      'semantic.activation-authority',
      `Activation policy requires ${policy.minAuthority} authority.`,
      ['authority'],
    );
  return {
    ok: true,
    value: {
      state: 'authorized',
      meaning: { id: meaning.id, revision: meaning.revision },
      policyRevision: policy.policyRevision,
    },
  };
}
