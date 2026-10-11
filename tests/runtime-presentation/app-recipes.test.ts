import { describe, expect, it } from 'vitest';
import { defineResource, type Intent, type Result, type Task } from '../../packages/core/src/index.js';
import {
  resolvePresentation,
  validatePresentationPlan,
  type PresentationContext,
  type PresentationEnvironment,
  type ValidatedPresentation,
} from '../../packages/core/src/presentation/index.js';
import type {
  AeliqoRuntime,
  RuntimeCommittedReceipt,
  RuntimePresentationInput,
} from '../../packages/runtime/src/app/index.js';
import { html } from 'lit';
import * as z from 'zod';
import {
  defineRecipe,
  defineView,
  recipeSupports,
  standardDataRecipe,
  standardFormRecipe,
} from '../../packages/web/src/recipes/index.js';
import { resolverCandidateId } from '../../packages/web/src/recipes/candidate-id.js';
import { standardRecipeCandidates } from '../../packages/web/src/recipes/standard.js';
import {
  experience,
  presentationPolicy,
  registryFor,
  type WebAppContext,
  type WebRegion,
} from '../../packages/web/src/app/context.js';
import { createFormBindings } from '../../packages/web/src/app/form-bindings.js';
import { present } from '../../packages/web/src/app/presentation.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { createRegistrationDocument } from './registration-document.js';

const current = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: '1',
  regionRevision: 'region-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-1',
  functionRegistryDigest: 'core-query-2',
  results: [{ id: 'result-1', revision: '1', outputId: 'primary', queryDigest: 'query-1', scopeDigest: 'scope-1' }],
} as const;

