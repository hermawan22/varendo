import { compileIntent, parseIntent, type Intent, type Outcome, type PresentationPlan, type Task } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import {
  createPresentationRegistry,
  resolvePresentation,
  type PresentationEnvironment,
  type PresentationRegistry,
  type PresentationStateMappingManifest,
} from '@varendo/core/presentation';
import type { FeatureDefinition } from '@varendo/core/features';
import {
  createVarendoRuntime,
  type LocalSurfaceScope,
  type RequestResult,
  type RuntimeCommittedReceipt,
  type SurfaceAddress,
  type SurfaceController,
} from '@varendo/runtime';
import { z } from 'zod';
import { VARENDO_DATA_CONFIG_SCHEMAS, VARENDO_DATA_REFS } from '../../../packages/web/src/region/data-registry.js';
import {
  experience,
  presentationPolicy,
  registryFor,
  withoutDataRevision,
} from '../../../packages/web/src/app/context.js';
import { VARENDO_FOUNDATION_REFS } from '../../../packages/web/src/foundation/manifest.js';
import { dataColumns } from '../../../packages/web/src/recipes/standard-data.js';
import { defineRecipe } from '../../../packages/web/src/recipes/define.js';
import { standardDataRecipe } from '../../../packages/web/src/recipes/standard.js';
import type { RecipeContext } from '../../../packages/web/src/recipes/types.js';
import { createPeopleFixture, fixtureRows, peopleFeature } from './people.js';

const REGION_ID = 'workspace-region';
const WORKSPACE_FEATURE_ID = 'workspace';
const WORKSPACE_LAYOUT_REF = { id: 'orders.workspace-layout', revision: '1' } as const;
const WORKSPACE_SELECTION_REF = { id: 'orders.workspace-selection', revision: '1' } as const;
const SPLIT = VARENDO_FOUNDATION_REFS.splitPane;
const TABLE = VARENDO_DATA_REFS.table;
const DETAIL = VARENDO_DATA_REFS.detail;

const environment: PresentationEnvironment = {
  inlineSize: { state: 'known', value: 1024 },
  blockSize: { state: 'known', value: 720 },
  textScale: { state: 'known', value: 1 },
  pointer: 'fine',
  hover: 'available',
  keyboard: 'available',
  locale: 'en-US',
  direction: 'ltr',
  reducedMotion: false,
  forcedColors: false,
};

type LayoutMode = 'single' | 'split' | 'compare';
type Identity = { readonly id: string };
type LayoutInput = {
  readonly mode: Exclude<LayoutMode, 'single'>;
  readonly identities: readonly [Identity, ...Identity[]];
};
type SelectionInput = { readonly ids: readonly string[] };

export interface WorkspaceChildBinding {
  readonly nodeId: string;
  readonly address: SurfaceAddress;
  readonly ownerSurfaceId: string;
}

export interface WorkspaceSnapshot {
  readonly layout: LayoutMode;
  readonly selectedIds: readonly string[];
  readonly scopeEpoch: number;
  readonly scopeInstanceId: string;
  readonly runtimeId: string;
  readonly plan: PresentationPlan;
  readonly children: readonly WorkspaceChildBinding[];
}

export interface WorkspaceRenderer {
  /** Fail the next bounded renderer preparation before any data request starts. */
  failNext(message?: string): void;
  /** Hold the next preparation; releasing it lets the request continue. */
  holdNext(): () => void;
}

export interface WorkspaceIntents {
  readonly browse: Intent;
  readonly split: Intent;
  readonly compare: Intent;
  readonly select: (ids: readonly string[]) => Intent;
}

export interface WorkspaceView {
  snapshot(): WorkspaceSnapshot | undefined;
  selectThroughControl(ids: readonly string[]): Promise<RequestResult>;
}

export interface WorkspaceFixtureContract {
  readonly surface: SurfaceController<Intent, WorkspaceState>;
  readonly scope: LocalSurfaceScope;
  readonly intents: WorkspaceIntents;
  readonly view: WorkspaceView;
  readonly renderer: WorkspaceRenderer;
  readonly dispose: () => void;
}

export interface WorkspaceState {
  readonly layout: LayoutMode;
  readonly selectedIds: readonly string[];
  readonly children: readonly string[];
}

interface ChildState {
  readonly nodeId: string;
  readonly revision: string;
}

