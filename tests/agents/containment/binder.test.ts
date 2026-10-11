import { describe, expect, it } from 'vitest';
import {
  type Catalog,
  type CommitPreconditions,
  type MeaningDefinition,
  type QuerySpec,
  type Task,
} from '../../../packages/core/src/index.js';
import { createQueryFunctionRegistry } from '../../../packages/core/src/expressions/index.js';
import { createAgentBinder } from '../../../packages/agent/src/binder.js';
import { containAgentProposal } from '../../../packages/agent/src/loop.js';
import type { AgentHostContext } from '../../../packages/agent/src/binder-types.js';

const registryOutcome = createQueryFunctionRegistry({ version: '2' });
if (!registryOutcome.ok) throw new Error(JSON.stringify(registryOutcome.diagnostics));
const registry = registryOutcome.value;

const field = (id: string, value: 'text' | 'integer' = 'text', unit?: { dimension: string; symbol: string }) => ({
  id,
  label: id,
  type: { value, nullable: false, ...(unit === undefined ? {} : { unit }) },
  role: id === 'id' ? ('identity' as const) : ('measure' as const),
});

const catalog: Catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: registry.digest,
  entities: [
    {
      id: 'events',
      label: 'Events',
      identity: ['id'],
      rowGrain: ['id'],
      fields: [field('id'), field('score', 'integer')],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

const current: CommitPreconditions = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: 'task-1',
  regionRevision: 'region-1',
  catalogRevision: catalog.revision,
  experienceRevision: 'experience-1',
  functionRegistryDigest: registry.digest,
  results: [],
};

const query = (overrides: Partial<QuerySpec> = {}): QuerySpec => ({
  entity: 'events',
  fields: ['id'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'all-authorized' },
  order: [],
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    version: '1',
    id: 'task-1',
    revision: 'task-1',
    catalogRevision: catalog.revision,
    functionRegistryDigest: registry.digest,
    regionId: 'region-1',
    goal: 'Inspect events',
    needs: [],
    assumptions: [],
    kind: 'data',
    outputs: [{ id: 'main', kind: 'query', query: query(), dependsOn: [], delivery: 'eager' }],
    ...overrides,
  }) as Task;

const proposal = (
  value: Task,
  preconditions: CommitPreconditions = current,
  overrides: Record<string, unknown> = {},
): unknown => ({
  requestId: 'request-1',
  targetRegionId: 'region-1',
  effect: 'read',
  preconditions,
  value,
  ...overrides,
});

type BinderOptions = Parameters<typeof createAgentBinder>[0];
type BinderOverrides = {
  readonly catalog?: Catalog;
  readonly current?: CommitPreconditions;
  readonly grants?: readonly string[];
  readonly goalEpoch?: string;
  readonly decisions?: readonly unknown[];
  readonly functionRegistry?: typeof registry;
  readonly principalKey?: string;
  readonly regionId?: string;
};

function binder(overrides: BinderOverrides = {}, onRead?: (context: unknown) => void) {
  const catalogValue = overrides.catalog ?? catalog;
  const registryValue = overrides.functionRegistry ?? registry;
  const currentValue = overrides.current ?? {
    ...current,
    catalogRevision: catalogValue.revision,
    functionRegistryDigest: registryValue.digest,
  };
  const context = {
    principalKey: overrides.principalKey ?? 'principal-1',
    regionId: overrides.regionId ?? 'region-1',
    goalEpoch: overrides.goalEpoch ?? 'epoch-1',
    current: currentValue,
    catalog: catalogValue,
    functionRegistry: registryValue,
    grants: overrides.grants ?? ['catalog.read', 'task.propose'],
    ...(overrides.decisions === undefined ? {} : { decisions: overrides.decisions }),
  };
  return createAgentBinder({
    host: {
      readContext: async () => {
        onRead?.(context);
        return { ok: true, value: context as unknown as AgentHostContext };
      },
    },
  } as unknown as BinderOptions);
}

function outcomeState(result: Awaited<ReturnType<ReturnType<typeof binder>['bind']>>) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

type MeaningExpression = Extract<MeaningDefinition['implementation'], { kind: 'expression' }>['expression'];
function meaning(id: string, expression: MeaningExpression): MeaningDefinition {
  return {
    id,
    revision: '1',
    label: id,
    explanation: `Meaning ${id}`,
    output: { value: 'integer', nullable: true },
    implementation: { kind: 'expression', expression },
    dependencies: [],
    functionRegistryDigest: registry.digest,
    origin: 'manual',
    lifecycle: 'active',
    scope: 'workspace',
    authority: 'approved',
    aggregation: 'additive',
    aggregationDimensions: [],
    missingPolicy: 'propagate',
  };
}

const net = meaning('metric.net', {
  kind: 'call',
  function: { id: 'core.subtract', revision: '1' },
  arguments: [
    {
      kind: 'call',
      function: { id: 'core.aggregate.sum', revision: '1' },
      arguments: [{ kind: 'field', entity: 'events', ref: 'score' }],
    },
    { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } },
  ],
});
const gross = meaning('metric.gross', {
  kind: 'call',
  function: { id: 'core.aggregate.sum', revision: '1' },
  arguments: [{ kind: 'field', entity: 'events', ref: 'score' }],
});
const meaningCatalog: Catalog = { ...catalog, revision: 'catalog-meanings-1', meanings: [net, gross] };