const result: Result = {
  version: '1',
  ref: { id: 'result-1', revision: '1', outputId: 'primary', queryDigest: 'query-1', scopeDigest: 'scope-1' },
  taskId: 'browse-1',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'population-1' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'population-1' },
  consistency: { kind: 'snapshot', snapshotId: 'snapshot-1', sourceRevisions: { people: '1' } },
  evidence: { kind: 'observed', source: { id: 'people', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};

function environment(width: number): PresentationEnvironment {
  return {
    inlineSize: { state: 'known', value: width },
    blockSize: { state: 'known', value: 600 },
    textScale: { state: 'known', value: 1 },
    pointer: 'fine',
    hover: 'available',
    keyboard: 'available',
    locale: 'en-US',
    direction: 'ltr',
    reducedMotion: false,
    forcedColors: false,
  };
}

function input(kind: 'browse' | 'compare', width: number, preferredView?: string) {
  const intent: Intent =
    kind === 'browse'
      ? {
          version: '1',
          id: 'browse-1',
          kind,
          resource: 'people',
          ...(preferredView === undefined ? {} : { preferredView }),
        }
      : {
          version: '1',
          id: 'browse-1',
          kind,
          resource: 'people',
          identities: [{ id: 'p-1' }, { id: 'p-2' }],
          ...(preferredView === undefined ? {} : { preferredView }),
        };
  const task = {
    version: '1',
    id: 'browse-1',
    revision: '1',
    catalogRevision: 'catalog-1',
    functionRegistryDigest: 'core-query-2',
    regionId: 'main',
    kind: 'data',
    goal: 'Browse people',
    assumptions: [],
    outputs: [
      {
        id: 'primary',
        kind: 'query',
        query: {
          entity: 'people',
          fields: ['id', 'name'],
          measures: [],
          relations: [],
          groupBy: [],
          population: { kind: 'all-authorized' },
          order: [],
        },
        dependsOn: [],
        delivery: 'eager',
      },
    ],
    needs: [
      {
        id: kind,
        operation: { id: kind === 'compare' ? 'data.compare' : 'data.read', revision: '1' },
        outputId: 'primary',
        fields: ['id', 'name'],
        required: true,
      },
    ],
    ...(preferredView === undefined
      ? {}
      : { viewPreference: { representation: preferredView, strength: 'preferred' } }),
  } satisfies Task;
  return {
    intent,
    task,
    result: { ...result, taskId: task.id },
    current,
    environment: environment(width),
    availableViews: [],
  };
}

function trendInput(requestedMeasures: readonly [string, ...string[]]) {
  const measures: Extract<Intent, { readonly kind: 'analyze' }>['measures'] = [
    { id: requestedMeasures[0], revision: '1' },
    ...requestedMeasures.slice(1).map((id) => ({ id, revision: '1' })),
  ];
  const intent: Intent = {
    version: '1',
    id: 'headcount-trend',
    kind: 'analyze',
    resource: 'people',
    measures,
    time: { field: 'week', grain: 'week' },
    preferredView: 'trend',
  };
  const task: Task = {
    version: '1',
    id: intent.id,
    revision: '1',
    catalogRevision: 'catalog-1',
    functionRegistryDigest: 'core-query-2',
    regionId: 'main',
    kind: 'data',
    goal: 'Show weekly headcount',
    assumptions: [],
    outputs: [
      {
        id: 'primary',
        kind: 'query',
        query: {
          entity: 'people',
          fields: ['week'],
          measures,
          relations: [],
          groupBy: ['week'],
          population: { kind: 'all-authorized' },
          order: [],
        },
        dependsOn: [],
        delivery: 'eager',
      },
    ],
    needs: [
      {
        id: 'analyze',
        operation: { id: 'data.analyze', revision: '1' },
        outputId: 'primary',
        fields: ['week', ...requestedMeasures],
        required: true,
      },
    ],
    viewPreference: { representation: 'trend', strength: 'preferred' },
  };
  const trendResult: Result = {
    ...result,
    ref: { ...result.ref, id: 'trend-result' },
    taskId: task.id,
    fields: [
      { id: 'employeeNumber', label: 'Employee number', type: { value: 'integer', nullable: false }, role: 'identity' },
      { id: 'week', label: 'Week', type: { value: 'date', nullable: false }, role: 'time' },
      { id: 'headcount', label: 'Headcount', type: { value: 'integer', nullable: false }, role: 'measure' },
      { id: 'capacity', label: 'Capacity', type: { value: 'decimal', nullable: false }, role: 'measure' },
    ],
    identity: ['employeeNumber'],
    rowGrain: ['week'],
  };
  return {
    intent,
    task,
    result: trendResult,
    current: { ...current, results: [trendResult.ref] },
    environment: environment(800),
    availableViews: [],
  };
}

function barInput(width = 800, preferredView = 'bar') {
  const intent: Intent = {
    version: '1',
    id: 'category-analysis',
    kind: 'analyze',
    resource: 'people',
    dimensions: ['category'],
    measures: [{ id: 'amount', revision: '1' }],
    ...(preferredView === undefined ? {} : { preferredView }),
  };
  const task = {
    version: '1',
    id: intent.id,
    revision: '1',
    catalogRevision: 'catalog-1',
    functionRegistryDigest: 'core-query-2',
    regionId: 'main',
    kind: 'data',
    goal: 'Show amounts by category',
    assumptions: [],
    outputs: [
      {
        id: 'primary',
        kind: 'query',
        query: {
          entity: 'people',
          fields: ['category'],
          measures: [{ id: 'amount', revision: '1' }],
          relations: [],
          groupBy: ['category'],
          population: { kind: 'all-authorized' },
          order: [],
        },
        dependsOn: [],
        delivery: 'eager',
      },
    ],
    needs: [
      {
        id: 'analyze',
        operation: { id: 'data.analyze', revision: '1' },
        outputId: 'primary',
        fields: ['category', 'amount'],
        required: true,
      },
    ],
    ...(preferredView === undefined
      ? {}
      : {
          viewPreference: {
            representation: preferredView === 'bar' ? 'visualization.bar' : preferredView,
            strength: 'preferred' as const,
          },
        }),
  } satisfies Task;
  const barResult: Result = {
    ...result,
    ref: { ...result.ref, id: 'bar-result' },
    taskId: task.id,
    fields: [
      { id: 'category', label: 'Category', type: { value: 'text', nullable: false }, role: 'dimension' },
      { id: 'amount', label: 'Amount', type: { value: 'integer', nullable: false }, role: 'measure' },
    ],
    identity: ['category'],
    rowGrain: ['category'],
  };
  return {
    intent,
    task,
    result: barResult,
    current: { ...current, results: [barResult.ref] },
    environment: environment(width),
    availableViews: [],
  };
}

type StandardTestContext = Pick<PresentationContext, 'task' | 'current' | 'environment' | 'incumbent'> & {
  readonly intent: Intent;
  readonly result: Result;
  readonly presentationPolicy?: Parameters<typeof experience>[2];
};

function resolveStandard(context: StandardTestContext) {
  if (context.result === undefined) throw new Error('Expected a materialized standard result.');
  const row = Object.fromEntries(
    context.result.fields.map((field) => [
      field.id,
      field.type.value === 'date'
        ? '2026-01-01'
        : field.type.value === 'decimal'
          ? { decimal: '1' }
          : ['integer', 'float'].includes(field.type.value)
            ? 1
            : field.id,
    ]),
  );
  const identities = context.intent.kind === 'compare' ? context.intent.identities : [];
  const rows = identities.length === 0 ? [row] : identities.map((identity) => ({ ...row, ...identity }));
  const materializedResult =
    rows.length === context.result.counts.loaded
      ? context.result
      : {
          ...context.result,
          counts: {
            loaded: rows.length,
            population: { kind: 'exact' as const, value: rows.length, populationDigest: 'population-1' },
          },
          coverage: { kind: 'complete' as const, populationDigest: 'population-1' },
        };
  const registry = registryFor([{ ref: materializedResult.ref, rows }], [materializedResult], [], 'people');
  expect(registry).toBeDefined();
  if (registry === undefined) throw new Error('Expected the standard presentation registry.');
  const authored = standardRecipeCandidates({
    ...context,
    result: materializedResult,
  } as unknown as Parameters<typeof standardRecipeCandidates>[0]);
  expect(authored.ok).toBe(true);
  if (!authored.ok) throw new Error('Expected standard candidates.');
  return resolvePresentation({
    id: 'web-test',
    revision: context.task.revision,
    preconditions: context.current,
    context: {
      task: context.task,
      experience: experience(registry, context.current.experienceRevision, context.presentationPolicy),
      results: [materializedResult],
      current: context.current,
      environment: context.environment,
      rendererCapabilities: registry.manifests.map((manifest) => manifest.ref),
      stateMappingCapabilities: registry.stateMappings?.map((mapping) => mapping.ref) ?? [],
      ...(context.incumbent === undefined ? {} : { incumbent: context.incumbent }),
    },
    registry,
    target: {
      address: {
        runtimeId: 'runtime-1',
        scopeInstanceId: 'scope-1',
        activationEpoch: 1,
        surfaceId: 'main',
        surfaceGeneration: 1,
      },
      state: 'active',
    },
    ...authored.value,
  });
}

describe('0.3 standard recipes', () => {
  it('authors candidates and lets the core resolver adapt wide and narrow browse views', () => {
    const wide = resolveStandard(input('browse', 1_280));
    const narrow = resolveStandard(input('browse', 360));

    expect(wide.status === 'ready' && wide.plan.plan.nodes[0]?.representation.id).toBe('data.table');
    expect(narrow.status === 'ready' && narrow.plan.plan.nodes[0]?.representation.id).toBe('data.card-collection');
  });

  it('keeps valid adaptive candidates when an incumbent cannot transfer to every authored view', () => {
    const wide = resolveStandard(input('browse', 1_280));
    expect(wide.status).toBe('ready');
    if (wide.status !== 'ready') return;

    const context = { ...input('browse', 360), incumbent: wide.plan.plan };
    const authored = standardRecipeCandidates(context);
    expect(authored.ok && authored.value.candidates.map((candidate) => candidate.id)).toEqual([
      'standard.cards',
      'standard.table',
    ]);
    expect(resolveStandard(context).status).toBe('ready');
  });

  it('does not fall back when an explicit view pin is operation-incompatible', () => {
    const context = input('compare', 320);
    const task: Task = {
      ...context.task,
      viewPreference: { representation: 'data.card-collection', strength: 'explicit' },
    };

    const decision = resolveStandard({ ...context, task });

    expect(decision.status).toBe('unsupported');
    if (decision.status === 'unsupported')
      expect(decision.reasons.map((reason) => reason.code)).toContain('presentation.pin-incompatible');
  });

  it('returns a stable authorized measure clarification through the resolver seam', () => {
    const decision = resolveStandard(trendInput(['headcount', 'capacity']));

    expect(decision).toMatchObject({
      status: 'needs-input',
      diagnostic: { code: 'web.recipe.needs-input.measure' },
      choices: [
        { id: 'capacity', label: 'capacity' },
        { id: 'headcount', label: 'headcount' },
      ],
    });
  });

  it('does not prompt for a disallowed trend when an eligible table can present the task', () => {
    const decision = resolveStandard({
      ...trendInput(['headcount', 'capacity']),
      presentationPolicy: { allowedRepresentations: ['data.table'] },
    });

    expect(decision).toMatchObject({ status: 'ready' });
    if (decision.status === 'ready') expect(decision.plan.plan.nodes[0]?.representation.id).toBe('data.table');
  });

  it('treats inherited object keys as unknown view preferences instead of executing alias lookups', () => {
    const decision = resolveStandard(input('browse', 800, '__proto__'));

    expect(decision).toMatchObject({ status: 'ready' });
    if (decision.status === 'ready') expect(decision.plan.plan.nodes[0]?.representation.id).toBe('data.table');

    const direct = standardDataRecipe.build(input('browse', 800, '__proto__'));
    expect(direct.ok && direct.value.nodes[0]?.representation.id).toBe('data.table');
  });

  it('adapts browse from a table to cards using container width without a model call', () => {
    const wide = standardDataRecipe.build(input('browse', 1_280));
    const narrow = standardDataRecipe.build(input('browse', 360));
    expect(wide.ok && wide.value.nodes[0]?.representation.id).toBe('data.table');
    expect(narrow.ok && narrow.value.nodes[0]?.representation.id).toBe('data.card-collection');
  });

  it('keeps compare in a simultaneous column-preserving table on narrow containers', () => {
    const narrow = standardDataRecipe.build(input('compare', 320));
    expect(narrow.ok && narrow.value.nodes[0]?.representation.id).toBe('data.table');
  });

  it('authors and resolves a bounded comparison split while preserving narrow and pinned fallbacks', () => {
    const wideContext = {
      ...input('compare', 800),
      presentationPolicy: { allowedRepresentations: ['data.table', 'data.detail'] },
    };
    const authored = standardRecipeCandidates(wideContext);
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.value.candidates.map((candidate) => candidate.id)).toEqual([
      'standard.comparison',
      'standard.table',
    ]);

    const wide = resolveStandard(wideContext);
    expect(wide.status).toBe('ready');
    if (wide.status === 'ready') {
      expect(wide.receipt.selectedCandidate).toBe('standard.comparison');
      expect(wide.plan.plan.rootId).toBe('comparison');
      expect(wide.plan.plan.nodes.map((node) => node.id)).toEqual([
        'comparison',
        'comparison.left',
        'comparison.right',
      ]);
      expect(wide.plan.graph.links).toHaveLength(0);
      expect(wide.plan.plan.nodes.slice(1).map((node) => node.representation.id)).toEqual([
        'data.detail',
        'data.detail',
      ]);
      expect(wide.plan.plan.nodes.slice(1).map((node) => node.config.values.identityValues)).toEqual([
        { id: 'p-1' },
        { id: 'p-2' },
      ]);
      expect(wide.plan.plan.coverage).toEqual([
        {
          needId: 'compare',
          nodeIds: ['comparison.left', 'comparison.right'],
          operations: [{ id: 'data.compare', revision: '1' }],
        },
      ]);
    }

    const narrow = resolveStandard(input('compare', 320));
    expect(narrow.status).toBe('ready');
    if (narrow.status === 'ready') expect(narrow.plan.plan.nodes[0]?.representation.id).toBe('data.table');

    if (wide.status === 'ready') {
      const retained = resolveStandard({ ...input('compare', 320), incumbent: wide.plan.plan });
      expect(retained.status).toBe('ready');
      if (retained.status === 'ready') expect(retained.plan.plan.rootId).toBe('comparison');
    }

    const pinned = resolveStandard({
      ...wideContext,
      task: { ...wideContext.task, viewPreference: { representation: 'data.table', strength: 'explicit' } },
    });
    expect(pinned.status).toBe('ready');
    if (pinned.status === 'ready') {
      expect(pinned.receipt.selectedCandidate).toBe('standard.table');
      expect(pinned.plan.plan.rootId).toBe('primary');
      expect(pinned.plan.plan.nodes[0]?.representation.id).toBe('data.table');
    }
  });

  it('refreshes both comparison children with explicit identity transfers and current Result references', () => {
    const initial = input('compare', 800);
    const first = standardDataRecipe.build(initial);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const nextResult = { ...initial.result, ref: { ...initial.result.ref, id: 'next-result' } };
    for (const width of [800, 320]) {
      const next = standardDataRecipe.build({
        ...initial,
        result: nextResult,
        results: [nextResult],
        current: { ...current, results: [nextResult.ref] },
        environment: environment(width),
        incumbent: first.value,
      });
      expect(next.ok).toBe(true);
      if (!next.ok) continue;
      expect(next.value.nodes.slice(1).map((node) => node.result)).toEqual([nextResult.ref, nextResult.ref]);
      expect(next.value.preconditions.results).toEqual([nextResult.ref]);
      expect(next.value.stateTransfer).toEqual(
        first.value.nodes.map((node) => ({
          fromNode: node.id,
          toNode: node.id,
          mapping: { id: 'aeliqo.state.identity', revision: '1' },
        })),
      );
    }
  });

  it('reaches a registered categorical bar and preserves trend clarification when bar is unavailable', () => {
    const barContext = barInput();
    const registry = registryFor(
      [{ ref: barContext.result.ref, rows: [{ category: 'A', amount: 1 }] }],
      [barContext.result],
      [],
      'people',
    );
    expect(registry?.manifests.find((manifest) => manifest.ref.id === 'visualization.bar')?.operations).toContainEqual({
      id: 'data.analyze',
      revision: '1',
    });

    const ready = resolveStandard(barContext);
    expect(ready.status).toBe('ready');
    if (ready.status === 'ready') {
      expect(ready.plan.plan.nodes[0]?.representation.id).toBe('visualization.bar');
      expect(ready.plan.plan.nodes[0]?.config.values.visualization).toMatchObject({ view: 'bar' });
    }

    const unavailableResult: Result = {
      ...barContext.result,
      fields: [
        { id: 'week', label: 'Week', type: { value: 'date', nullable: false }, role: 'time' },
        ...barContext.result.fields,
        { id: 'other', label: 'Other', type: { value: 'integer', nullable: false }, role: 'measure' },
      ],
    };
    const unavailableTask = {
      ...barContext.task,
      needs: [{ ...barContext.task.needs[0]!, fields: ['week', 'category', 'amount', 'other'] }],
    } satisfies Task;
    const unavailable = resolveStandard({
      ...barContext,
      task: unavailableTask,
      result: unavailableResult,
      current: { ...current, results: [unavailableResult.ref] },
    });
    expect(unavailable).toMatchObject({
      status: 'needs-input',
      diagnostic: { code: 'web.recipe.needs-input.measure' },
    });
  });

  it('answers an analyze intent without a view preference with an eligible chart before a table', () => {
    const withoutPreference = <T extends { intent: Intent; task: Task }>(context: T): T => {
      const { preferredView: _intentPreference, ...intent } = context.intent as Intent & { preferredView?: string };
      const { viewPreference: _taskPreference, ...task } = context.task;
      return { ...context, intent: intent as Intent, task: task as Task };
    };
    const categorical = resolveStandard(withoutPreference(barInput()));
    expect(categorical.status === 'ready' && categorical.plan.plan.nodes[0]?.representation.id).toBe(
      'visualization.bar',
    );
    const temporal = resolveStandard(withoutPreference(trendInput(['headcount'])));
    expect(temporal.status === 'ready' && temporal.plan.plan.nodes[0]?.representation.id).toMatch(/trend/u);
    const pinnedTable = resolveStandard(barInput(800, 'table'));
    expect(pinnedTable.status === 'ready' && pinnedTable.plan.plan.nodes[0]?.representation.id).toBe('data.table');
  });

  it('keeps a narrow browse in the only representation permitted by resource policy', () => {
    const outcome = standardDataRecipe.build({
      ...input('browse', 360),
      presentationPolicy: { allowedRepresentations: ['data.table'] },
    });
    expect(outcome.ok && outcome.value.nodes[0]?.representation.id).toBe('data.table');
  });

  it('binds a preferred trend to the requested semantic measure instead of a numeric identity', () => {
    const outcome = standardDataRecipe.build(trendInput(['headcount']));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.nodes[0]).toMatchObject({
      representation: { id: 'data.trend' },
      config: { values: { labelField: 'week', series: [{ field: 'headcount' }], seriesBy: [] } },
    });
  });

  it('requests a measure choice when a preferred trend has multiple requested measures', () => {
    const outcome = standardDataRecipe.build(trendInput(['headcount', 'capacity']));
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'web.recipe.needs-input.measure' }] });
  });

  it('requests a time field when a preferred trend has no requested temporal field', () => {
    const context = trendInput(['headcount']);
    const output = context.task.outputs[0];
    if (output.kind !== 'query') throw new Error('The trend fixture must use a query output.');
    const task: Task = {
      ...context.task,
      outputs: [{ ...output, query: { ...output.query, fields: [], groupBy: [] } }],
      needs: context.task.needs.map((need) => ({ ...need, fields: ['headcount'] })),
    };
    const outcome = standardDataRecipe.build({ ...context, task });
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'web.recipe.needs-input.time' }] });
  });

  it('requests a numeric measure when a preferred trend has no requested measure', () => {
    const context = trendInput(['headcount']);
    const output = context.task.outputs[0];
    if (output.kind !== 'query') throw new Error('The trend fixture must use a query output.');
    const task: Task = {
      ...context.task,
      outputs: [{ ...output, query: { ...output.query, measures: [] } }],
      needs: context.task.needs.map((need) => ({ ...need, fields: ['week'] })),
    };
    const outcome = standardDataRecipe.build({ ...context, task });
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'web.recipe.needs-input.measure' }] });
  });

  it('rejects a plan outside resource policy during final presentation validation', () => {
    const context = input('browse', 360);
    const unrestricted = standardDataRecipe.build(context);
    expect(unrestricted.ok && unrestricted.value.nodes[0]?.representation.id).toBe('data.card-collection');
    if (!unrestricted.ok || context.result === undefined) return;
    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'person',
      schema: z.object({ id: z.string(), name: z.string() }),
      identity: ['id'],
      presentation: { allowedViews: ['table'] },
      fields: { id: { label: 'ID' }, name: { label: 'Name' } },
    });
    const policy = presentationPolicy(resource);
    const registry = createAeliqoPresentationRegistry({
      data: [{ result: context.result, rows: [{ id: 'p-1', name: 'Ada' }] }],
      resolveEntity: () => 'people',
    });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const checked = validatePresentationPlan(
      unrestricted.value,
      {
        task: context.task,
        results: [context.result],
        current,
        environment: context.environment,
        rendererCapabilities: registry.value.manifests.map((manifest) => manifest.ref),
        stateMappingCapabilities: registry.value.stateMappings?.map((mapping) => mapping.ref) ?? [],
        experience: experience(registry.value, current.experienceRevision, policy),
      },
      registry.value,
    );
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.diagnostics).toMatchObject([{ code: 'presentation.restricted' }]);
  });

  it('supplies every output to a recipe while retaining the primary result', async () => {
    const fixture = input('browse', 800);
    const descriptors = [
      fixture.result,
      {
        ...fixture.result,
        ref: { ...fixture.result.ref, id: 'result-secondary', outputId: 'secondary' },
      },
    ];
    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'People',
      identity: ['id'],
      presentation: { allowedViews: ['table'] },
      schema: z.object({ id: z.string(), name: z.string() }),
    });
    let observed: Parameters<typeof standardDataRecipe.build>[0] | undefined;
    const context = {
      runtime: { snapshot: () => ({ region: { readSet: current } }) },
      resources: new Map([['people', resource]]),
      recipes: [
        {
          ...standardDataRecipe,
          build(value: Parameters<typeof standardDataRecipe.build>[0]) {
            observed = value;
            return { ok: false, diagnostics: [{ code: 'fixture.stop', message: 'Observed.', retryable: false }] };
          },
        },
      ],
      views: [],
    } as unknown as WebAppContext;
    const region = {
      id: 'main',
      resourceId: 'people',
      sequence: 1,
      target: {
        lang: 'en-US',
        ownerDocument: { defaultView: null },
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      element: {},
    } as unknown as WebRegion;
    const receipt = {
      status: 'committed',
      regionId: 'main',
      requestId: 'request',
      intent: fixture.intent,
      task: fixture.task,
      region: { readSet: current },
    } as unknown as RuntimeCommittedReceipt;
    const outcome = await present(context, region, receipt, [], descriptors, 'present', 1);
    expect(outcome).toMatchObject({ status: 'unsupported', diagnostics: [{ code: 'fixture.stop' }] });
    expect(observed?.results).toEqual(descriptors);
    expect(observed?.result).toBe(descriptors[0]);
    expect(Object.isFrozen(observed?.results)).toBe(true);
    expect(observed?.results).not.toBe(descriptors);
  });

  it('preserves the prior rendered result when a custom recipe violates resource policy', async () => {
    const wide = input('browse', 800);
    const narrow = input('browse', 360);
    const priorPlan = standardDataRecipe.build({
      ...wide,
      presentationPolicy: { allowedRepresentations: ['data.table'] },
    });
    const violatingPlan = standardDataRecipe.build(narrow);
    expect(priorPlan.ok).toBe(true);
    expect(violatingPlan.ok && violatingPlan.value.nodes[0]?.representation.id).toBe('data.card-collection');
    if (!priorPlan.ok || !violatingPlan.ok || wide.result === undefined) return;

    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'person',
      schema: z.object({ id: z.string(), name: z.string() }),
      identity: ['id'],
      presentation: { allowedViews: ['table'] },
      fields: { id: { label: 'ID' }, name: { label: 'Name' } },
    });
    const rows = [{ id: 'p-1', name: 'Ada' }];
    const bindings = [{ ref: wide.result.ref, rows }];
    const registry = createAeliqoPresentationRegistry({
      data: [{ result: wide.result, rows }],
      resolveEntity: () => 'people',
    });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const checked = validatePresentationPlan(
      priorPlan.value,
      {
        task: wide.task,
        results: [wide.result],
        current,
        environment: wide.environment,
        rendererCapabilities: registry.value.manifests.map((manifest) => manifest.ref),
        stateMappingCapabilities: registry.value.stateMappings?.map((mapping) => mapping.ref) ?? [],
        experience: experience(registry.value, current.experienceRevision, presentationPolicy(resource)),
      },
      registry.value,
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    const previous = {
      ...checked.value,
      plan: {
        ...checked.value.plan,
        preconditions: { ...checked.value.plan.preconditions, taskRevision: 'previous-task' },
      },
    } satisfies ValidatedPresentation;
    const elementState = {
      presentation: previous as ValidatedPresentation | undefined,
      results: bindings,
      interaction: undefined,
    };
    const target = {
      lang: '',
      ownerDocument: { documentElement: { lang: 'en-US' }, defaultView: null },
      getBoundingClientRect: () => ({ width: 360, height: 600 }),
    } as unknown as HTMLElement;
    const region = {
      id: 'main',
      resourceId: 'people',
      target,
      element: elementState,
      sequence: 1,
      category: 'narrow',
      composing: false,
      pendingAdapt: false,
      actionPending: false,
      actionSequence: 0,
      values: new Map(),
      drafts: new Map(),
    } as unknown as WebRegion;
    let commitCalls = 0;
    const runtime = {
      snapshot: () => ({ region: { readSet: { ...current, dataRevision: 1 } } }),
      commitPresentation: () => {
        commitCalls++;
        throw new Error('Policy rejection must happen before a presentation commit.');
      },
    } as unknown as AeliqoRuntime;
    const context = {
      options: {},
      runtime,
      resources: new Map([[resource.id, resource]]),
      recipes: [{ ...standardDataRecipe, build: () => violatingPlan }],
      views: [],
      regions: new Map(),
      stateListeners: new Map(),
      disposed: false,
    } as unknown as WebAppContext;
    const receipt = {
      status: 'committed',
      requestId: 'runtime-request',
      regionId: 'main',
      intent: narrow.intent,
      task: narrow.task,
      outputs: [],
      region: { id: 'main', readSet: { ...current, dataRevision: 1 } },
      diagnostics: [],
    } as unknown as RuntimeCommittedReceipt;

    const outcome = await present(context, region, receipt, bindings, [wide.result], 'web-request', 1);

    expect(outcome).toMatchObject({ status: 'unsupported', diagnostics: [{ code: 'presentation.restricted' }] });
    expect(commitCalls).toBe(0);
    expect(elementState.presentation).toBe(previous);
    expect(elementState.results).toBe(bindings);
  });

  it('cancels a delayed stale presentation before it can publish over a newer renderer-ready Region', async () => {
    const fixture = input('browse', 800);
    if (fixture.result === undefined) throw new Error('The browse fixture must materialize a Result.');
    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'person',
      schema: z.object({ id: z.string(), name: z.string() }),
      identity: ['id'],
      presentation: { allowedViews: ['table', 'cards'] },
      fields: { id: { label: 'ID' }, name: { label: 'Name' } },
    });
    const bindings = [{ ref: fixture.result.ref, rows: [{ id: 'p-1', name: 'Ada' }] }];
    const elementState = {
      ownerDocument: createRegistrationDocument(),
      presentation: undefined as ValidatedPresentation | undefined,
      results: [] as readonly (typeof bindings)[number][],
      interaction: undefined,
      preparePublication() {
        return { apply() {}, rollback() {}, complete() {} };
      },
    };
    const target = {
      lang: '',
      ownerDocument: { documentElement: { lang: 'en-US' }, defaultView: null },
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement;
    const region = {
      id: 'main',
      resourceId: 'people',
      target,
      element: elementState,
      sequence: 1,
      category: 'wide',
      composing: false,
      pendingAdapt: false,
      actionPending: false,
      actionSequence: 0,
      values: new Map(),
      drafts: new Map(),
    } as unknown as WebRegion;
    let delayedStarted!: () => void;
    const delayed = new Promise<void>((resolve) => (delayedStarted = resolve));
    const published: string[] = [];
    const runtime = {
      snapshot: () => ({ region: { readSet: { ...current, dataRevision: 1 } } }),
      commitPresentation: async (request: RuntimePresentationInput) => {
        if (request.requestId === 'stale') {
          delayedStarted();
          await new Promise<void>((resolve) => {
            if (request.signal?.aborted) resolve();
            else request.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          request.projection?.rollback();
          return {
            ok: false as const,
            diagnostics: [
              { code: 'runtime.region-cancelled', message: 'The stale commit was cancelled.', retryable: false },
            ],
          };
        }
        const result = commitTestProjection(request);
        if (result.ok) published.push(request.requestId);
        return result;
      },
    } as unknown as AeliqoRuntime;
    const context = {
      options: { authority: testAuthority },
      runtime,
      resources: new Map([[resource.id, resource]]),
      recipes: [standardDataRecipe],
      views: [],
      regions: new Map([['main', region]]),
      stateListeners: new Map(),
      disposed: false,
    } as unknown as WebAppContext;
    const receipt = {
      status: 'committed',
      requestId: 'runtime-request',
      regionId: 'main',
      intent: fixture.intent,
      task: fixture.task,
      outputs: [],
      region: { id: 'main', readSet: { ...current, dataRevision: 1 } },
      diagnostics: [],
    } as unknown as RuntimeCommittedReceipt;

    const stale = present(context, region, receipt, bindings, [fixture.result], 'stale', 1);
    const reachedCommit = await Promise.race([
      delayed.then(() => true),
      stale.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(reachedCommit).toBe(true);
    region.sequence = 2;
    const currentRender = await present(context, region, receipt, bindings, [fixture.result], 'current', 2);
    const staleRender = await stale;

    expect(staleRender).toMatchObject({ status: 'cancelled', requestId: 'stale' });
    expect(currentRender).toMatchObject({ status: 'renderer-ready', requestId: 'current' });
    expect(published).toEqual(['current']);
    expect(elementState.presentation).toBe(
      currentRender.status === 'renderer-ready' ? currentRender.presentation : undefined,
    );
  });

  it('restores the previous UI when cancellation occurs synchronously during publication', async () => {
    const fixture = input('browse', 800);
    if (fixture.result === undefined) throw new Error('The browse fixture must materialize a Result.');
    const initial = resolveStandard(fixture);
    expect(initial.status).toBe('ready');
    if (initial.status !== 'ready') return;

    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'person',
      schema: z.object({ id: z.string(), name: z.string() }),
      identity: ['id'],
      presentation: { allowedViews: ['table', 'cards'] },
      fields: { id: { label: 'ID' }, name: { label: 'Name' } },
    });
    const priorBindings = [{ ref: fixture.result.ref, rows: [{ id: 'prior', name: 'Prior' }] }];
    const bindings = [{ ref: fixture.result.ref, rows: [{ id: 'next', name: 'Next' }] }];
    const controller = new AbortController();
    let publicationCalls = 0;
    let rollbackCalls = 0;
    const elementState = {
      ownerDocument: createRegistrationDocument(),
      presentation: initial.plan,
      results: priorBindings as readonly (typeof bindings)[number][],
      interaction: undefined,
      preparePublication() {
        return {
          apply() {
            publicationCalls++;
            controller.abort();
          },
          rollback() {
            rollbackCalls++;
          },
          complete() {},
        };
      },
    };
    const target = {
      lang: '',
      ownerDocument: { documentElement: { lang: 'en-US' }, defaultView: null },
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    } as unknown as HTMLElement;
    const region = {
      id: 'main',
      resourceId: 'people',
      target,
      element: elementState,
      sequence: 1,
      category: 'wide',
      composing: false,
      pendingAdapt: false,
      actionPending: false,
      actionSequence: 0,
      values: new Map(),
      drafts: new Map(),
    } as unknown as WebRegion;
    const runtime = {
      snapshot: () => ({ region: { readSet: { ...current, dataRevision: 1 } } }),
      commitPresentation: async (request: RuntimePresentationInput) => commitTestProjection(request),
    } as unknown as AeliqoRuntime;
    const context = {
      options: { authority: testAuthority },
      runtime,
      resources: new Map([[resource.id, resource]]),
      recipes: [standardDataRecipe],
      views: [],
      regions: new Map([['main', region]]),
      stateListeners: new Map(),
      disposed: false,
    } as unknown as WebAppContext;
    const receipt = {
      status: 'committed',
      requestId: 'runtime-request',
      regionId: 'main',
      intent: fixture.intent,
      task: fixture.task,
      outputs: [],
      region: { id: 'main', readSet: { ...current, dataRevision: 1 } },
      diagnostics: [],
    } as unknown as RuntimeCommittedReceipt;
    const pending = present(
      context,
      region,
      receipt,
      bindings,
      [fixture.result],
      'cancel-after-apply',
      1,
      undefined,
      controller.signal,
    );
    const outcome = await pending;

    expect(outcome).toMatchObject({ status: 'cancelled', requestId: 'cancel-after-apply' });
    expect(elementState.presentation).toBe(initial.plan);
    expect(elementState.results).toBe(priorBindings);
    expect(publicationCalls).toBe(1);
    expect(rollbackCalls).toBe(1);
  });

  it('treats an incompatible preferred view as a preference and falls back safely', () => {
    const outcome = standardDataRecipe.build(input('compare', 320, 'cards'));
    expect(outcome.ok && outcome.value.nodes[0]?.representation.id).toBe('data.table');
  });

  it('accepts a maximum-length consumer view with a bounded resolver candidate ID', () => {
    const viewId = `example.${'x'.repeat(152)}`;
    const custom = defineView({
      ref: { id: viewId, revision: '1' },
      manifest: {
        ref: { id: viewId, revision: '1' },
        configSchema: { id: 'example.people-grid.config', revision: '1' },
        roles: ['grid'],
        operations: [{ id: 'data.read', revision: '1' }],
        result: 'required',
        children: { min: 0, max: 0 },
        visibility: 'leaf',
        extension: true,
        resolveConfig: (values) => ({
          ok: true,
          value: { values, fields: ['id', 'name'], ports: [], operations: [{ id: 'data.read', revision: '1' }] },
        }),
      },
      render: () => html`<div>Custom people grid</div>`,
    });
    const context = { ...input('browse', 800, custom.ref.id), availableViews: [custom] };
    const outcome = standardDataRecipe.build(context);
    expect(outcome.ok && outcome.value.nodes[0]?.representation.id).toBe(viewId);
    const authored = standardRecipeCandidates(context);
    expect(authored.ok).toBe(true);
    if (authored.ok) {
      const id = authored.value.candidates.find((candidate) => candidate.id.startsWith('custom.'))?.id;
      expect(id).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u);
      expect(id?.length).toBeLessThanOrEqual(160);
    }
  });

  it('bounds and normalizes the candidate provenance for a maximum-length custom recipe', () => {
    const recipe = defineRecipe({
      ref: { id: `example.${'r'.repeat(152)}`, revision: `revision:${'x'.repeat(160)}` },
      intents: ['browse'],
      build: standardDataRecipe.build,
    });
    const id = resolverCandidateId('recipe', `${recipe.ref.id}.${recipe.ref.revision}`);

    expect(id).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u);
    expect(id.length).toBeLessThanOrEqual(160);
    expect(id).toBe(resolverCandidateId('recipe', `${recipe.ref.id}.${recipe.ref.revision}`));
  });

  it('matches a recipe to its exact registered custom intent ref without adding a standard alias', () => {
    const recipe = defineRecipe({
      ref: { id: 'orders.workspace-recipe', revision: '1' },
      intents: [{ id: 'orders.workspace-layout', revision: '1' }],
      build: standardDataRecipe.build,
    });
    const matching: Intent = {
      version: '1',
      id: 'workspace-layout',
      resource: 'people',
      kind: 'custom',
      intent: { id: 'orders.workspace-layout', revision: '1' },
      input: { mode: 'compare' },
    };
    const differentRevision: Intent = {
      ...matching,
      intent: { id: 'orders.workspace-layout', revision: '2' },
    };

    expect(recipeSupports(recipe, matching)).toBe(true);
    expect(recipeSupports(recipe, differentRevision)).toBe(false);
    expect(recipeSupports(recipe, 'browse')).toBe(false);
    expect(recipeSupports(standardDataRecipe, matching)).toBe(false);
  });

  it('fails closed for duplicate or malformed custom recipe intent refs', () => {
    const base = {
      ref: { id: 'orders.workspace-recipe', revision: '1' },
      intents: [{ id: 'orders.workspace-layout', revision: '1' }],
      build: standardDataRecipe.build,
    };

    expect(() =>
      defineRecipe({
        ...base,
        intents: [
          { id: 'orders.workspace-layout', revision: '1' },
          { id: 'orders.workspace-layout', revision: '1' },
        ],
      }),
    ).toThrow(TypeError);
    expect(() => defineRecipe({ ...base, intents: [{ id: 'workspace-layout', revision: '1' }] })).toThrow(TypeError);
    expect(() => defineRecipe({ ...base, intents: ['custom' as never] })).toThrow(TypeError);
    expect(() => defineRecipe({ ...base, ref: { id: 'orders.workspace-recipe', revision: 'bad revision' } })).toThrow(
      TypeError,
    );
  });

  it('builds a queryless create form entirely from host-owned resource bindings', () => {
    const resource = defineResource({
      id: 'people',
      revision: 'catalog-1',
      label: 'People',
      schema: z.object({ id: z.string(), name: z.string(), active: z.boolean() }),
      identity: ['id'],
      presentation: { allowedViews: ['table'] },
      fields: { id: { label: 'ID' }, name: { label: 'Name' }, active: { label: 'Active' } },
      forms: {
        create: { schema: { id: 'people.create', revision: '1' }, action: { id: 'people.create', revision: '1' } },
      },
    });
    const intent: Intent = { version: '1', id: 'create-1', kind: 'create', resource: 'people' };
    const task: Task = {
      version: '1',
      id: 'create-1',
      revision: '1',
      catalogRevision: 'catalog-1',
      functionRegistryDigest: 'core-query-2',
      regionId: 'main',
      kind: 'form',
      goal: 'Create person',
      assumptions: [],
      needs: [],
      schema: { id: 'people.create', revision: '1' },
      action: { id: 'people.create', revision: '1' },
    };
    const bindings = createFormBindings(resource, intent, task, { values: {}, entityRevision: 'new' });
    expect(bindings.ok).toBe(true);
    if (!bindings.ok) return;
    expect(bindings.value.inputs[0]?.config).toEqual({
      label: 'Create a record in People',
      submitLabel: 'Create record',
    });
    const formCurrent = { ...current, taskRevision: '1', results: [] };
    const plan = standardFormRecipe.build({
      intent,
      task,
      inputBindings: bindings.value,
      current: formCurrent,
      environment: environment(360),
      availableViews: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const registry = createAeliqoPresentationRegistry({ inputs: bindings.value });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const checked = validatePresentationPlan(
      plan.value,
      {
        task,
        results: [],
        current: formCurrent,
        environment: environment(360),
        rendererCapabilities: registry.value.manifests.map((manifest) => manifest.ref),
        stateMappingCapabilities: [],
        experience: {
          version: '1',
          id: 'web',
          revision: 'experience-1',
          mode: 'adaptive',
          agentAllowed: true,
          allowedRepresentations: registry.value.manifests.map((manifest) => manifest.ref.id),
          allowedPatterns: [],
          composition: { allowWithoutPreset: true, maxNodes: 32, maxExpansions: 64 },
          requiredOperations: [],
          tokenProfile: { id: 'tokens.default', revision: '1' },
          extensionAllowlist: [],
          transitionPolicy: 'stable',
        },
      },
      registry.value,
    );
    if (!checked.ok)
      throw new Error(checked.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
    expect(plan.value.nodes.map((node) => node.representation.id)).toEqual([
      'input.form',
      'input.text-field',
      'input.text-field',
      'input.checkbox',
    ]);
  });
});

const testAuthority = {
  read: () => ({
    ok: true as const,
    value: {
      principalKey: 'alice',
      scopeDigest: current.scopeDigest,
      policyRevision: current.policyRevision,
      experienceRevision: current.experienceRevision,
      grants: ['task.evaluate'],
      readContext: { principal: 'alice' },
    },
  }),
};

function commitTestProjection(request: RuntimePresentationInput) {
  const next = {
    id: request.regionId,
    status: 'active' as const,
    taskRevision: '2',
    regionRevision: '2',
    dataRevision: 1,
    readSet: { ...current, taskRevision: '2', regionRevision: '2', dataRevision: 1 },
    state: {
      task: { ...request.task, revision: '2' },
      presentation: {
        ...request.presentation,
        preconditions: { ...request.presentation.preconditions, taskRevision: '2', regionRevision: '2' },
      },
      ...(request.interaction === undefined ? {} : { interaction: request.interaction }),
    },
  };
  const applied = request.projection?.apply(next);
  if (applied !== undefined && !applied.ok) {
    request.projection?.rollback();
    return applied;
  }
  return { ok: true as const, value: next };
}
