import * as z from 'zod/mini';
import { inspectWire } from './ingress.js';
import { commitPreconditionsSchema, resultRefSchema } from './schemas.js';
import { WIRE_LIMITS } from './limits.js';
import type { CommitPreconditions, Outcome, ResultRef } from './types.js';
import { resultRefKey } from './stable.js';

const scalarPins = [
  'scopeDigest',
  'policyRevision',
  'taskRevision',
  'regionRevision',
  'catalogRevision',
  'experienceRevision',
  'functionRegistryDigest',
] as const;
const requiredRefsSchema = z.array(resultRefSchema).check(z.maxLength(WIRE_LIMITS.array));
const failure = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

type ParsedResultRef = Omit<ResultRef, 'sourceLineage'> & { readonly sourceLineage?: string | undefined };

function ownResultRef(ref: ParsedResultRef): ResultRef {
  return Object.freeze({
    id: ref.id,
    revision: ref.revision,
    ...(ref.sourceLineage === undefined ? {} : { sourceLineage: ref.sourceLineage }),
    outputId: ref.outputId,
    queryDigest: ref.queryDigest,
    scopeDigest: ref.scopeDigest,
  });
}

function parsePins(input: unknown): Outcome<CommitPreconditions> {
  const wire = inspectWire(input);
  if (!wire.ok) return wire;
  const parsed = z.safeParse(commitPreconditionsSchema, wire.value);
  if (!parsed.success)
    return failure('commit.invalid-read-set', 'The commit read set does not match its bounded canonical schema.');
  const pins = parsed.data;
  const keys = new Set<string>();
  for (const ref of pins.results) {
    const key = resultRefKey(ref);
    if (keys.has(key))
      return failure('commit.duplicate-result', 'The commit read set contains a duplicate result reference.');
    keys.add(key);
    if (ref.scopeDigest !== pins.scopeDigest)
      return failure('commit.result-scope', 'A result reference belongs to a different authorization scope.');
  }
  return {
    ok: true,
    value: Object.freeze({ ...pins, results: Object.freeze(pins.results.map(ownResultRef)) }),
  };
}

/**
 * Compare schema-parsed read sets without reparsing their bounded wire shape.
 * This is intentionally not part of the public root API: callers must obtain
 * both values from the canonical parser before using this composition helper.
 */
export function validateParsedCommitReadSet(
  expected: CommitPreconditions,
  current: CommitPreconditions,
  requiredResults: readonly ResultRef[] = [],
): Outcome<CommitPreconditions> {
  for (const pin of scalarPins) {
    if (expected[pin] !== current[pin])
      return failure('commit.stale', 'A version or authorization pin changed after this update was staged.');
  }
  const reads = new Set(expected.results.map(resultRefKey));
  for (const ref of requiredResults) {
    if (ref.scopeDigest !== expected.scopeDigest || !reads.has(resultRefKey(ref)))
      return failure(
        'commit.missing-dependency',
        'The read set omits a required result dependency or its authorized scope.',
      );
  }
  const available = new Set(current.results.map(resultRefKey));
  for (const ref of expected.results) {
    if (!available.has(resultRefKey(ref)))
      return failure('commit.stale', 'A referenced result is no longer available at the staged revision and scope.');
  }
  return { ok: true, value: expected };
}

/**
 * Compare declared semantic reads against the current host-owned version pins.
 * The caller derives requiredResults from the actual candidate and operations;
 * a self-declared read set alone cannot establish which dependencies were read.
 * Repeated required references are allowed when several views use one result.
 * This pure check grants no effects and does not perform implicit rebasing.
 */
export function validateCommitReadSet(
  expectedInput: unknown,
  currentInput: unknown,
  requiredResults: readonly ResultRef[] = [],
): Outcome<CommitPreconditions> {
  const expected = parsePins(expectedInput);
  if (!expected.ok) return expected;
  const current = parsePins(currentInput);
  if (!current.ok) return current;
  const requiredWire = inspectWire(requiredResults);
  if (!requiredWire.ok) return requiredWire;
  const required = z.safeParse(requiredRefsSchema, requiredWire.value);
  if (!required.success)
    return failure('commit.invalid-dependencies', 'The required result dependencies are not valid bounded references.');
  return validateParsedCommitReadSet(expected.value, current.value, required.data.map(ownResultRef));
}
