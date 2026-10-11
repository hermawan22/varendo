import { describe, expect, it } from 'vitest';
import { parseContract, type MeaningDefinition } from '@varendo/core';
import { createLocalDataService } from '@varendo/runtime/data';
import { createMeaningAuthoring, createMeaningEvaluator, createMeaningRegistry } from '@varendo/runtime/meaning';
import {
  budget,
  catalog,
  functions,
  grant,
  query,
  snapshot,
  source,
  value,
} from '../../fixtures/scenarios/public-api.js';

function manualMeaning(): MeaningDefinition {
  const authoring = value(createMeaningAuthoring({ catalog, registry: functions }));
  const amount = value(authoring.field('items', 'amount'));
  const expression = value(authoring.call({ id: 'core.aggregate.sum', revision: '1' }, [amount]));
  return value(
    authoring.defineMeaning({
      id: 'items.total',
      label: 'Total amount',
      description: 'Exact sum of authorized item amounts.',
      expression,
      lifecycle: 'active',
      authority: 'reviewed',
      scope: 'workspace',
    }),
  ).meaning;
}

async function resultRows(
  service: ReturnType<typeof createLocalDataService>,
  principal: string,
): Promise<readonly Record<string, unknown>[]> {
  const plan = await service.plan(
    {
      version: '1',
      requestId: `scenario-${principal}`,
      catalogRevision: catalog.revision,
      target: { taskId: `scenario-${principal}`, outputId: 'items' },
      query: query(),
      budget,
    },
    { principal },
  );
  if (!plan.ok) throw new Error(plan.diagnostics[0]?.code);
  const rows: Record<string, unknown>[] = [];
  for await (const event of service.execute(plan.value, { principal })) {
    if (event.kind === 'batch') rows.push(...event.rows);
  }
  return rows;
}

describe('deterministic release scenarios through public package APIs', () => {
  it('S05/S06/S60/S65/S66: keeps typed code-defined meaning immutable, reviewed, and model-free', async () => {
    const meaning = manualMeaning();
    const authoring = value(createMeaningAuthoring({ catalog, registry: functions }));
    // The public typed builder rejects this at compile time; retain the wire
    // boundary check for an untyped host/import value as well.
    expect(authoring.field('items', 'unknown-field' as never).ok).toBe(false);

    const draft = value(authoring.draft(meaning, { source: { surface: 'code', ownership: 'code', readOnly: true } }));
    const registry = value(
      createMeaningRegistry({
        catalog,
        registry: functions,
        activationHost: {
          readContext: () => ({
            ok: true,
            value: {
              principalKey: 'alice',
              scopeDigest: source.scopeDigest,
              policyRevision: source.policyRevision,
              catalogRevision: catalog.revision,
              functionRegistryDigest: functions.digest,
              grants: ['meaning.activate'],
              policy: { policyRevision: source.policyRevision, allowlistedDefinitions: [meaning] },
            },
          }),
        },
      }),
    );
    expect(registry.register({ draft }).ok).toBe(true);
    expect(registry.register({ draft })).toMatchObject({ ok: true, value: { idempotent: true } });
    expect(registry.register({ draft: { ...draft, meaning: { ...meaning, label: 'Changed bytes' } } }).ok).toBe(false);
    expect((await registry.activate(meaning)).ok).toBe(true);

    const evaluator = value(createMeaningEvaluator({ catalog, registry: functions }));
    const evaluated = evaluator.evaluate({
      meaning,
      entity: 'items',
      source,
      scopeDigest: source.scopeDigest,
      policyRevision: source.policyRevision,
    });
    expect(evaluated).toMatchObject({ ok: true, value: { rows: [{ 'items.total': 5 }] } });
    expect(registry.get(meaning)?.draft.source).toEqual({ surface: 'code', ownership: 'code', readOnly: true });
  });

  it('S11/S19/S32: keeps tenant rows isolated and rejects unsupported projection before execution', async () => {
    const service = createLocalDataService({
      snapshot: snapshot(),
      functionRegistry: functions,
      authorize: ({ context }) =>
        context.principal === 'alice' ? grant('scope-alice', new Set(['a'])) : grant('scope-bob', new Set(['b'])),
    });
    await expect(resultRows(service, 'alice')).resolves.toEqual([{ id: 'a', owner: 'alice', amount: 2 }]);
    await expect(resultRows(service, 'bob')).resolves.toEqual([{ id: 'b', owner: 'bob', amount: 3 }]);

    const unsupported = await service.plan(
      {
        version: '1',
        requestId: 'unsupported-projection',
        catalogRevision: catalog.revision,
        target: { taskId: 'unsupported-projection', outputId: 'items' },
        query: query({ fields: ['owner'] }),
        budget,
      },
      { principal: 'alice' },
    );
    expect(unsupported).toMatchObject({ ok: false, diagnostics: [{ code: 'data.unsupported' }] });
    if (!unsupported.ok)
      expect(unsupported.diagnostics[0]?.remedies).toContain('Include all identity fields in the projection.');
  });

  it('S41/S44: accepts queryless presentation tasks and preserves unknown result metadata', () => {
    const ref = {
      id: 'result-1',
      revision: '1',
      outputId: 'items',
      queryDigest: 'query-1',
      scopeDigest: 'scope-alice',
    };
    const task = parseContract('task', {
      version: '1',
      id: 'inspect-items',
      revision: '1',
      catalogRevision: catalog.revision,
      functionRegistryDigest: functions.digest,
      regionId: 'items-region',
      goal: 'Inspect the current authorized items.',
      kind: 'presentation',
      needs: [],
      assumptions: [],
      inputs: [ref],
    });
    expect(task).toMatchObject({ ok: true, value: { kind: 'presentation', inputs: [ref] } });

    const result = parseContract('result', {
      version: '1',
      ref,
      taskId: 'inspect-items',
      fields: [],
      identity: [],
      rowGrain: [],
      counts: { loaded: 0, population: { kind: 'unknown' } },
      precision: { kind: 'exact' },
      coverage: { kind: 'unknown', reason: 'No rows are loaded.' },
      consistency: { kind: 'unknown', reason: 'No source snapshot was requested.' },
      evidence: { kind: 'computed', queryDigest: 'query-1', definitions: [] },
      filters: [],
      warnings: [],
      lineage: [],
    });
    expect(result).toMatchObject({ ok: true, value: { counts: { population: { kind: 'unknown' } } } });
  });
});
