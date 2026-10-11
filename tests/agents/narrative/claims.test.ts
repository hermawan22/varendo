import { describe, expect, it } from 'vitest';
import type { NarrativeClaim } from '../../../packages/core/dist/contracts/agent/index.js';
import type { Result } from '../../../packages/core/dist/index.js';
import { createResultStore } from '../../../packages/runtime/dist/results/index.js';
import { createNarrativeVerifier } from '../../../packages/agent/dist/narrative.js';
import type { NarrativeAuthority } from '../../../packages/agent/dist/narrative/types.js';

const ref = { id: 'result', revision: 'source-1', outputId: 'rows', queryDigest: 'query', scopeDigest: 'scope' };
const amountType = {
  value: 'decimal',
  nullable: true,
  unit: { dimension: 'money', symbol: '$', currency: 'USD' },
} as const;
const descriptor: Result = {
  version: '1',
  ref,
  taskId: 'task',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'amount', label: 'Amount', type: amountType, role: 'measure', derivation: { id: 'total', revision: '1' } },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 3, population: { kind: 'exact', value: 3, populationDigest: 'population' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'population' },
  consistency: { kind: 'snapshot', snapshotId: 'snapshot', sourceRevisions: { source: 'source-1' } },
  evidence: { kind: 'computed', queryDigest: 'query', definitions: [{ id: 'total', revision: '1' }] },
  filters: [],
  warnings: [],
  lineage: [],
};
const cell = {
  result: ref,
  field: 'amount',
  identity: { id: 'a' },
  type: amountType,
  definition: { id: 'total', revision: '1' },
  populationDigest: 'population',
  filters: [],
};
const claim: NarrativeClaim = {
  version: '1',
  id: 'claim',
  kind: 'value',
  cell,
  value: { decimal: '9007199254740993.01' },
};
async function fixture(change: Partial<Result> = {}) {
  const store = createResultStore();
  const handle = store.begin({
    principalKey: 'principal',
    scopeDigest: 'scope',
    policyRevision: 'policy',
    catalogRevision: 'catalog',
    functionRegistryDigest: 'functions',
    queryDigest: 'query',
    sourceRevision: 'source-1',
    outputId: 'rows',
    taskId: 'task',
    requestId: 'request',
    populationDigest: 'population',
  });
  const result = { ...descriptor, ...change };
  async function* events() {
    yield { kind: 'descriptor', descriptor: result };
    yield {
      kind: 'batch',
      result: ref,
      sequence: 0,
      rows: [
        { id: 'a', amount: { decimal: '9007199254740993.01' } },
        { id: 'b', amount: { decimal: '9007199254740993.02' } },
        { id: 'c', amount: null },
      ],
    };
    yield { kind: 'complete', result: ref, finalCoverage: result.coverage };
  }
  for await (const _ of handle.subscribe(events())) {
    /* Consume the real store stream. */
  }
  let context: NarrativeAuthority = {
    principalKey: 'principal',
    scopeDigest: 'scope',
    policyRevision: 'policy',
    catalogRevision: 'catalog',
    functionRegistryDigest: 'functions',
    grants: ['result.inspect'],
    resolveResult: () => handle,
  };
  return {
    store,
    handle,
    get context() {
      return context;
    },
    set context(value: NarrativeAuthority) {
      context = value;
    },
    verifier: createNarrativeVerifier({ readContext: () => ({ ok: true, value: context }) }),
  };
}
function code(outcome: ReturnType<ReturnType<typeof createNarrativeVerifier>['verify']>): string {
  return outcome.ok ? outcome.value.state : outcome.diagnostics[0].code;
}

