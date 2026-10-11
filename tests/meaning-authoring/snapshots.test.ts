import { describe, expect, it } from 'vitest';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import type { Catalog, MeaningDefinition } from '../../packages/core/src/contracts/index.js';
import type { FunctionRegistry } from '../../packages/core/src/expressions/index.js';
import type { QuerySource } from '../../packages/core/src/query/types.js';
import type { SemanticPolicy } from '../../packages/core/src/semantics/index.js';
import { createMeaningAuthoring, createMeaningEvaluator } from '../../packages/runtime/src/meaning/index.js';
import { createAgentMeaningAuthoring } from '../../packages/agent/src/meaning/index.js';

const registryDigest = 'meaning-snapshot-functions';

function mutableRegistry(): FunctionRegistry {
  const base = createStandardFunctionRegistry(registryDigest);
  expect(base.ok).toBe(true);
  if (!base.ok) throw new Error('registry setup failed');
  const signatures = JSON.parse(JSON.stringify(base.value.signatures)) as FunctionRegistry['signatures'];
  return {
    digest: base.value.digest,
    signatures,
    resolve(ref) {
      return signatures.find((signature) => signature.ref.id === ref.id && signature.ref.revision === ref.revision);
    },
  };
}

function mutableCatalog(): Catalog {
  return {
    version: '1',
    revision: 'meaning-snapshot-catalog',
    functionRegistryDigest: registryDigest,
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
  };
}

function meaningFrom(catalog: Catalog, registry: FunctionRegistry, id = 'items.total'): MeaningDefinition {
  const authoring = createMeaningAuthoring({ catalog, registry });
  expect(authoring.ok).toBe(true);
  if (!authoring.ok) throw new Error('authoring setup failed');
  const field = (authoring.value as any).field('items', 'amount');
  expect(field.ok).toBe(true);
  if (!field.ok) throw new Error('field setup failed');
  const expression = authoring.value.call({ id: 'core.aggregate.sum', revision: '1' }, [field]);
  expect(expression.ok).toBe(true);
  if (!expression.ok) throw new Error('expression setup failed');
  const draft = authoring.value.defineMeaning({ id, label: 'Total', description: 'Total amount', expression });
  expect(draft.ok).toBe(true);
  if (!draft.ok) throw new Error('meaning setup failed');
  return draft.value.meaning as unknown as MeaningDefinition;
}

