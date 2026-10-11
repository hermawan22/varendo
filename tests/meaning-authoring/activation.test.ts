import { expect, it } from 'vitest';
import { type Catalog, type MeaningDefinition, type Outcome } from '@varendo/core';
import { createStandardFunctionRegistry } from '@varendo/core/expressions';
import {
  createMeaningAuthoring,
  createMeaningRegistry,
  type MeaningActivationContext,
} from '../../packages/runtime/src/meaning/index.js';
const functions = value(createStandardFunctionRegistry('activation-functions'));
const catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: functions.digest,
  entities: [
    {
      id: 'items',
      label: 'Items',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [
        { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
        { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'integer', nullable: false } },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
} as const satisfies Catalog;
function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function setup(read?: (context: MeaningActivationContext, call: number) => MeaningActivationContext) {
  const author = value(createMeaningAuthoring({ catalog, registry: functions }));
  const expression = author.call({ id: 'core.aggregate.sum', revision: '1' }, [author.field('items', 'amount')]);
  const draft = value(
    author.defineMeaning({
      id: 'items.total',
      label: 'Total',
      description: 'Total amount',
      expression,
      lifecycle: 'active',
      authority: 'reviewed',
      scope: 'workspace',
    }),
  );
  const context: MeaningActivationContext = {
    principalKey: 'principal-1',
    scopeDigest: 'scope-1',
    policyRevision: 'policy-1',
    catalogRevision: catalog.revision,
    functionRegistryDigest: functions.digest,
    grants: ['meaning.activate'],
    policy: { policyRevision: 'policy-1', allowlistedDefinitions: [draft.meaning] },
  };
  let calls = 0;
  const registry = value(
    createMeaningRegistry({
      catalog,
      registry: functions,
      activationHost: { readContext: () => ({ ok: true, value: read ? read(context, ++calls) : context }) },
    }),
  );
  value(registry.register({ draft }));
  return { registry, draft, context };
}
it('activates exact immutable reviewed content and clears its scope', async () => {
  const { registry, draft } = setup();
  expect((await registry.activate(draft.meaning)).ok).toBe(true);
  expect(registry.get(draft.meaning)?.draft).toEqual(draft);
  expect(registry.get(draft.meaning)?.active).toBe(true);
  expect(value(registry.revokeScope('scope-1'))).toHaveLength(1);
  expect(registry.definitions()).toEqual([]);
});
it('requires the independent activation grant', async () => {
  const { registry, draft } = setup((c) => ({ ...c, grants: [] }));
  expect((await registry.activate(draft.meaning)).ok).toBe(false);
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('never substitutes allowlisted contents at an existing immutable version', async () => {
  const { registry, draft } = setup((c) => ({
    ...c,
    policy: {
      ...c.policy,
      allowlistedDefinitions: c.policy.allowlistedDefinitions.map((m) => ({ ...m, label: 'Substituted label' })),
    },
  }));
  expect((await registry.activate(draft.meaning)).ok).toBe(false);
  expect(registry.get(draft.meaning)?.draft).toEqual(draft);
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('observes cancellation during the final authority read', async () => {
  const abort = new AbortController();
  const { registry, draft } = setup((c, n) => {
    if (n === 2) abort.abort();
    return c;
  });
  expect((await registry.activate(draft.meaning, { signal: abort.signal })).ok).toBe(false);
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('snapshots authority before a host mutates and reuses the same object', async () => {
  const { registry, draft } = setup((c, n) => {
    if (n === 2) (c as { scopeDigest: string }).scopeDigest = 'scope-2';
    return c;
  });
  expect((await registry.activate(draft.meaning)).ok).toBe(false);
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('scope revocation invalidates an activation still awaiting final authority', async () => {
  let registry: ReturnType<typeof setup>['registry'];
  const setupResult = setup((c, n) => {
    if (n === 2) value(registry.revokeScope('scope-1'));
    return c;
  });
  registry = setupResult.registry;
  expect((await registry.activate(setupResult.draft.meaning)).ok).toBe(false);
  expect(registry.get(setupResult.draft.meaning)?.active).toBe(false);
});
it('requires matching nested and outer activation policy revision', async () => {
  const { registry, draft } = setup((c) => ({ ...c, policy: { ...c.policy, policyRevision: 'different' } }));
  expect((await registry.activate(draft.meaning)).ok).toBe(false);
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('rejects malformed registration without throwing', () => {
  const { registry } = setup();
  expect(registry.register(null as never).ok).toBe(false);
  expect(registry.register(undefined as never).ok).toBe(false);
});
function constant(id: string, dependencies: MeaningDefinition['dependencies'] = []): MeaningDefinition {
  return {
    id,
    revision: '1',
    label: id,
    explanation: id,
    output: { value: 'integer', nullable: false },
    implementation: {
      kind: 'expression',
      expression: { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
    },
    dependencies,
    functionRegistryDigest: functions.digest,
    origin: 'manual',
    lifecycle: 'active',
    scope: 'workspace',
    authority: 'reviewed',
    aggregation: 'none',
    aggregationDimensions: [],
    missingPolicy: 'propagate',
  };
}
it('registers a same-bundle dependency DAG atomically and activates a registered dependency', async () => {
  const base = constant('base'),
    derived = constant('derived', [{ id: 'base', revision: '1' }]);
  const registry = value(
    createMeaningRegistry({
      catalog,
      registry: functions,
      activationHost: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'p',
            scopeDigest: 'scope',
            policyRevision: 'policy',
            catalogRevision: catalog.revision,
            functionRegistryDigest: functions.digest,
            grants: ['meaning.activate'],
            policy: { policyRevision: 'policy', allowlistedDefinitions: [base, derived] },
          },
        }),
      },
    }),
  );
  const bundle = {
    catalogRevision: catalog.revision,
    functionRegistryDigest: functions.digest,
    meanings: [derived, base],
  };
  expect(registry.registerBundle(bundle).ok).toBe(true);
  expect(registry.list()).toHaveLength(2);
  expect((await registry.activate(derived)).ok).toBe(false);
  expect((await registry.activate(base)).ok).toBe(true);
  expect((await registry.activate(derived)).ok).toBe(true);
  value(registry.revoke(base));
  expect(registry.definitions({ activeOnly: true })).toEqual([]);
});
it('masks revoked catalog definitions from the registry view', () => {
  const base = constant('catalog-base');
  const localCatalog = { ...catalog, meanings: [base] };
  const registry = value(createMeaningRegistry({ catalog: localCatalog, registry: functions }));
  const draft = value(value(createMeaningAuthoring({ catalog: localCatalog, registry: functions })).draft(base));
  value(registry.register({ draft }));
  value(registry.revoke(base));
  expect(registry.definitions()).toEqual([]);
});
it('preserves atomic bundle registration on capacity and conflict failure', () => {
  const registry = value(createMeaningRegistry({ catalog, registry: functions, maxEntries: 1 }));
  const bundle = {
    catalogRevision: catalog.revision,
    functionRegistryDigest: functions.digest,
    meanings: [constant('one'), constant('two')],
  };
  expect(registry.registerBundle(bundle).ok).toBe(false);
  expect(registry.list()).toEqual([]);
});
it('keeps dependent activation flags cleared after dependency revocation', async () => {
  const base = constant('parent'),
    derived = constant('child', [{ id: 'parent', revision: '1' }]);
  const registry = value(
    createMeaningRegistry({
      catalog,
      registry: functions,
      activationHost: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'p',
            scopeDigest: 'scope',
            policyRevision: 'policy',
            catalogRevision: catalog.revision,
            functionRegistryDigest: functions.digest,
            grants: ['meaning.activate'],
            policy: { policyRevision: 'policy', allowlistedDefinitions: [base, derived] },
          },
        }),
      },
    }),
  );
  value(
    registry.registerBundle({
      catalogRevision: catalog.revision,
      functionRegistryDigest: functions.digest,
      meanings: [base, derived],
    }),
  );
  value(await registry.activate(base));
  value(await registry.activate(derived));
  value(registry.revoke(base));
  expect(registry.list({ activeOnly: true })).toEqual([]);
});
it('does not silently reuse an activated registry across principals or scopes', async () => {
  let principal = 'first',
    scope = 'first-scope';
  const { registry, draft } = setup((c) => ({ ...c, principalKey: principal, scopeDigest: scope }));
  value(await registry.activate(draft.meaning));
  principal = 'second';
  scope = 'second-scope';
  expect((await registry.activate(draft.meaning)).ok).toBe(false);
  expect(value(registry.revokeScope('first-scope'))).toHaveLength(1);
});
it('binds activation to the trusted calling adapter principal', async () => {
  const { registry, draft } = setup();
  expect((await registry.activate(draft.meaning, { expectedAuthority: { principalKey: 'other-principal' } })).ok).toBe(
    false,
  );
  expect(registry.get(draft.meaning)?.active).toBe(false);
});
it('keeps a code-deployed catalog meaning visible when its identical draft is registered', () => {
  const base = constant('deployed');
  const localCatalog = { ...catalog, meanings: [base] };
  const registry = value(createMeaningRegistry({ catalog: localCatalog, registry: functions }));
  const draft = value(value(createMeaningAuthoring({ catalog: localCatalog, registry: functions })).draft(base));
  value(registry.register({ draft }));
  expect(registry.definitions({ activeOnly: true })).toEqual([base]);
});
it('rejects malformed activation options without throwing', async () => {
  const { registry, draft } = setup();
  expect((await registry.activate(draft.meaning, null as never)).ok).toBe(false);
  expect(registry.list(null as never)).toHaveLength(1);
  expect(registry.definitions(null as never)).toEqual([]);
});
it('reports all scope-revoked dependents and prevents later activation in the revoked scope', async () => {
  const base = constant('scope-parent'),
    derived = constant('scope-child', [{ id: base.id, revision: '1' }]),
    later = constant('later');
  const registry = value(
    createMeaningRegistry({
      catalog,
      registry: functions,
      activationHost: {
        readContext: () => ({
          ok: true,
          value: {
            principalKey: 'p',
            scopeDigest: 'scope',
            policyRevision: 'policy',
            catalogRevision: catalog.revision,
            functionRegistryDigest: functions.digest,
            grants: ['meaning.activate'],
            policy: { policyRevision: 'policy', allowlistedDefinitions: [base, derived, later] },
          },
        }),
      },
    }),
  );
  value(
    registry.registerBundle({
      catalogRevision: catalog.revision,
      functionRegistryDigest: functions.digest,
      meanings: [base, derived, later],
    }),
  );
  value(await registry.activate(base));
  value(await registry.activate(derived));
  expect(
    value(registry.revokeScope('scope'))
      .map((x) => x.meaning.id)
      .sort(),
  ).toEqual(['scope-child', 'scope-parent']);
  expect((await registry.activate(later)).ok).toBe(false);
});
it('pins registry catalog and inherited meanings at construction', () => {
  const base = constant('pinned');
  const mutableCatalog: Catalog = { ...catalog, meanings: [base] };
  const registry = value(createMeaningRegistry({ catalog: mutableCatalog, registry: functions }));
  (mutableCatalog as { revision: string }).revision = 'mutated';
  (base as { label: string }).label = 'Mutated';
  expect(registry.catalog.revision).toBe('catalog-1');
  expect(registry.definitions()[0]?.label).toBe('pinned');
});
it('bounds aggregate retained draft bytes without partially registering a bundle', () => {
  const registry = value(createMeaningRegistry({ catalog, registry: functions, maxBytes: 100 }));
  expect(
    registry.registerBundle({
      catalogRevision: catalog.revision,
      functionRegistryDigest: functions.digest,
      meanings: [constant('large')],
    }).ok,
  ).toBe(false);
  expect(registry.list()).toEqual([]);
  expect(createMeaningRegistry({ catalog, registry: functions, maxBytes: 0 }).ok).toBe(false);
});
it('validates code-deployed catalog meanings at registry startup', () => {
  const invalid = constant('invalid', [{ id: 'missing', revision: '1' }]);
  expect(createMeaningRegistry({ catalog: { ...catalog, meanings: [invalid] }, registry: functions }).ok).toBe(false);
});
