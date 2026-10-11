import { describe, expect, it } from 'vitest';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import type { Catalog, MeaningDefinition } from '@varendo/core';
import {
  createMeaningAuthoring,
  createMeaningEvaluator,
  createMeaningRegistry,
} from '../../packages/runtime/src/meaning/index.js';
import {
  createAgentMeaningAuthoring,
  createMeaningProposalCapability,
} from '../../packages/agent/src/meaning/index.js';

const registryResult = createStandardFunctionRegistry('meaning-test-functions');
if (!registryResult.ok) throw new Error('Registry fixture failed.');
const registry = registryResult.value;
const catalog = {
  version: '1',
  revision: 'meaning-test-catalog',
  functionRegistryDigest: registry.digest,
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

const source = {
  revision: 'meaning-test-source',
  catalogRevision: catalog.revision,
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  relations: {
    items: {
      entity: 'items',
      complete: true,
      rows: [
        { id: 'a', amount: 2 },
        { id: 'b', amount: 3 },
      ],
    },
  },
};

function manualMeaning(): MeaningDefinition {
  const authoring = createMeaningAuthoring({ catalog, registry });
  expect(authoring.ok).toBe(true);
  if (!authoring.ok) throw new Error('authoring setup failed');
  const field = authoring.value.field('items', 'amount');
  expect(field.ok).toBe(true);
  if (!field.ok) throw new Error('field setup failed');
  const expression = authoring.value.call({ id: 'core.aggregate.sum', revision: '1' }, [field]);
  expect(expression.ok).toBe(true);
  if (!expression.ok) throw new Error('expression setup failed');
  const draft = authoring.value.defineMeaning({
    id: 'items.total',
    label: 'Total',
    description: 'Total amount',
    expression,
  });
  expect(draft.ok).toBe(true);
  if (!draft.ok) throw new Error('meaning setup failed');
  return draft.value.meaning;
}

describe('canonical manual and AI meaning authoring', () => {
  it('uses one typed evaluator and preserves AI provenance', () => {
    const manual = manualMeaning();
    const aiMeaning: MeaningDefinition = {
      ...manual,
      id: 'items.total.ai',
      origin: 'ai-assisted',
      scope: 'session',
      authority: 'hypothesis',
      lifecycle: 'draft',
    };
    const ai = createAgentMeaningAuthoring({ catalog, registry });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    const proposal = ai.value.propose({ meaning: aiMeaning, assumptions: ['Source rows are complete.'] });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.meaning.origin).toBe('ai-assisted');
    expect(proposal.value.source.ownership).toBe('session');
    expect(proposal.value.meaning.implementation).toEqual(manual.implementation);
    const evaluator = createMeaningEvaluator({ catalog, registry });
    expect(evaluator.ok).toBe(true);
    if (!evaluator.ok) return;
    const result = evaluator.value.evaluate({
      meaning: manual,
      entity: 'items',
      source,
      scopeDigest: 'scope-1',
      policyRevision: 'policy-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows).toEqual([{ 'items.total': 5 }]);
  });

  it('rejects shared AI hypotheses and keeps code definitions read-only', () => {
    const manual = manualMeaning();
    const ai = createAgentMeaningAuthoring({ catalog, registry });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    const shared = ai.value.propose({
      meaning: { ...manual, origin: 'ai-assisted', scope: 'workspace', authority: 'hypothesis', lifecycle: 'draft' },
    });
    expect(shared.ok).toBe(false);
    const authoring = createMeaningAuthoring({
      catalog,
      registry,
      source: { surface: 'code', ownership: 'code', readOnly: true },
    });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;
    const edit = authoring.value.edit(
      {
        version: '1',
        meaning: manual,
        source: { surface: 'code', ownership: 'code', readOnly: true },
        digest: 'x',
        assumptions: [],
      },
      { ...manual, label: 'Changed' },
    );
    expect(edit.ok).toBe(false);
    const diff = authoring.value.proposeDiff(
      {
        version: '1',
        meaning: manual,
        source: { surface: 'code', ownership: 'code', readOnly: true },
        digest: 'x',
        assumptions: [],
      },
      { ...manual, id: manual.id, revision: '2', label: 'Changed' },
    );
    expect(diff.ok).toBe(true);
  });

  it('registers immutable drafts idempotently and rejects conflicting contents', () => {
    const meaning = {
      ...manualMeaning(),
      lifecycle: 'active' as const,
      authority: 'reviewed' as const,
      scope: 'workspace' as const,
    };
    const authoring = createMeaningAuthoring({ catalog, registry });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;
    const draft = authoring.value.draft(meaning, { source: { surface: 'code', ownership: 'code', readOnly: true } });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const registered = createMeaningRegistry({ catalog, registry });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.value.register({ draft: draft.value }).ok).toBe(true);
    const second = registered.value.register({ draft: draft.value });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.idempotent).toBe(true);
    const conflict = registered.value.register({
      draft: { ...draft.value, meaning: { ...draft.value.meaning, label: 'Conflict' } },
    });
    expect(conflict.ok).toBe(false);
  });

  it('exposes proposal capability without a model or activation side effect', () => {
    const ai = createAgentMeaningAuthoring({ catalog, registry });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    const capability = createMeaningProposalCapability({ authoring: ai.value });
    const parsed = capability.parse({ meaning: { ...manualMeaning(), origin: 'manual' } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = capability.invoke(parsed.value, {
      requestId: 'r',
      targetRegionId: 'region',
      goalEpoch: 'epoch',
      transport: 'direct',
      signal: new AbortController().signal,
      authority: { principalKey: 'p', regionId: 'region', goalEpoch: 'epoch', grants: ['meaning.propose'] },
    });
    expect(result).toMatchObject({ state: 'invalid' });
  });
});
