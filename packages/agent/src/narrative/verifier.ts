import { parseContract, type Outcome } from '@varendo/core';
import type { NarrativeClaim } from '@varendo/core/agent';
import { verifyClaim } from './claim.js';
import { authorized, fail, pins } from './shared.js';
import type {
  NarrativeAuthority,
  NarrativeEvidenceTrace,
  NarrativeReceipt,
  NarrativeVerifierOptions,
} from './types.js';

function currentAuthority(options: NarrativeVerifierOptions, expectedPins: string): Outcome<NarrativeAuthority> {
  const current = options.readContext();
  if (!current.ok || !authorized(current.value) || pins(current.value) !== expectedPins)
    return fail('denied', 'Result authority changed during verification.');
  return current;
}

function sameSnapshot(entry: NarrativeEvidenceTrace['used'][number]): boolean {
  const latest = entry.handle.snapshot();
  return (
    latest.status === 'ready' &&
    latest.generation === entry.snapshot.generation &&
    latest.descriptor === entry.snapshot.descriptor &&
    latest.batches === entry.snapshot.batches &&
    latest.loadedRows === entry.snapshot.loadedRows
  );
}

function verifyCurrentEvidence(
  options: NarrativeVerifierOptions,
  expectedPins: string,
  trace: NarrativeEvidenceTrace,
): Outcome<void> {
  const current = currentAuthority(options, expectedPins);
  if (!current.ok) return current;
  for (const entry of trace.used)
    if (current.value.resolveResult(entry.ref) !== entry.handle)
      return fail('stale', 'Result evidence changed during verification.');
  const final = currentAuthority(options, expectedPins);
  if (!final.ok) return final;
  for (const entry of trace.used)
    if (!sameSnapshot(entry)) return fail('stale', 'Result evidence changed during verification.');
  return { ok: true, value: undefined };
}

function unverified(reason: 'interpretation' | 'false' | 'null-comparison'): Outcome<NarrativeReceipt> {
  return { ok: true, value: { state: 'unverified', reason } };
}

function verifyParsedClaim(
  claim: NarrativeClaim,
  context: NarrativeAuthority,
  initialPins: string,
  options: NarrativeVerifierOptions,
  maxRows: number,
): Outcome<NarrativeReceipt> {
  if (claim.kind !== 'value' && claim.kind !== 'comparison') return unverified('interpretation');
  const trace: NarrativeEvidenceTrace = { maxRows, scanned: 0, used: [] };
  const checked = verifyClaim(claim, context, trace);
  if (!checked.ok) return checked;
  const current = verifyCurrentEvidence(options, initialPins, trace);
  if (!current.ok) return current;
  if (!checked.value.truth) return unverified(checked.value.nullComparison ? 'null-comparison' : 'false');
  return {
    ok: true,
    value: {
      state: 'verified',
      claim,
      evidence: trace.used.map(({ ref, handle }) => ({ result: ref, generation: handle.generation })),
    },
  };
}

/** Verifies exact structured cells only. The receipt never certifies human intent or prose entailment. */
export function createNarrativeVerifier(options: NarrativeVerifierOptions): {
  verify(input: unknown): Outcome<NarrativeReceipt>;
} {
  const maxRows = options.maxRows ?? 100_000;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1_000_000)
    throw new RangeError('maxRows must be between 1 and 1000000.');
  return {
    verify(input: unknown): Outcome<NarrativeReceipt> {
      try {
        const initial = options.readContext();
        if (!initial.ok || !authorized(initial.value)) return fail('denied', 'Result inspection is not authorized.');
        const parsed = parseContract('narrative-claim', input);
        if (!parsed.ok) return parsed;
        return verifyParsedClaim(parsed.value, initial.value, pins(initial.value), options, maxRows);
      } catch {
        return fail('unavailable', 'Claim verification could not obtain current authorized evidence.');
      }
    },
  };
}
