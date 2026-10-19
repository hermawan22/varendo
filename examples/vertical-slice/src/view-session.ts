import {
  composePresentation,
  validatePresentationPlan,
  type PresentationContext,
  type PresentationRegistry,
  type ValidatedPresentation,
} from '@varendo/core/presentation';
import type { CommitPreconditions, Experience, Outcome, PresentationPlan, ResultRef, Task } from '@varendo/core';
import type { TaskEvaluation } from '@varendo/runtime/evaluation';
import { createRegionStore, type RegionHandle, type RegionReadSet, type RegionStore } from '@varendo/runtime/regions';
import { createInteractionController, createInteractionGraph } from '@varendo/runtime/interaction';
import type { MaterializedTaskOutput } from '@varendo/runtime/evaluation';
import {
  VARENDO_PRESENTATION_REFS,
  createVarendoPresentationRegistry,
  type VarendoRegionResult,
  type VarendoSemanticInteractionRequest,
} from '@varendo/web/region';
import { stableTableRowKey } from '@varendo/web/table';
import { catalog, functionRegistry, initialTask } from './hr.js';
import { createHrDataSession, policyRevision, principalKey, refKey, scopeDigest } from './data-session.js';

const experience: Experience = {
  version: '1',
  id: 'hr-experience',
  revision: '1',
  mode: 'composable',
  agentAllowed: false,
  allowedRepresentations: Object.values(VARENDO_PRESENTATION_REFS).map((ref) => ref.id),
  allowedPatterns: [],
  composition: { allowWithoutPreset: true, maxNodes: 12, maxExpansions: 24 },
  requiredOperations: [],
  tokenProfile: { id: 'tokens.default', revision: '1' },
  extensionAllowlist: [],
  transitionPolicy: 'stable',
};
const unknownEnvironment: PresentationContext['environment'] = {
  inlineSize: { state: 'unknown' },
  blockSize: { state: 'unknown' },
  textScale: { state: 'unknown' },
  pointer: 'unknown',
  hover: 'unknown',
  keyboard: 'unknown',
  locale: 'en-US',
  direction: 'ltr',
  reducedMotion: false,
  forcedColors: false,
};
const unwrap = <T>(result: Outcome<T>): T => {
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join('; '));
  return result.value;
};
const pins = ({ dataRevision: _dataRevision, ...value }: RegionReadSet): CommitPreconditions => value;

type DataSession = ReturnType<typeof createHrDataSession>;
type OutputMap = Map<string, MaterializedTaskOutput>;
type ContextFactory = (task: Task, current: CommitPreconditions, incumbent?: PresentationPlan) => PresentationContext;

interface OutputAccess {
  rankedRows(): VarendoRegionResult['rows'];
  rowKey(row: VarendoRegionResult['rows'][number]): ReturnType<typeof stableTableRowKey>;
  refs(): ResultRef[];
}

interface PresentationPointer {
  current: ValidatedPresentation | undefined;
}

interface HrViewState {
  data: DataSession;
  task: Task;
  outputs: OutputMap;
  access: OutputAccess;
  region: RegionHandle;
  regions: RegionStore;
  registry: PresentationRegistry;
  context: ContextFactory;
  presentation: PresentationPointer;
  listeners: Set<() => void>;
  serial: { value: number };
  observer: ReturnType<RegionHandle['observe']>;
  graph: ReturnType<typeof createInteractionGraph>;
  interactions: ReturnType<typeof createInteractionController>;
  synchronize(): void;
}

function createOutputAccess(data: DataSession, outputs: OutputMap): OutputAccess {
  const rowKey = (row: VarendoRegionResult['rows'][number]) => stableTableRowKey(row, ['employee_id']);
  return {
    rankedRows: () =>
      data.permitted
        ? (outputs
            .get('ranking')
            ?.handle.snapshot()
            .batches.flatMap((batch) => batch.rows) ?? [])
        : [],
    rowKey,
    refs: () => [...outputs.values()].map((output) => output.ref),
  };
}