describe('production agent binder', () => {
  it('binds a valid query while preserving valid-but-wrong meaning as residual risk', async () => {
    const actual = binder({ catalog: meaningCatalog });
    const wrongMeaningTask = task({
      catalogRevision: meaningCatalog.revision,
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: query({ fields: [], measures: [{ id: gross.id, revision: gross.revision }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const accepted = await actual.bind(
      proposal(wrongMeaningTask, { ...current, catalogRevision: meaningCatalog.revision }),
    );
    const value = outcomeState(accepted);
    expect(value.state).toBe('bound');
    if (value.state === 'bound') expect(value.assumptions.join(' ')).toContain('residual');
  });

  it('returns invalid for malformed, unknown-field, and unit-incompatible query plans', async () => {
    const malformed = outcomeState(await binder().bind({ bad: true }));
    expect(malformed.state).toBe('invalid');

    const unknownFieldTask = task({
      outputs: [{ id: 'main', kind: 'query', query: query({ fields: ['missing'] }), dependsOn: [], delivery: 'eager' }],
    });
    const unknownField = outcomeState(await binder().bind(proposal(unknownFieldTask)));
    expect(unknownField.state).toBe('invalid');

    const unitCatalog: Catalog = {
      ...catalog,
      revision: 'catalog-units-1',
      entities: [
        {
          id: 'left',
          label: 'Left',
          identity: ['id'],
          rowGrain: ['id'],
          fields: [field('id', 'integer', { dimension: 'time', symbol: 's' })],
        },
        {
          id: 'right',
          label: 'Right',
          identity: ['rid'],
          rowGrain: ['rid'],
          fields: [field('rid', 'integer', { dimension: 'length', symbol: 'm' })],
        },
      ],
      relationships: [
        {
          id: 'left-right',
          revision: '1',
          sourceEntity: 'left',
          targetEntity: 'right',
          keys: [{ sourceField: 'id', targetField: 'rid' }],
          cardinality: 'many-to-one',
          optional: true,
          joinPolicy: 'validated',
        },
      ],
    };
    const unitTask = task({
      catalogRevision: unitCatalog.revision,
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: {
            ...query(),
            entity: 'left',
            relations: [{ id: 'left-right', revision: '1' }],
            relationUsage: [{ relation: { id: 'left-right', revision: '1' }, kind: 'inner' }],
          },
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const unit = outcomeState(
      await binder({ catalog: unitCatalog }).bind(
        proposal(unitTask, { ...current, catalogRevision: unitCatalog.revision }),
      ),
    );
    expect(unit.state).toBe('invalid');
  });

  it('distinguishes needs-meaning and needs-choice from planner diagnostics', async () => {
    const missing = task({
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: query({ measures: [{ id: 'metric.missing', revision: '1' }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const baseline = outcomeState(await binder().bind(proposal(missing)));
    expect(baseline.state).toBe('unsupported');
    if (baseline.state !== 'unsupported') return;
    const code = baseline.diagnostics[0]?.code;
    if (code === undefined) throw new Error('missing planner diagnostic');
    const diagnosticPath = baseline.diagnostics[0]?.path;
    const needsMeaning = outcomeState(
      await binder({
        decisions: [
          {
            state: 'needs-meaning',
            scope: 'diagnostic',
            goalEpoch: 'epoch-1',
            diagnosticCode: code,
            ...(diagnosticPath === undefined ? {} : { diagnosticPath }),
            concept: 'metric.missing',
            authoringRoutes: ['manual', 'ai-assisted'],
          },
        ],
      }).bind(proposal(missing)),
    );
    expect(needsMeaning.state).toBe('needs-meaning');
    const needsChoice = outcomeState(
      await binder({
        decisions: [
          {
            state: 'needs-choice',
            scope: 'diagnostic',
            goalEpoch: 'epoch-1',
            diagnosticCode: code,
            ...(diagnosticPath === undefined ? {} : { diagnosticPath }),
            choices: [
              { id: 'metric.net', label: 'Net', consequence: 'Uses reviewed net metric.' },
              { id: 'metric.gross', label: 'Gross', consequence: 'Uses reviewed gross metric.' },
            ],
          },
        ],
      }).bind(proposal(missing)),
    );
    expect(needsChoice.state).toBe('needs-choice');

    const resolved = task({
      catalogRevision: meaningCatalog.revision,
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: query({ fields: [], measures: [{ id: gross.id, revision: gross.revision }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const resolvedOutcome = outcomeState(
      await binder({ catalog: meaningCatalog }).bind(
        proposal(resolved, { ...current, catalogRevision: meaningCatalog.revision }),
      ),
    );
    expect(resolvedOutcome.state).toBe('bound');
  });

  it('enforces independent grants, read sets, goal epochs, and source revisions', async () => {
    const noCatalogGrant = outcomeState(await binder({ grants: ['task.propose'] }).bind(proposal(task())));
    expect(noCatalogGrant.state).toBe('denied');
    const ref = {
      id: 'result-1',
      revision: 'source-1',
      outputId: 'source',
      queryDigest: 'query-1',
      scopeDigest: 'scope-1',
    } as const;
    const reuse = task({ outputs: [{ id: 'source', kind: 'reuse', result: ref, dependsOn: [] }] });
    const reuseCurrent = { ...current, results: [ref] };
    const missingInspect = outcomeState(await binder({ current: reuseCurrent }).bind(proposal(reuse, reuseCurrent)));
    expect(missingInspect.state).toBe('denied');
    const allowed = outcomeState(
      await binder({ current: reuseCurrent, grants: ['catalog.read', 'task.propose', 'result.inspect'] }).bind(
        proposal(reuse, reuseCurrent),
      ),
    );
    expect(allowed.state).toBe('bound');
    const staleEpoch = outcomeState(
      await binder({ goalEpoch: 'new-epoch' }).bind(proposal(task(), current), { goalEpoch: 'epoch-1' }),
    );
    expect(staleEpoch.state).toBe('stale');
    const staleRead = outcomeState(
      await binder({ grants: ['catalog.read', 'task.propose', 'result.inspect'] }).bind(proposal(reuse, current)),
    );
    expect(staleRead.state).toBe('stale');
    const changedRef = { ...ref, revision: 'source-2' };
    const changedCurrent = { ...current, results: [changedRef] };
    const refreshed = outcomeState(
      await binder({ current: changedCurrent, grants: ['catalog.read', 'task.propose', 'result.inspect'] }).bind(
        proposal(
          task({ outputs: [{ id: 'source', kind: 'reuse', result: changedRef, dependsOn: [] }] }),
          changedCurrent,
        ),
      ),
    );
    expect(refreshed.state).toBe('bound');
  });

  it('requires the task revision and a stable host authority across inspection', async () => {
    const staleTask = task({ revision: 'task-old' });
    const staleTaskResult = outcomeState(await binder().bind(proposal(staleTask)));
    expect(staleTaskResult.state).toBe('stale');

    let reads = 0;
    const changing = binder({}, (value) => {
      reads++;
      if (reads === 2) {
        const context = value as { grants: string[] };
        context.grants = ['catalog.read'];
      }
    });
    const changed = outcomeState(await changing.bind(proposal(task())));
    expect(changed.state).toBe('stale');
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('keeps host decisions scoped to the current goal epoch', async () => {
    const missing = task({
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: query({ measures: [{ id: 'metric.missing', revision: '1' }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const staleDecision = outcomeState(
      await binder({
        decisions: [
          {
            state: 'needs-meaning',
            scope: 'diagnostic',
            goalEpoch: 'old-epoch',
            diagnosticCode: 'query.meaning',
            concept: 'metric.missing',
            authoringRoutes: ['manual'],
          },
        ],
      }).bind(proposal(missing)),
    );
    expect(staleDecision.state).toBe('stale');
  });

  it('does not apply a diagnostic decision to an unrelated valid task', async () => {
    const meaningCurrent = { ...current, catalogRevision: meaningCatalog.revision };
    const validTask = task({
      catalogRevision: meaningCatalog.revision,
      outputs: [
        {
          id: 'main',
          kind: 'query',
          query: query({ fields: [], measures: [{ id: gross.id, revision: gross.revision }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const diagnosticDecision = {
      state: 'needs-meaning' as const,
      scope: 'diagnostic' as const,
      goalEpoch: 'epoch-1',
      diagnosticCode: 'query.meaning',
      concept: 'metric.missing',
      authoringRoutes: ['manual'] as const,
    };
    const guarded = binder({ catalog: meaningCatalog, current: meaningCurrent, decisions: [diagnosticDecision] });
    expect(outcomeState(await guarded.bind(proposal(validTask, meaningCurrent))).state).toBe('bound');
  });

  it('applies a current goal ambiguity after a valid bind and releases it when resolved', async () => {
    const meaningCurrent = { ...current, catalogRevision: meaningCatalog.revision };
    const validTask = task({
      id: 'task-original',
      catalogRevision: meaningCatalog.revision,
      outputs: [
        {
          id: 'gross',
          kind: 'query',
          query: query({ fields: [], measures: [{ id: gross.id, revision: gross.revision }] }),
          dependsOn: [],
          delivery: 'eager',
        },
        {
          id: 'net',
          kind: 'query',
          query: query({ fields: [], measures: [{ id: net.id, revision: net.revision }] }),
          dependsOn: [],
          delivery: 'eager',
        },
      ],
    });
    const decision = {
      state: 'needs-choice' as const,
      scope: 'goal' as const,
      goalEpoch: 'epoch-1',
      diagnosticCode: 'agent.material-ambiguity',
      choices: [
        { id: 'gross', label: 'Gross', consequence: 'Use the gross definition.' },
        { id: 'net', label: 'Net', consequence: 'Use the net definition.' },
      ],
    };
    const guarded = binder({ catalog: meaningCatalog, current: meaningCurrent, decisions: [decision] });
    expect(outcomeState(await guarded.bind(proposal(validTask, meaningCurrent))).state).toBe('needs-choice');
    const renamed = { ...validTask, id: 'task-renamed' };
    expect(outcomeState(await guarded.bind(proposal(renamed, meaningCurrent))).state).toBe('needs-choice');

    const resolved = binder({ catalog: meaningCatalog, current: meaningCurrent });
    expect(outcomeState(await resolved.bind(proposal(validTask, meaningCurrent))).state).toBe('bound');
  });

  it('releases cancelled host reads so a later healthy bind is admitted', async () => {
    let healthy = false;
    const context = {
      principalKey: 'principal-1',
      regionId: 'region-1',
      goalEpoch: 'epoch-1',
      current,
      catalog,
      functionRegistry: registry,
      grants: ['catalog.read', 'task.propose'],
    };
    const actual = createAgentBinder({
      maxPending: 8,
      host: {
        readContext: async () => (healthy ? { ok: true, value: context } : new Promise<never>(() => {})),
      },
    } as unknown as BinderOptions);
    const input = proposal(task());
    for (let index = 0; index < 8; index++) {
      const controller = new AbortController();
      const pending = actual.bind(input, { signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      const cancelled = await pending;
      expect(cancelled.ok && cancelled.value.state).toBe('invalid');
    }
    healthy = true;
    const recovered = outcomeState(await actual.bind(input));
    expect(recovered.state).toBe('bound');
  });

  it('owns source-scoped fingerprints and ignores proposal envelope key order', async () => {
    const actual = binder();
    const first = proposal(task());
    const reordered = JSON.stringify({
      value: task(),
      preconditions: current,
      effect: 'read',
      targetRegionId: 'region-1',
      requestId: 'different-request',
    });
    const a = await actual.fingerprint(first);
    const b = await actual.fingerprint(reordered);
    expect(a.ok && b.ok && a.value === b.value).toBe(true);

    const ref = {
      id: 'result-1',
      revision: 'source-1',
      outputId: 'source',
      queryDigest: 'query-1',
      scopeDigest: 'scope-1',
    } as const;
    const firstTask = task({ outputs: [{ id: 'source', kind: 'reuse', result: ref, dependsOn: [] }] });
    const firstCurrent = { ...current, results: [ref] };
    const nextRef = { ...ref, revision: 'source-2' };
    const nextTask = task({ outputs: [{ id: 'source', kind: 'reuse', result: nextRef, dependsOn: [] }] });
    const nextCurrent = { ...current, results: [nextRef] };
    const sourceA = await actual.fingerprint(proposal(firstTask, firstCurrent));
    const sourceB = await actual.fingerprint(proposal(nextTask, nextCurrent));
    expect(sourceA.ok && sourceB.ok && sourceA.value !== sourceB.value).toBe(true);
  });

  it('integrates the actual binder with bounded repair and performs no data or action effect', async () => {
    let reads = 0;
    let executions = 0;
    const actual = binder({}, () => {
      reads++;
    });
    const invalid = proposal(
      task({
        outputs: [
          { id: 'main', kind: 'query', query: query({ fields: ['unknown'] }), dependsOn: [], delivery: 'eager' },
        ],
      }),
    );
    const valid = proposal(task());
    const result = await containAgentProposal({
      requestId: 'request-1',
      targetRegionId: 'region-1',
      goalEpoch: 'epoch-1',
      budget: { maxTurns: 3, maxRepairs: 2, maxMilliseconds: 1000, maxProposalBytes: 4096 },
      initial: invalid,
      propose: async () => valid,
      binder: actual,
    });
    expect(result.ok && result.value.stop).toBe('complete');
    expect(reads).toBeGreaterThan(0);
    expect(executions).toBe(0);
  });

  it('stops actual binder host hangs on deadline and cancellation', async () => {
    const hanging = createAgentBinder({
      host: { readContext: async () => new Promise<never>(() => {}) },
    } as unknown as BinderOptions);
    const input = proposal(task());
    const deadline = await containAgentProposal({
      requestId: 'request-1',
      targetRegionId: 'region-1',
      goalEpoch: 'epoch-1',
      budget: { maxTurns: 1, maxRepairs: 0, maxMilliseconds: 10, maxProposalBytes: 4096 },
      initial: input,
      propose: async () => input,
      binder: hanging,
    });
    expect(deadline.ok && deadline.value.stop).toBe('time-budget');
    const controller = new AbortController();
    const cancellation = containAgentProposal({
      requestId: 'request-1',
      targetRegionId: 'region-1',
      goalEpoch: 'epoch-1',
      budget: { maxTurns: 1, maxRepairs: 0, maxMilliseconds: 1000, maxProposalBytes: 4096 },
      initial: input,
      signal: controller.signal,
      propose: async () => input,
      binder: hanging,
    });
    setTimeout(() => controller.abort(), 10);
    const cancelled = await cancellation;
    expect(cancelled.ok && cancelled.value.stop).toBe('cancelled');
  });
});