const workspaceFeature: FeatureDefinition<Intent> & { readonly kind: 'feature' } = Object.freeze({
  kind: 'feature',
  id: WORKSPACE_FEATURE_ID,
  label: 'Orders workspace',
  definitionRevision: '1',
  parseIntent,
});

function diagnostic(code: string, message: string): Outcome<never> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

function identityValues(ids: readonly string[]): readonly [Identity, ...Identity[]] {
  if (ids.length === 0) throw new TypeError('Workspace intents require one identity.');
  return ids.map((id) => ({ id })) as unknown as readonly [Identity, ...Identity[]];
}

function selectedIdsFromInput(intent: Intent): readonly string[] {
  if (intent.kind !== 'custom' || typeof intent.input !== 'object' || intent.input === null) return [];
  const input = intent.input as { readonly ids?: unknown; readonly identities?: readonly Identity[] };
  if (Array.isArray(input.ids)) return input.ids.filter((id): id is string => typeof id === 'string');
  return Array.isArray(input.identities)
    ? input.identities.filter((identity) => typeof identity?.id === 'string').map((identity) => identity.id)
    : [];
}

function modeForIntent(intent: Intent): LayoutMode {
  if (intent.kind !== 'custom' || typeof intent.input !== 'object' || intent.input === null) return 'single';
  const mode = (intent.input as { readonly mode?: unknown }).mode;
  return mode === 'split' || mode === 'compare' ? mode : 'single';
}

function compileSelectionTask(
  input: LayoutInput | SelectionInput,
  context: {
    readonly resource: typeof peopleFeature.resource;
    readonly regionId: string;
    readonly taskRevision: string;
  },
): Outcome<Task> {
  const ids = 'ids' in input ? input.ids : input.identities.map((identity) => identity.id);
  const identities = identityValues(ids);
  if (identities.length === 0 || identities.length > 2)
    return diagnostic('workspace.selection-bounds', 'Workspace selection must contain one or two identities.');
  const compareIntent: Intent = {
    version: '1',
    id: `workspace-selection-${context.taskRevision}`,
    resource: peopleFeature.id,
    kind: 'compare',
    identities,
    fields: ['id', 'name', 'team'],
  };
  return compileIntent(compareIntent, {
    resource: context.resource,
    regionId: context.regionId,
    taskRevision: context.taskRevision,
  });
}

function workspaceMappings(): readonly PresentationStateMappingManifest[] {
  return Object.freeze([
    {
      ref: { id: 'orders.workspace-table-detail', revision: '1' },
      from: TABLE,
      to: DETAIL,
      fromRole: 'table',
      toRole: 'detail',
      kind: 'transfer',
    },
    {
      ref: { id: 'orders.workspace-detail-table', revision: '1' },
      from: DETAIL,
      to: TABLE,
      fromRole: 'detail',
      toRole: 'table',
      kind: 'transfer',
    },
    {
      ref: { id: 'orders.workspace-split-table-archive', revision: '1' },
      from: SPLIT,
      to: TABLE,
      fromRole: 'structure',
      toRole: 'table',
      kind: 'archive',
    },
    {
      ref: { id: 'orders.workspace-split-detail-archive', revision: '1' },
      from: SPLIT,
      to: DETAIL,
      fromRole: 'structure',
      toRole: 'detail',
      kind: 'archive',
    },
    {
      ref: { id: 'orders.workspace-detail-table-archive', revision: '1' },
      from: DETAIL,
      to: TABLE,
      fromRole: 'detail',
      toRole: 'table',
      kind: 'archive',
    },
  ]);
}

function sameRef(left: { readonly id: string; readonly revision: string }, right: typeof TABLE): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function transferFor(
  previous: PresentationPlan['nodes'][number],
  target: PresentationPlan['nodes'][number],
  mappings: readonly PresentationStateMappingManifest[],
): PresentationPlan['stateTransfer'][number] | undefined {
  if (
    previous.id === target.id &&
    sameRef(previous.representation, target.representation) &&
    previous.role === target.role
  )
    return { fromNode: previous.id, toNode: target.id, mapping: { id: 'varendo.state.identity', revision: '1' } };
  const kind = previous.id === target.id ? 'transfer' : 'archive';
  const mapping = mappings.find(
    (candidate) =>
      candidate.from.id === previous.representation.id &&
      candidate.from.revision === previous.representation.revision &&
      candidate.to.id === target.representation.id &&
      candidate.to.revision === target.representation.revision &&
      candidate.fromRole === previous.role &&
      candidate.toRole === target.role &&
      candidate.kind === kind,
  );
  return mapping === undefined ? undefined : { fromNode: previous.id, toNode: target.id, mapping: mapping.ref };
}