function createRegistry(data: DataSession): PresentationRegistry {
  return unwrap(
    createVarendoPresentationRegistry({
      resolveEntity: (result) => {
        const handle = data.resolveResult(result.ref);
        if (!data.permitted || handle?.snapshot().descriptor === undefined) return undefined;
        return result.identity.length === 1 && result.identity[0] === 'employee_id' ? 'employees' : undefined;
      },
    }),
  );
}

function createContextFactory(outputs: OutputMap): ContextFactory {
  return (task, current, incumbent) => ({
    task,
    experience,
    results: [...outputs.values()].flatMap((output) => (output.descriptor === undefined ? [] : [output.descriptor])),
    current,
    environment: unknownEnvironment,
    rendererCapabilities: Object.values(VARENDO_PRESENTATION_REFS),
    ...(incumbent === undefined ? {} : { incumbent }),
  });
}

function createRegionStoreForSession(
  data: DataSession,
  access: OutputAccess,
  context: ContextFactory,
  registry: PresentationRegistry,
): RegionStore {
  return createRegionStore({
    readAuthority: () =>
      data.permitted
        ? {
            ok: true,
            value: {
              principalKey,
              scopeDigest,
              policyRevision,
              catalogRevision: catalog.revision,
              experienceRevision: experience.revision,
              functionRegistryDigest: functionRegistry.digest,
              results: access.refs(),
            },
          }
        : {
            ok: false,
            diagnostics: [{ code: 'runtime.region-denied', message: 'Fixture access revoked.', retryable: false }],
          },
    authorizeCommit: ({ state, current }) => {
      if (!data.permitted || current.readSet === undefined || state.presentation === undefined)
        return {
          ok: false,
          diagnostics: [
            { code: 'runtime.region-denied', message: 'No authorized presentation is available.', retryable: false },
          ],
        };
      const checked = validatePresentationPlan(
        state.presentation,
        context(state.task, pins(current.readSet), current.state?.presentation),
        registry,
      );
      if (checked.ok) return { ok: true, value: undefined };
      return {
        ok: false,
        diagnostics: [
          {
            code: 'runtime.region-invalid',
            message: checked.diagnostics.map((diagnostic) => diagnostic.message).join('; '),
            retryable: false,
          },
        ],
      };
    },
  });
}

async function mountInitialPresentation(
  task: Task,
  evaluated: TaskEvaluation,
  region: RegionHandle,
  context: ContextFactory,
  registry: PresentationRegistry,
): Promise<ValidatedPresentation> {
  const initialPins = pins(region.snapshot().readSet!);
  const composed = unwrap(
    composePresentation(
      { id: 'hr-composition', revision: '1', preconditions: initialPins, context: context(task, initialPins) },
      registry,
    ),
  );
  if (composed.presentation === undefined) throw new Error(JSON.stringify(composed.rejected));
  const token = unwrap(
    await region.stage({
      requestId: 'initial-presentation',
      expected: region.snapshot().readSet!,
      state: { task, presentation: composed.presentation.plan },
      resultHandles: evaluated.outputs.map((output) => output.handle),
    }),
  );
  unwrap(await region.commit(token));
  evaluated.release();
  return composed.presentation;
}

function createSynchronizer(
  region: RegionHandle,
  presentation: PresentationPointer,
  listeners: Set<() => void>,
): () => void {
  return () => {
    const snapshot = region.snapshot();
    if (snapshot.status !== 'active' || snapshot.state?.presentation === undefined) presentation.current = undefined;
    else if (presentation.current !== undefined)
      presentation.current = { ...presentation.current, plan: snapshot.state.presentation };
    for (const listener of listeners) listener();
  };
}

