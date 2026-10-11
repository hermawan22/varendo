import { expect, it } from 'vitest';
import {
  defineResource,
  type Intent,
  type InteractionState,
  type Result,
  type Task,
} from '../../packages/core/src/index.js';
import type { PresentationEnvironment, ValidatedPresentation } from '../../packages/core/src/presentation/index.js';
import type {
  AeliqoRuntime,
  RuntimeCommittedReceipt,
  RuntimePresentationInput,
} from '../../packages/runtime/src/app/index.js';
import * as z from 'zod';
import { standardDataRecipe } from '../../packages/web/src/recipes/index.js';
import type { WebAppContext, WebRegion } from '../../packages/web/src/app/context.js';
import { present } from '../../packages/web/src/app/presentation.js';
import { createInteractionHandler } from '../../packages/web/src/app/interaction.js';
import { adaptRegion } from '../../packages/web/src/app/render.js';
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

function projectionFixture() {
  const fixture = input('browse', 800);
  const resource = defineResource({
    id: 'people',
    revision: 'catalog-1',
    label: 'person',
    schema: z.object({ id: z.string(), name: z.string() }),
    identity: ['id'],
    presentation: { allowedViews: ['table', 'cards'] },
  });
  const bindings = [{ ref: fixture.result.ref, rows: [{ id: 'p-1', name: 'Ada' }] }];
  const elementState = {
    ownerDocument: createRegistrationDocument(),
    presentation: undefined as ValidatedPresentation | undefined,
    results: bindings,
    interaction: undefined as InteractionState | undefined,
    preparePublication() {
      return { apply() {}, rollback() {}, complete() {} };
    },
  };
  let width = 800;
  const target = {
    lang: '',
    ownerDocument: { documentElement: { lang: 'en-US' }, defaultView: null, activeElement: null },
    getBoundingClientRect: () => ({ width, height: 600 }),
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
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const began = new Promise<void>((resolve) => (started = resolve));
  let block = false;
  const selectionRecipe = {
    ...standardDataRecipe,
    ref: { id: 'test.selection', revision: '1' },
    build(ctx: Parameters<typeof standardDataRecipe.build>[0]) {
      const plan = standardDataRecipe.build(ctx);
      if (!plan.ok) return plan;
      return {
        ok: true as const,
        value: {
          ...plan.value,
          nodes: plan.value.nodes.map((node) => ({
            ...node,
            config: { ...node.config, values: { ...node.config.values, selection: 'multiple' } },
          })),
        },
      };
    },
  };
  let runtimeReadSet = { ...current, taskRevision: '1', regionRevision: 'region-1', dataRevision: 1 };
  const runtime = {
    snapshot: () => ({ region: { readSet: runtimeReadSet } }),
    commitPresentation: async (request: RuntimePresentationInput) => {
      if (block) {
        started();
        await gate;
      }
      const next = {
        id: 'main',
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
      runtimeReadSet = next.readSet;
      return { ok: true, value: next };
    },
  } as unknown as AeliqoRuntime;
  const context = {
    options: {
      authority: {
        read: () => ({
          ok: true,
          value: { principalKey: 'alice', ...current, grants: ['task.evaluate'], readContext: { principal: 'alice' } },
        }),
      },
    },
    runtime,
    resources: new Map([[resource.id, resource]]),
    recipes: [selectionRecipe],
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
  return {
    fixture,
    context,
    region,
    elementState,
    bindings,
    receipt,
    began,
    release,
    block: (value: boolean) => {
      block = value;
    },
    resize: (value: number) => {
      width = value;
    },
  };
}

it('cancels an adaptive candidate when selection changes during authorization and retains it on retry', async () => {
  const state = projectionFixture();
  const { fixture, context, region, elementState, bindings, began, release } = state;
  let receipt = state.receipt;
  const initial = await present(context, region, receipt, bindings, [fixture.result], 'initial', 1);
  expect(initial.status).toBe('renderer-ready');
  if (initial.status !== 'renderer-ready') throw Error(JSON.stringify(initial));
  receipt = initial.runtime;
  state.block(true);
  region.last = { receipt, results: bindings, descriptors: [fixture.result] };
  const priorPresentation = elementState.presentation;
  const pending = present(context, region, receipt, bindings, [fixture.result], 'race', 1);
  await began;
  const node = elementState.presentation!.nodes.find((entry) =>
    entry.config.ports.some((port) => port.payload === 'selection'),
  )!;
  const port = node.config.ports.find((entry) => entry.payload === 'selection')!;
  const payload = {
    kind: 'selection' as const,
    selection: { mode: 'ids' as const, entity: 'people', keys: ['p-1'], result: fixture.result.ref },
  };
  await createInteractionHandler(context)(region, { nodeId: node.node.id, portId: port.id, payload } as never);
  expect(elementState.interaction?.values).toHaveLength(1);
  release();
  const outcome = await pending;
  expect(outcome.status, JSON.stringify(outcome.diagnostics)).toBe('cancelled');
  expect(elementState.presentation).toBe(priorPresentation);
  expect(elementState.interaction?.values).toHaveLength(1);
  expect(region.values.size).toBe(1);
  state.block(false);
  const retry = await present(context, region, receipt, bindings, [fixture.result], 'retry', 1);
  expect(retry.status, JSON.stringify(retry.diagnostics)).toBe('renderer-ready');
  expect(elementState.interaction?.values).toHaveLength(1);
  expect(region.values.size).toBe(1);
});

it.each(['loading', 'commit'] as const)(
  'coalesces overlapping automatic adaptations during %s and returns the latest committed environment',
  async (stage) => {
    const state = projectionFixture();
    const { fixture, context, region, elementState, bindings } = state;
    const initial = await present(context, region, state.receipt, bindings, [fixture.result], 'initial', 1);
    expect(initial.status).toBe('renderer-ready');
    if (initial.status !== 'renderer-ready') throw Error(JSON.stringify(initial));
    region.last = { receipt: initial.runtime, results: bindings, descriptors: [fixture.result] };
    state.block(true);
    const adapting = adaptRegion(context, region);
    if (stage === 'commit') await state.began;
    const sequence = region.sequence;
    const controller = region.presentationAbort;
    state.resize(360);
    const overlapping = adaptRegion(context, region);
    try {
      expect(region.sequence).toBe(sequence);
      expect(controller?.signal.aborted).toBe(false);
      expect(region.pendingAdapt).toBe(true);
    } finally {
      state.block(false);
      state.release();
    }
    expect(await overlapping).toBeUndefined();
    const adapted = await adapting;
    expect(adapted?.status, JSON.stringify(adapted?.diagnostics)).toBe('renderer-ready');
    if (adapted?.status !== 'renderer-ready') throw Error(JSON.stringify(adapted));
    expect(adapted.environment.inlineSize).toEqual({ state: 'known', value: 360 });
    expect(adapted.runtime.task.id).toBe(initial.runtime.task.id);
    expect(region.last.results).toBe(bindings);
    expect(elementState.presentation).toBe(adapted.presentation);
    expect(region.pendingAdapt).toBe(false);
  },
);