function transfersFor(
  incumbent: PresentationPlan | undefined,
  nodes: readonly PresentationPlan['nodes'][number][],
  mappings: readonly PresentationStateMappingManifest[],
): Outcome<PresentationPlan['stateTransfer']> {
  if (incumbent === undefined) return { ok: true, value: [] };
  const targetRoot = nodes.find((node) => node.id === 'workspace') ?? nodes[0];
  if (targetRoot === undefined) return diagnostic('workspace.state-owner', 'Workspace layout has no state owner.');
  const transfers: Array<PresentationPlan['stateTransfer'][number]> = [];
  for (const previous of incumbent.nodes) {
    const sameId = nodes.find((node) => node.id === previous.id);
    const target = sameId ?? targetRoot;
    const transfer = transferFor(previous, target, mappings);
    if (transfer === undefined)
      return diagnostic('workspace.state-transfer', `No registered state mapping owns ${previous.id}.`);
    transfers.push(transfer);
  }
  return { ok: true, value: transfers };
}

function planForMode(
  context: RecipeContext,
  mode: LayoutMode,
  ids: readonly string[],
  mappings: readonly PresentationStateMappingManifest[],
): Outcome<PresentationPlan> {
  if (context.result === undefined) return diagnostic('workspace.result', 'Workspace presentation needs one Result.');
  const need = context.task.needs[0];
  if (need === undefined) return diagnostic('workspace.need', 'Workspace presentation needs one task need.');
  const columns = dataColumns(context, false);
  const identity = context.result.identity;
  const detail = (id: string, nodeId: string) => ({
    id: nodeId,
    role: 'detail',
    representation: DETAIL,
    result: context.result!.ref,
    config: {
      schema: VARENDO_DATA_CONFIG_SCHEMAS.detail,
      values: {
        fields: columns.map((column) => column.key),
        columns,
        identity,
        identityValues: { id },
        title: `Workspace ${id}`,
        showIdentity: true,
      },
    },
    children: [],
  });
  const table = {
    id: 'primary',
    role: 'table',
    representation: TABLE,
    result: context.result.ref,
    config: { schema: { id: 'data.table.config', revision: '1' }, values: { columns, selection: 'none' } },
    children: [],
  };
  const nodes =
    mode === 'single'
      ? [table]
      : mode === 'split'
        ? [
            {
              id: 'workspace',
              role: 'structure',
              representation: SPLIT,
              config: {
                schema: { id: 'foundation.split-pane.config', revision: '1' },
                values: {
                  bindingRevision: 'unconfigured',
                  orientation: 'horizontal',
                  position: 50,
                  min: 20,
                  max: 80,
                  step: 5,
                },
              },
              children: ['primary', 'secondary'],
            },
            table,
            detail(ids[0] ?? fixtureRows[0]!.id, 'secondary'),
          ]
        : [
            {
              id: 'workspace',
              role: 'structure',
              representation: SPLIT,
              config: {
                schema: { id: 'foundation.split-pane.config', revision: '1' },
                values: {
                  bindingRevision: 'unconfigured',
                  orientation: 'horizontal',
                  position: 50,
                  min: 20,
                  max: 80,
                  step: 5,
                },
              },
              children: ['primary', 'secondary'],
            },
            detail(ids[0] ?? fixtureRows[0]!.id, 'primary'),
            detail(ids[1] ?? fixtureRows[1]!.id, 'secondary'),
          ];
  const transfers = transfersFor(context.incumbent, nodes, mappings);
  if (!transfers.ok) return transfers;
  return {
    ok: true,
    value: {
      id: `workspace-${context.task.id}`.slice(0, 160),
      revision: context.task.revision,
      rootId: mode === 'single' ? 'primary' : 'workspace',
      preconditions: context.current,
      nodes,
      links: [],
      coverage: [
        {
          needId: need.id,
          nodeIds: mode === 'single' ? ['primary'] : ['primary', 'secondary'],
          operations: [need.operation],
        },
      ],
      stateTransfer: transfers.value,
      diagnostics: [],
    },
  };
}

function customInput(intent: Intent): LayoutInput | SelectionInput | undefined {
  if (intent.kind !== 'custom' || typeof intent.input !== 'object' || intent.input === null) return undefined;
  const input = intent.input as LayoutInput | SelectionInput;
  return input;
}