function createInteractions(
  data: DataSession,
  region: RegionHandle,
  graph: ReturnType<typeof createInteractionGraph>,
  outputs: OutputMap,
  access: OutputAccess,
) {
  return createInteractionController({
    region,
    graph,
    readContext: () => ({
      principalKey,
      draftDomain: 'synthetic-hr',
      actor: { id: principalKey, kind: 'user' },
      grants: data.permitted ? ['result.inspect', 'experience.commit'] : [],
      scopeDigest,
      policyRevision,
      catalogRevision: catalog.revision,
      experienceRevision: experience.revision,
      functionRegistryDigest: functionRegistry.digest,
      results: access.refs(),
    }),
    resolveResult: (ref) => data.resolveResult(ref),
    validateSelection: (selection) => {
      if (selection.mode === 'clear') return { ok: true, value: undefined };
      if (selection.mode !== 'ids' || selection.entity !== 'employees') {
        return {
          ok: false,
          diagnostics: [
            {
              code: 'runtime.interaction-denied',
              message: 'Only the ranked employee identities can be selected.',
              retryable: false,
            },
          ],
        };
      }
      const ranking = outputs.get('ranking');
      const permittedKeys = new Set(access.rankedRows().map(access.rowKey));
      if (
        ranking !== undefined &&
        refKey(selection.result) === refKey(ranking.ref) &&
        selection.keys.every((key) => permittedKeys.has(key))
      )
        return { ok: true, value: undefined };
      return {
        ok: false,
        diagnostics: [
          {
            code: 'runtime.interaction-denied',
            message: 'The selection is outside this ranked population.',
            retryable: false,
          },
        ],
      };
    },
  });
}

function createReorderProposal(state: HrViewState) {
  const current = state.region.snapshot();
  if (current.state?.presentation === undefined || current.readSet === undefined)
    throw new Error('No current presentation.');
  const previous = current.state.presentation;
  const { outputs: _outputs, ...base } = initialTask();
  const nextTask: Task = {
    ...base,
    revision: current.taskRevision,
    kind: 'presentation',
    inputs: state.access.refs(),
    goal: 'Reorder the existing ranking and trend views.',
  };
  const revision = ++state.serial.value;
  const candidate: PresentationPlan = {
    ...previous,
    revision: `view-${revision}`,
    preconditions: pins(current.readSet),
    nodes: previous.nodes.map((node) =>
      node.id === previous.rootId ? { ...node, children: [...node.children].reverse() } : node,
    ),
    stateTransfer: previous.nodes.map((node) => ({
      fromNode: node.id,
      toNode: node.id,
      mapping: { id: 'varendo.state.identity', revision: '1' },
    })),
  };
  return { candidate, nextTask, expected: current.readSet, previous };
}

async function reorderPresentation(state: HrViewState): Promise<void> {
  const proposal = createReorderProposal(state);
  const checked = unwrap(
    validatePresentationPlan(
      proposal.candidate,
      state.context(proposal.nextTask, pins(proposal.expected), proposal.previous),
      state.registry,
    ),
  );
  const staged = unwrap(
    await state.region.stage({
      requestId: `reorder-${state.serial.value}`,
      expected: proposal.expected,
      state: { task: proposal.nextTask, presentation: checked.plan },
    }),
  );
  unwrap(await state.region.commit(staged));
  state.presentation.current = { ...checked, plan: state.region.snapshot().state!.presentation! };
  state.synchronize();
}

async function refuseStaleProposal(state: HrViewState) {
  const proposal = createReorderProposal(state);
  unwrap(
    await state.region.publishData({
      results: state.access.refs(),
      reason: 'Fixture data epoch advanced before a delayed proposal.',
    }),
  );
  const staged = await state.region.stage({
    requestId: `stale-${state.serial.value}`,
    expected: proposal.expected,
    state: { task: proposal.nextTask, presentation: proposal.candidate },
  });
  if (staged.ok) {
    state.region.discard(staged.value);
    throw new Error('A stale candidate was accepted.');
  }
  return staged.diagnostics;
}