function source(catalog: Catalog, catalogRevision = catalog.revision): QuerySource {
  return {
    revision: 'meaning-snapshot-source',
    catalogRevision,
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
}

describe('meaning authoring option snapshots', () => {
  it('retains catalog, registry, definitions, policy, source and assumptions from construction time', () => {
    const catalog = mutableCatalog();
    const registry = mutableRegistry();
    const definitions: MeaningDefinition[] = [];
    const policy: SemanticPolicy = { allowedScopes: ['session'] };
    const sourceOption: { surface: 'code'; ownership: MeaningDefinition['scope']; ownerId: string } = {
      surface: 'code',
      ownership: 'session',
      ownerId: 'owner-1',
    };
    const assumptions = ['rows are complete'];
    const authoring = createMeaningAuthoring({
      catalog,
      registry,
      definitions,
      policy,
      source: sourceOption,
      assumptions,
    });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;

    (catalog as any).revision = 'mutated-catalog';
    (catalog as any).functionRegistryDigest = 'mutated-registry';
    (registry as any).digest = 'mutated-registry';
    const sum = registry.signatures.find((signature) => signature.ref.id === 'core.aggregate.sum');
    if (sum !== undefined) (sum.ref as any).id = 'mutated-function';
    definitions.push({ ...meaningFrom(mutableCatalog(), mutableRegistry(), 'items.other') });
    (policy.allowedScopes as unknown as MeaningDefinition['scope'][]).splice(0, 1, 'organization');
    sourceOption.ownership = 'organization';
    sourceOption.ownerId = 'mutated-owner';
    assumptions[0] = 'mutated assumption';

    const meaning = meaningFrom(mutableCatalog(), mutableRegistry());
    const draft = authoring.value.draft(meaning);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.source).toEqual({ surface: 'code', ownership: 'session', ownerId: 'owner-1' });
    expect(draft.value.assumptions).toEqual(['rows are complete']);
  });

  it('keeps evaluator planning and resolution pinned after caller mutation', () => {
    const catalog = mutableCatalog();
    const registry = mutableRegistry();
    const meaning = meaningFrom(catalog, registry);
    const definitions = [meaning];
    const policy: SemanticPolicy = { allowedScopes: ['session'] };
    const evaluator = createMeaningEvaluator({ catalog, registry, definitions, policy, limits: { maxRows: 10 } });
    expect(evaluator.ok).toBe(true);
    if (!evaluator.ok) return;

    (catalog as any).revision = 'mutated-catalog';
    (catalog as any).functionRegistryDigest = 'mutated-registry';
    (registry as any).digest = 'mutated-registry';
    definitions[0] = { ...meaning, label: 'mutated', functionRegistryDigest: 'mutated-registry' };
    (policy.allowedScopes as unknown as MeaningDefinition['scope'][]).splice(0, 1, 'organization');

    const result = evaluator.value.evaluate({
      meaning: { id: meaning.id, revision: meaning.revision },
      entity: 'items',
      source: source(catalog, 'meaning-snapshot-catalog'),
      scopeDigest: 'scope-1',
      policyRevision: 'policy-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows).toEqual([{ 'items.total': 5 }]);
    expect(() => evaluator.value.evaluate({} as never)).not.toThrow();
  });

  it('retains the AI proposal policy snapshot and evaluator snapshot', () => {
    const catalog = mutableCatalog();
    const registry = mutableRegistry();
    const meaning = meaningFrom(catalog, registry, 'items.ai-total');
    const proposalPolicy = {
      allowedScopes: ['session'] as MeaningDefinition['scope'][],
      requireHypothesis: true,
      requireDraft: true,
    };
    const evaluatorOptions = { catalog, registry, definitions: [meaning] };
    const agent = createAgentMeaningAuthoring({ catalog, registry, proposalPolicy, evaluator: evaluatorOptions });
    expect(agent.ok).toBe(true);
    if (!agent.ok) return;

    proposalPolicy.allowedScopes.splice(0, 1, 'organization');
    (catalog as any).revision = 'mutated-catalog';
    (registry as any).digest = 'mutated-registry';
    (evaluatorOptions.definitions as MeaningDefinition[])[0] = {
      ...meaning,
      functionRegistryDigest: 'mutated-registry',
    };

    const proposal = agent.value.propose({
      meaning: { ...meaning, origin: 'ai-assisted', scope: 'session', authority: 'hypothesis', lifecycle: 'draft' },
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.source.ownership).toBe('session');
    expect(
      agent.value.evaluator?.evaluate({
        meaning: { id: meaning.id, revision: meaning.revision },
        entity: 'items',
        source: source(catalog, 'meaning-snapshot-catalog'),
      }).ok,
    ).toBe(true);
  });

  it('allows a developer-owned code source to preserve AI-assisted origin', () => {
    const catalog = mutableCatalog();
    const registry = mutableRegistry();
    const meaning = meaningFrom(catalog, registry, 'items.ai-code-total');
    const aiMeaning = { ...meaning, origin: 'ai-assisted' as const };
    const authoring = createMeaningAuthoring({ catalog, registry });
    expect(authoring.ok).toBe(true);
    if (!authoring.ok) return;
    const draft = authoring.value.draft(aiMeaning, { source: { surface: 'code', ownership: 'code', readOnly: true } });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.value.meaning.origin).toBe('ai-assisted');
      expect(draft.value.source).toEqual({ surface: 'code', ownership: 'code', readOnly: true });
    }
  });
});