function layoutRecipe(mappings: readonly PresentationStateMappingManifest[]) {
  return defineRecipe({
    ref: { id: 'orders.workspace-recipe', revision: '1' },
    intents: [WORKSPACE_LAYOUT_REF, WORKSPACE_SELECTION_REF],
    build(context) {
      const input = customInput(context.intent);
      const ids = selectedIdsFromInput(context.intent);
      const mode =
        context.intent.kind === 'custom' && context.intent.intent.id === WORKSPACE_SELECTION_REF.id
          ? 'single'
          : (input as LayoutInput).mode;
      return planForMode(context, mode, ids, mappings);
    },
  });
}

function createIntentRegistry() {
  const definitions = [
    {
      ref: WORKSPACE_LAYOUT_REF,
      schema: z.object({
        mode: z.enum(['split', 'compare']),
        identities: z
          .array(z.object({ id: z.string().min(1).max(64) }))
          .min(1)
          .max(2),
      }),
      capabilities: ['data.read'],
      compile(
        input: LayoutInput,
        context: {
          readonly resource: typeof peopleFeature.resource;
          readonly regionId: string;
          readonly taskRevision: string;
        },
      ) {
        if (input.mode === 'compare' && input.identities.length !== 2)
          return diagnostic('workspace.compare-selection', 'Comparison requires exactly two identities.');
        return compileSelectionTask(input, context);
      },
    },
    {
      ref: WORKSPACE_SELECTION_REF,
      schema: z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(2) }),
      capabilities: ['data.read'],
      compile(
        input: SelectionInput,
        context: {
          readonly resource: typeof peopleFeature.resource;
          readonly regionId: string;
          readonly taskRevision: string;
        },
      ) {
        return compileSelectionTask(input, context);
      },
    },
  ] as const;
  const registry = createIntentCompilerRegistry(definitions);
  if (!registry.ok) throw new TypeError(registry.diagnostics[0]!.message);
  return registry.value;
}

function intentFor(ref: typeof WORKSPACE_LAYOUT_REF, mode: LayoutInput['mode'], ids: readonly string[]): Intent {
  return {
    version: '1',
    id: `orders-${mode}`,
    resource: peopleFeature.id,
    kind: 'custom',
    intent: ref,
    input: { mode, identities: identityValues(ids) },
  };
}

