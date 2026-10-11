import { describe, expect, it } from 'vitest';
import type { NarrativeClaim } from '../../packages/core/src/contracts/agent/index.js';
import type { ResultRef } from '../../packages/core/src/index.js';
import { createNarrativeVerifier } from '../../packages/agent/src/narrative.js';
import type { NarrativeAuthority } from '../../packages/agent/src/narrative/types.js';
import { createResultStore } from '../../packages/runtime/src/results/index.js';
import {
  createRegionStore,
  type RegionAuthority,
  type RegionContent,
} from '../../packages/runtime/src/regions/index.js';
import { assertDeniedSnapshot, assertNoMaterializedRows } from '../../packages/testkit/src/index.js';
import { resultDescriptor, resultRef } from './fixtures.js';

const ok = <T>(value: T) => ({ ok: true as const, value });

const ref: ResultRef = resultRef();
const resultKey = {
  principalKey: 'alice',
  scopeDigest: 'scope-alice',
  policyRevision: 'policy-alice',
  queryDigest: ref.queryDigest,
  catalogRevision: 'security-catalog-1',
  functionRegistryDigest: 'security-functions-1',
  sourceRevision: 'security-source-1',
  outputId: ref.outputId,
  taskId: 'security-task',
  requestId: 'security-materialization',
  populationDigest: 'security-population',
} as const;

async function materializedResult() {
  const store = createResultStore();
  const handle = store.begin(resultKey);
  const descriptor = resultDescriptor(ref);
  async function* events() {
    yield { kind: 'descriptor', descriptor };
    yield {
      kind: 'batch',
      result: ref,
      sequence: 0,
      rows: [
        { id: 'row-alice', owner: 'alice', secret: 'alice-secret' },
        { id: 'row-bob', owner: 'bob', secret: 'bob-secret' },
      ],
    };
    yield { kind: 'complete', result: ref, finalCoverage: descriptor.coverage };
  }
  for await (const _update of handle.subscribe(events())) {
    /* materialize through the real stream boundary */
  }
  expect(handle.snapshot().status).toBe('ready');
  return { store, handle };
}

function regionTask(): Extract<RegionContent['task'], { readonly kind: 'presentation' }> {
  return {
    version: '1',
    id: 'security-task',
    revision: '1',
    catalogRevision: 'security-catalog-1',
    functionRegistryDigest: 'security-functions-1',
    regionId: 'security-region',
    goal: 'Show authorized rows',
    kind: 'presentation',
    needs: [],
    assumptions: [],
    inputs: [ref],
  };
}

function authority(): RegionAuthority {
  return {
    principalKey: 'alice',
    scopeDigest: 'scope-alice',
    policyRevision: 'policy-alice',
    catalogRevision: 'security-catalog-1',
    experienceRevision: 'security-experience-1',
    functionRegistryDigest: 'security-functions-1',
    results: [ref],
  };
}

function narrativeClaim(): NarrativeClaim {
  const text = { value: 'text' as const, nullable: false };
  return {
    version: '1',
    id: 'security-claim',
    kind: 'value',
    cell: {
      result: ref,
      field: 'secret',
      identity: { id: 'row-alice' },
      type: text,
      populationDigest: 'security-population',
      filters: [],
    },
    value: 'alice-secret',
  };
}

describe('revocation materializations', () => {
  it('clears result rows, dependent region state and evidence verification together', async () => {
    const { store, handle } = await materializedResult();
    const current = authority();
    const regions = createRegionStore({
      readAuthority: () => ok(current),
      authorizeCommit: async () => ok(undefined),
    });
    const created = regions.create({ id: 'security-region', state: { task: regionTask() } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const regionHandle = created.value;
    const staged = await regionHandle.stage({
      requestId: 'security-commit',
      expected: regionHandle.snapshot().readSet!,
      state: { task: regionTask() },
      resultHandles: [handle],
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    await expect(regionHandle.commit(staged.value)).resolves.toMatchObject({ ok: true });
    expect(regionHandle.snapshot().state).toBeDefined();

    let context: NarrativeAuthority = {
      principalKey: 'alice',
      scopeDigest: 'scope-alice',
      policyRevision: 'policy-alice',
      catalogRevision: 'security-catalog-1',
      functionRegistryDigest: 'security-functions-1',
      grants: ['result.inspect'],
      resolveResult: () => handle,
    };
    const verifier = createNarrativeVerifier({ readContext: () => ok(context) });
    expect(verifier.verify(narrativeClaim())).toMatchObject({ ok: true, value: { state: 'verified' } });

    // Revocation has to erase the materialized bytes first; the host then
    // revokes the region so its task/presentation cannot retain a dead ref.
    store.revoke({ principalKey: 'alice', scopeDigest: 'scope-alice' });
    const revokedSnapshot = handle.snapshot();
    expect(revokedSnapshot).toMatchObject({
      status: 'denied',
      batches: [],
      diagnostics: [{ code: 'data.authorization-revoked' }],
    });
    assertDeniedSnapshot(revokedSnapshot, 'data.authorization-revoked');
    assertNoMaterializedRows(revokedSnapshot);
    expect(revokedSnapshot.descriptor).toBeUndefined();
    expect(verifier.verify(narrativeClaim()).ok).toBe(false);
    expect(regions.revoke('security-region', 'permission revoked')).toBe(true);
    expect(regionHandle.snapshot().status).toBe('revoked');
    expect(regionHandle.snapshot().state).toBeUndefined();
    context = { ...context, grants: [] };
    expect(verifier.verify(narrativeClaim()).ok).toBe(false);
    store.dispose();
    regions.dispose();
  });
});
