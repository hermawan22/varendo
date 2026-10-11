import { compareScalars, validateScalar, type Outcome } from '@varendo/core';
import type { NarrativeClaim } from '@varendo/core/agent';
import { fail, same } from './shared.js';
import { verifyCell } from './evidence.js';
import type {
  NarrativeAuthority,
  NarrativeClaimCheck,
  NarrativeEvidenceTrace,
  NarrativeStructuredClaim,
} from './types.js';

function verifyValueClaim(
  claim: Extract<NarrativeClaim, { kind: 'value' }>,
  context: NarrativeAuthority,
  trace: NarrativeEvidenceTrace,
): Outcome<NarrativeClaimCheck> {
  const actual = verifyCell(claim.cell, context, trace);
  if (!actual.ok) return actual;
  const expected = validateScalar(claim.value, claim.cell.type);
  if (!expected.ok) return fail('value', 'The claim value has an invalid type.');
  const compared = compareScalars(actual.value, expected.value, claim.cell.type);
  if (!compared.ok) return compared;
  return {
    ok: true,
    value: {
      truth: (actual.value === null && expected.value === null) || compared.value === 0,
      nullComparison: false,
    },
  };
}

function relationResult(relation: string, order: number): boolean {
  switch (relation) {
    case 'eq':
      return order === 0;
    case 'ne':
      return order !== 0;
    case 'lt':
      return order < 0;
    case 'lte':
      return order <= 0;
    case 'gt':
      return order > 0;
    case 'gte':
      return order >= 0;
    default:
      return false;
  }
}

function verifyComparisonClaim(
  claim: Extract<NarrativeClaim, { kind: 'comparison' }>,
  context: NarrativeAuthority,
  trace: NarrativeEvidenceTrace,
): Outcome<NarrativeClaimCheck> {
  if (!same(claim.left.type, claim.right.type))
    return fail('type', 'Comparison cells must have the same semantic type.');
  const left = verifyCell(claim.left, context, trace);
  if (!left.ok) return left;
  const right = verifyCell(claim.right, context, trace);
  if (!right.ok) return right;
  const compared = compareScalars(left.value, right.value, claim.left.type);
  if (!compared.ok) return compared;
  const order = compared.value;
  return {
    ok: true,
    value: {
      truth: order !== null && relationResult(claim.relation, order),
      nullComparison: order === null,
    },
  };
}

export function verifyClaim(
  claim: NarrativeStructuredClaim,
  context: NarrativeAuthority,
  trace: NarrativeEvidenceTrace,
): Outcome<NarrativeClaimCheck> {
  if (claim.kind === 'value') return verifyValueClaim(claim, context, trace);
  return verifyComparisonClaim(claim, context, trace);
}
