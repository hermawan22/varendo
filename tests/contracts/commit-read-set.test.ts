import { describe, expect, it } from 'vitest';
import { validateCommitReadSet, type CommitPreconditions, type ResultRef } from '../../packages/core/src/index.js';

const ref: ResultRef = {
  id: 'result-1',
  revision: 'result-revision-1',
  outputId: 'ranking',
  queryDigest: 'ranking-query',
  scopeDigest: 'scope-1',
};
const trend: ResultRef = { ...ref, id: 'result-2', outputId: 'trend', queryDigest: 'trend-query' };
const pins: CommitPreconditions = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: 'task-1',
  regionRevision: 'region-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'profile-1',
  functionRegistryDigest: 'functions-1',
  results: [ref, trend],
};
const code = (outcome: ReturnType<typeof validateCommitReadSet>) =>
  outcome.ok ? undefined : outcome.diagnostics[0].code;

describe('semantic commit read sets', () => {
  it('compares references independent of order and permits unrelated current results', () => {
    const current = { ...pins, results: [trend, { ...ref, id: 'unrelated' }, ref] };
    const result = validateCommitReadSet(pins, current, [ref, trend]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.results)).toBe(true);
    expect(Object.isFrozen(result.value.results[0])).toBe(true);
    expect(result.value).not.toBe(pins);
    expect(validateCommitReadSet(pins, current, [ref, trend, ref]).ok).toBe(true);
  });

  it('checks every scalar dependency even when the region itself has not changed', () => {
    for (const pin of [
      'scopeDigest',
      'policyRevision',
      'taskRevision',
      'regionRevision',
      'catalogRevision',
      'experienceRevision',
      'functionRegistryDigest',
    ] as const) {
      const current = {
        ...pins,
        [pin]: 'changed',
        results:
          pin === 'scopeDigest' ? pins.results.map((result) => ({ ...result, scopeDigest: 'changed' })) : pins.results,
      };
      expect(code(validateCommitReadSet(pins, current)), pin).toBe('commit.stale');
    }
  });

  it('checks every result reference part and all expected result dependencies', () => {
    for (const field of ['id', 'revision', 'outputId', 'queryDigest'] as const) {
      expect(
        code(validateCommitReadSet(pins, { ...pins, results: [ref, { ...trend, [field]: 'changed' }] })),
        field,
      ).toBe('commit.stale');
    }
    expect(code(validateCommitReadSet(pins, { ...pins, results: [ref] }))).toBe('commit.stale');
    expect(
      code(validateCommitReadSet(pins, { ...pins, results: [ref, { ...trend, scopeDigest: 'other-scope' }] })),
    ).toBe('commit.result-scope');
  });

  it('refuses an omitted actual dependency even when a self-declared subset matches', () => {
    const declaredSubset = { ...pins, results: [ref] };
    expect(code(validateCommitReadSet(declaredSubset, pins, [ref, trend]))).toBe('commit.missing-dependency');
    expect(code(validateCommitReadSet(pins, pins, [{ ...ref, scopeDigest: 'other-scope' }]))).toBe(
      'commit.missing-dependency',
    );
  });

  it('rejects malformed pins, duplicate exact references and caller privilege fields', () => {
    expect(code(validateCommitReadSet({ ...pins, results: [ref, ref] }, pins))).toBe('commit.duplicate-result');
    expect(code(validateCommitReadSet(pins, { ...pins, results: [ref, ref] }))).toBe('commit.duplicate-result');
    expect(code(validateCommitReadSet({ ...pins, actor: 'human' }, pins))).toBe('commit.invalid-read-set');
    const { policyRevision: _policy, ...missing } = pins;
    expect(code(validateCommitReadSet(missing, pins))).toBe('commit.invalid-read-set');
    expect(validateCommitReadSet(pins, pins, [{ ...ref, revision: undefined }] as never).ok).toBe(false);
    let accessed = false;
    expect(
      validateCommitReadSet(
        {
          ...pins,
          get results() {
            accessed = true;
            return [ref];
          },
        },
        pins,
      ).ok,
    ).toBe(false);
    expect(accessed).toBe(false);
  });

  it('checks declared revisions without treating an unused result as a dependency', () => {
    const rankingOnly = { ...pins, results: [ref] };
    expect(
      validateCommitReadSet(rankingOnly, { ...pins, results: [ref, { ...trend, revision: 'new-trend' }] }, [ref]).ok,
    ).toBe(true);
  });
});