export function createWorkspaceFixture(): WorkspaceFixtureContract {
  const sourceFixture = createPeopleFixture();
  const mappings = workspaceMappings();
  const intentsRegistry = createIntentRegistry();
  const runtimeId = `workspace-runtime-${sourceFixture.runtimeId}`;
  const scopeId = sourceFixture.scope.getSnapshot().scopeInstanceId;
  const runtime = createVarendoRuntime({
    runtimeId,
    resources: [{ resource: peopleFeature.resource, data: sourceFixture.source }],
    intents: intentsRegistry,
    authority: {
      read: () => ({
        ok: true as const,
        value: {
          principalKey: 'local-user',
          scopeDigest: scopeId,
          policyRevision: 'local-policy-1',
          experienceRevision: 'workspace-experience-1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: 'local-user' },
        },
      }),
    },
  });
  const scope = runtime.createLocalSurfaceScope({ id: scopeId, allowedFeatures: [WORKSPACE_FEATURE_ID] });
  const mounted = runtime.mount({ regionId: REGION_ID, resourceId: peopleFeature.id });
  if (!mounted.ok) throw new TypeError(mounted.diagnostics[0]!.message);

  let selectedIds: readonly string[] = [];
  let disposed = false;
  let nextFailure: string | undefined;
  let gate: { readonly promise: Promise<void>; readonly release: () => void } | undefined;
  const children = new Map<string, SurfaceController<Intent, ChildState>>();
  const childState = new Map<string, ChildState>();
  const renderer: WorkspaceRenderer = {
    failNext(message = 'The workspace child renderer failed safely.') {
      nextFailure = message;
    },
    holdNext() {
      let releaseGate!: () => void;
      const promise = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      gate = { promise, release: releaseGate };
      return () => {
        if (gate?.promise === promise) {
          gate = undefined;
          releaseGate();
        }
      };
    },
  };

  const registryForReceipt = (receipt: RuntimeCommittedReceipt): PresentationRegistry | undefined => {
    const descriptors = receipt.outputs.flatMap((output) => {
      const snapshot = output.handle.snapshot();
      return snapshot.descriptor === undefined ? [] : [snapshot.descriptor];
    });
    const bindings = receipt.outputs.flatMap((output) => {
      const snapshot = output.handle.snapshot();
      if (snapshot.descriptor === undefined) return [];
      return [
        {
          ref: snapshot.descriptor.ref,
          rows: snapshot.batches.flatMap((batch) => batch.rows),
          columns: snapshot.descriptor.fields.map((field) => ({ key: field.id, label: field.label })),
        },
      ];
    });
    const base = registryFor(bindings, descriptors, [], peopleFeature.id);
    if (base === undefined) return undefined;
    const combined = createPresentationRegistry(base.manifests, base.mappings, base.patterns, [
      ...(base.stateMappings ?? []),
      ...mappings,
    ]);
    return combined.ok ? combined.value : undefined;
  };

  const recipe = layoutRecipe(mappings);
  let workspaceSurface!: SurfaceController<Intent, WorkspaceState>;
  workspaceSurface = runtime.createSurface<Intent, WorkspaceState>({
    scope,
    id: REGION_ID,
    feature: workspaceFeature,
    bindings: {
      initialIntent: { version: '1', id: 'workspace-initial', resource: peopleFeature.id, kind: 'browse' },
      initialState: { layout: 'single', selectedIds: [], children: [] },
      source: {
        kind: 'capability',
        read: async (intent, context) => {
          if (context.signal?.aborted) throw new Error('surface.request-aborted');
          if (gate !== undefined) {
            const activeGate = gate;
            await Promise.race([
              activeGate.promise,
              new Promise<void>((_, reject) =>
                context.signal?.addEventListener('abort', () => reject(new Error('surface.request-cancelled')), {
                  once: true,
                }),
              ),
            ]);
          }
          if (nextFailure !== undefined) {
            const failure = nextFailure;
            nextFailure = undefined;
            throw new Error(failure);
          }
          const receipt = await runtime.render({
            regionId: REGION_ID,
            intent,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          });
          if (receipt.status !== 'committed')
            throw new Error(receipt.diagnostics[0]?.code ?? 'workspace.render-failed');
          const registry = registryForReceipt(receipt);
          if (registry === undefined) throw new Error('workspace.registry-failed');
          const current = receipt.region.readSet;
          if (current === undefined) throw new Error('workspace.read-set-missing');
          const result = receipt.outputs[0]?.handle.snapshot().descriptor;
          if (result === undefined) throw new Error('workspace.result-missing');
          const currentPlan = runtime.snapshot(REGION_ID)?.region?.state?.presentation;
          const recipeContext = {
            intent: receipt.intent,
            task: receipt.task,
            result,
            current: withoutDataRevision(current),
            environment,
            availableViews: [],
            presentationPolicy: presentationPolicy(peopleFeature.resource),
            ...(currentPlan === undefined ? {} : { incumbent: currentPlan }),
          };
          const built =
            receipt.intent.kind === 'custom'
              ? recipe.build(recipeContext)
              : (() => {
                  const browseIntent: Intent = {
                    version: '1',
                    id: receipt.intent.id,
                    resource: peopleFeature.id,
                    kind: 'browse',
                  };
                  return recipeForStandard(recipeContext, browseIntent, currentPlan);
                })();
          if (!built.ok) throw new Error(built.diagnostics[0]!.code);
          const decision = resolvePresentation({
            id: built.value.id,
            revision: built.value.revision,
            preconditions: built.value.preconditions,
            context: {
              task: receipt.task,
              experience: experience(registry, 'workspace-experience-1', presentationPolicy(peopleFeature.resource)),
              results: [result],
              current: withoutDataRevision(current),
              environment,
              rendererCapabilities: registry.manifests.map((manifest) => manifest.ref),
              stateMappingCapabilities: (registry.stateMappings ?? []).map((mapping) => mapping.ref),
              ...(currentPlan === undefined ? {} : { incumbent: currentPlan }),
              explicitTransition: true,
            },
            registry,
            target: { address: workspaceSurface.address, state: 'active' },
            candidates: [{ id: `workspace.${modeForIntent(receipt.intent)}`, source: 'explicit', plan: built.value }],
          });
          if (decision.status !== 'ready') throw new Error(decision.diagnostic.code);
          const committed = await runtime.commitPresentation({
            regionId: REGION_ID,
            requestId: receipt.requestId,
            task: receipt.task,
            presentation: decision.plan.plan,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          });
          if (!committed.ok) throw new Error(committed.diagnostics[0]!.code);
          const mode = modeForIntent(receipt.intent);
          const nextSelected = selectedIdsFromInput(receipt.intent);
          if (receipt.intent.kind === 'custom' && receipt.intent.intent.id === WORKSPACE_SELECTION_REF.id)
            selectedIds = nextSelected;
          return {
            layout: mode,
            selectedIds,
            children: decision.plan.plan.nodes.filter((node) => node.children.length === 0).map((node) => node.id),
          } satisfies WorkspaceState;
        },
      },
    },
  });

  for (const nodeId of ['primary', 'secondary']) {
    const child = runtime.createSurface<Intent, ChildState>({
      scope,
      id: `workspace-child-${nodeId}`,
      feature: workspaceFeature,
      bindings: {
        initialIntent: { version: '1', id: `child-${nodeId}`, resource: peopleFeature.id, kind: 'browse' },
        initialState: { nodeId, revision: '0' },
        source: {
          kind: 'capability',
          read: async () => childState.get(nodeId) ?? { nodeId, revision: '0' },
        },
      },
    });
    children.set(nodeId, child);
  }

  const intents: WorkspaceIntents = Object.freeze({
    browse: { version: '1', id: 'orders-browse', resource: peopleFeature.id, kind: 'browse' } as Intent,
    get split() {
      const ids = selectedIds.length > 0 ? selectedIds : fixtureRows.map((row) => row.id);
      return intentFor(WORKSPACE_LAYOUT_REF, 'split', ids);
    },
    get compare() {
      const ids = selectedIds.length === 2 ? selectedIds : fixtureRows.map((row) => row.id);
      return intentFor(WORKSPACE_LAYOUT_REF, 'compare', ids);
    },
    select(ids: readonly string[]): Intent {
      return {
        version: '1',
        id: 'orders-selection',
        resource: peopleFeature.id,
        kind: 'custom',
        intent: WORKSPACE_SELECTION_REF,
        input: { ids: [...ids] },
      } as Intent;
    },
  });

  const view: WorkspaceView = {
    snapshot() {
      const state = runtime.snapshot(REGION_ID);
      const plan = state?.region?.state?.presentation;
      if (plan === undefined) return undefined;
      const root = plan.nodes.find((node) => node.id === plan.rootId);
      const layout: LayoutMode =
        root?.representation.id === SPLIT.id
          ? plan.nodes.some((node) => node.id === 'primary' && node.representation.id === DETAIL.id)
            ? 'compare'
            : 'split'
          : 'single';
      const planSelected = plan.nodes.flatMap((node) => {
        const values = node.config.values;
        const identities = values.identityValues;
        if (
          node.representation.id !== DETAIL.id ||
          identities === null ||
          typeof identities !== 'object' ||
          Array.isArray(identities)
        )
          return [];
        const id = (identities as { readonly id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      });
      const childBindings = plan.nodes
        .filter((node) => node.children.length === 0)
        .flatMap((node) => {
          const child = children.get(node.id);
          if (child === undefined) return [];
          return [{ nodeId: node.id, address: child.address, ownerSurfaceId: child.id }];
        });
      return Object.freeze({
        layout,
        selectedIds: Object.freeze(planSelected.length > 0 ? planSelected : [...selectedIds]),
        scopeEpoch: scope.getSnapshot().activationEpoch,
        scopeInstanceId: scope.getSnapshot().scopeInstanceId,
        runtimeId: scope.getSnapshot().runtimeId,
        plan,
        children: Object.freeze(childBindings),
      });
    },
    selectThroughControl(ids) {
      return workspaceSurface.request(intents.select(ids));
    },
  };

  return {
    surface: workspaceSurface,
    scope,
    intents,
    view,
    renderer,
    dispose() {
      if (disposed) return;
      disposed = true;
      workspaceSurface.dispose();
      for (const child of children.values()) child.dispose();
      runtime.dispose();
      scope.dispose();
      sourceFixture.dispose();
    },
  };
}

function recipeForStandard(
  context: RecipeContext,
  intent: Intent,
  incumbent: PresentationPlan | undefined,
): Outcome<PresentationPlan> {
  return standardDataRecipe.build({ ...context, intent, ...(incumbent === undefined ? {} : { incumbent }) });
}