function dispatchInteraction(state: HrViewState, request: VarendoSemanticInteractionRequest) {
  const eventId = `user-${++state.serial.value}`;
  return state.interactions.dispatch(
    {
      eventId,
      causationId: eventId,
      regionId: state.task.regionId,
      regionRevision: state.region.snapshot().regionRevision,
      originNodeId: request.nodeId,
      payload: request.payload,
    },
    { sourcePortId: request.portId },
  );
}

function createReadMethods(state: HrViewState) {
  return {
    selectionKey(employeeId: string) {
      const row = state.access.rankedRows().find((row) => row.employee_id === employeeId);
      return row === undefined ? undefined : state.access.rowKey(row);
    },
    selectionLabel(key: string) {
      const id = state.access.rankedRows().find((row) => state.access.rowKey(row) === key)?.employee_id;
      return typeof id === 'string' ? id : undefined;
    },
    subscribe(listener: () => void) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
}

function currentResults(outputs: OutputMap): readonly VarendoRegionResult[] {
  return [...outputs.values()].flatMap((output) =>
    output.handle.snapshot().descriptor === undefined
      ? []
      : [
          {
            ref: output.ref,
            rows: output.handle.snapshot().batches.flatMap((batch) => batch.rows) as VarendoRegionResult['rows'],
          },
        ],
  );
}

function createCommandMethods(state: HrViewState) {
  return {
    dispatch(request: VarendoSemanticInteractionRequest) {
      return dispatchInteraction(state, request);
    },
    reorder() {
      return reorderPresentation(state);
    },
    refuseStaleProposal() {
      return refuseStaleProposal(state);
    },
    revoke() {
      state.interactions.revoke('Fixture access revoked.');
      state.data.revoke();
      state.region.revoke('Fixture access revoked.');
      state.synchronize();
    },
    dispose() {
      state.observer.unsubscribe();
      state.interactions.dispose();
      state.graph.dispose();
      state.regions.dispose();
      state.data.dispose();
      state.listeners.clear();
    },
  };
}

/** Application integration of the same evaluator, commit store, interaction controller and web registry. */
export async function createHrViewSession() {
  const data = createHrDataSession();
  let cleanupRegions: (() => void) | undefined;
  try {
    const task = initialTask();
    const evaluated = await data.evaluate(task);
    const outputs = new Map<string, MaterializedTaskOutput>(
      evaluated.outputs.map((output) => [output.outputId, output]),
    );
    const access = createOutputAccess(data, outputs);
    const listeners = new Set<() => void>();
    const serial = { value: 0 };
    const presentation: PresentationPointer = { current: undefined };
    const registry = createRegistry(data);
    const context = createContextFactory(outputs);
    const regions = createRegionStoreForSession(data, access, context, registry);
    cleanupRegions = () => regions.dispose();
    const region = unwrap(regions.create({ id: task.regionId, state: { task } }));
    presentation.current = await mountInitialPresentation(task, evaluated, region, context, registry);
    const synchronize = createSynchronizer(region, presentation, listeners);
    synchronize();
    const observer = region.observe(synchronize);
    const graph = createInteractionGraph(presentation.current.graph);
    const interactions = createInteractions(data, region, graph, outputs, access);
    const state: HrViewState = {
      data,
      task,
      outputs,
      access,
      region,
      regions,
      registry,
      context,
      presentation,
      listeners,
      serial,
      observer,
      graph,
      interactions,
      synchronize,
    };
    return {
      data,
      region,
      ...createReadMethods(state),
      get presentation() {
        return state.presentation.current;
      },
      get results() {
        return currentResults(state.outputs);
      },
      get interaction() {
        return state.region.snapshot().state?.interaction;
      },
      ...createCommandMethods(state),
    };
  } catch (error) {
    cleanupRegions?.();
    data.dispose();
    throw error;
  }
}
export type HrViewSession = Awaited<ReturnType<typeof createHrViewSession>>;