describe('evidence-bound narrative verification', () => {
  it('checks the actual installed runtime handle using exact decimals', async () => {
    const f = await fixture();
    expect(f.handle.snapshot().status).toBe('ready');
    expect(code(f.verifier.verify(claim))).toBe('verified');
    expect(code(f.verifier.verify({ ...claim, value: { decimal: '9007199254740993.02' } }))).toBe('unverified');
    expect(code(f.verifier.verify({ ...claim, value: { decimal: '9007199254740993.010' } }))).toBe('verified');
    f.store.dispose();
  });
  it('compares exact values and leaves null ordering unknown', async () => {
    const f = await fixture();
    const comparison = {
      version: '1',
      id: 'comparison',
      kind: 'comparison',
      left: cell,
      right: { ...cell, identity: { id: 'b' } },
      relation: 'lt',
    };
    expect(code(f.verifier.verify(comparison))).toBe('verified');
    expect(code(f.verifier.verify({ ...comparison, relation: 'gt' }))).toBe('unverified');
    expect(f.verifier.verify({ ...comparison, right: { ...cell, identity: { id: 'c' } } })).toEqual({
      ok: true,
      value: { state: 'unverified', reason: 'null-comparison' },
    });
    expect(code(f.verifier.verify({ ...claim, cell: { ...cell, identity: { id: 'c' } }, value: null }))).toBe(
      'verified',
    );
    f.store.dispose();
  });
  it.each([
    ['scope', { result: { ...ref, scopeDigest: 'other' } }],
    ['revision', { result: { ...ref, revision: 'old' } }],
    ['output', { result: { ...ref, outputId: 'other' } }],
    ['population', { populationDigest: 'other' }],
    ['filters', { filters: [{ op: 'compare', comparison: 'eq', field: 'id', value: 'b' }] }],
    [
      'period',
      {
        period: {
          from: '2026-01-01T00:00:00Z',
          toExclusive: '2026-02-01T00:00:00Z',
          timezone: 'UTC',
          calendar: 'iso8601',
          interpretation: 'January',
        },
      },
    ],
    ['unit', { type: { ...amountType, unit: { dimension: 'money', symbol: '€', currency: 'EUR' } } }],
    ['definition', { definition: { id: 'total', revision: '2' } }],
    ['field', { field: 'missing' }],
    ['identity', { identity: { id: 'missing' } }],
    ['row index', { identity: { index: 0 } }],
  ])('rejects a mismatched %s', async (_label, change) => {
    const f = await fixture();
    expect(code(f.verifier.verify({ ...claim, cell: { ...cell, ...change } }))).toMatch(/^agent\.narrative\./);
    f.store.dispose();
  });
  it.each([
    { precision: { kind: 'approximate', method: 'sample', uncertainty: { kind: 'unquantified', reason: 'unknown' } } },
    { coverage: { kind: 'partial', populationDigest: 'population', reason: 'paged' } },
    { coverage: { kind: 'sample', populationDigest: 'population', method: 'sample' } },
    { coverage: { kind: 'unknown', reason: 'unknown' } },
    { consistency: { kind: 'mixed', sourceRevisions: { source: 'source-1' }, reason: 'mixed' } },
    {
      evidence: {
        kind: 'inferred',
        recipe: { id: 'model', revision: '1' },
        method: 'inference',
        uncertainty: { kind: 'unquantified', reason: 'unknown' },
      },
    },
  ] as Partial<Result>[])('requires exact complete non-inferred evidence %j', async (change) => {
    const f = await fixture(change);
    expect(f.verifier.verify(claim).ok).toBe(false);
    f.store.dispose();
  });
  it('refuses ambiguous computed metric provenance from a descriptor', async () => {
    const f = await fixture({ fields: descriptor.fields.map(({ derivation: _, ...field }) => field) });
    const { definition: _, ...unversioned } = cell;
    expect(code(f.verifier.verify({ ...claim, cell: unversioned }))).toBe('agent.narrative.definition');
    expect(code(f.verifier.verify(claim))).toBe('agent.narrative.definition');
    f.store.dispose();
  });
  it('does not turn cited prose into verified truth', async () => {
    const f = await fixture();
    for (const kind of ['inference', 'hypothesis'])
      expect(
        f.verifier.verify({ version: '1', id: 'prose', kind, text: 'This proves causation.', references: [ref] }),
      ).toEqual({ ok: true, value: { state: 'unverified', reason: 'interpretation' } });
    expect(f.verifier.verify({ ...claim, text: 'This proves causation.' }).ok).toBe(false);
    f.store.dispose();
  });
  it('does not inspect a handle without the independent grant', async () => {
    const f = await fixture();
    let accessed = 0;
    f.context = {
      ...f.context,
      grants: ['catalog.read', 'model.egress'],
      resolveResult: () => {
        accessed++;
        return f.handle;
      },
    };
    expect(code(f.verifier.verify(claim))).toBe('agent.narrative.denied');
    expect(accessed).toBe(0);
    f.store.dispose();
  });
  it('rejects cross-principal handles and clears revoked evidence', async () => {
    const f = await fixture();
    f.context = { ...f.context, principalKey: 'other' };
    expect(code(f.verifier.verify(claim))).toBe('agent.narrative.denied');
    f.context = { ...f.context, principalKey: 'principal' };
    f.store.revoke({ principalKey: 'principal' });
    expect(f.handle.snapshot().batches).toHaveLength(0);
    expect(f.verifier.verify(claim).ok).toBe(false);
    f.store.dispose();
  });
  it('rechecks host authority after resolving data', async () => {
    const f = await fixture();
    let reads = 0;
    const verifier = createNarrativeVerifier({
      readContext: () => ({ ok: true, value: { ...f.context, grants: ++reads === 1 ? ['result.inspect'] : [] } }),
    });
    expect(code(verifier.verify(claim))).toBe('agent.narrative.denied');
    f.store.dispose();
  });
  it('rejects reentrant revocation during the final resolver check', async () => {
    const f = await fixture();
    let resolutions = 0;
    f.context = {
      ...f.context,
      resolveResult: () => {
        if (++resolutions === 2) f.store.revoke({ principalKey: 'principal' });
        return f.handle;
      },
    };
    expect(code(f.verifier.verify(claim))).toBe('agent.narrative.stale');
    f.store.dispose();
  });
  it('bounds scanning and handles unavailable host context', async () => {
    const f = await fixture();
    const verifier = createNarrativeVerifier({ maxRows: 1, readContext: () => ({ ok: true, value: f.context }) });
    expect(code(verifier.verify(claim))).toBe('agent.narrative.budget');
    expect(
      createNarrativeVerifier({
        readContext: () => {
          throw Error('secret');
        },
      }).verify(claim),
    ).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'agent.narrative.unavailable',
          message: 'Claim verification could not obtain current authorized evidence.',
          retryable: false,
        },
      ],
    });
    f.store.dispose();
  });
});
