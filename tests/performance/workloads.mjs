/**
 * Production-package workload fixtures used by the browser and Node probes.
 *
 * These are deliberately bounded probes. They report the work they perform
 * and the input scope so a result cannot be mistaken for a whole-page or
 * backend capacity claim.
 */
import { composePresentation } from '@varendo/core/presentation';
import {
  createAeliqoPresentationRegistry,
  AELIQO_CONFIG_SCHEMAS,
  AELIQO_OPERATION_REFS,
  AELIQO_PRESENTATION_REFS,
} from '@varendo/web/region';
import { createInteractionController, createInteractionGraph } from '@varendo/runtime/interaction';
import { createRegionStore } from '@varendo/runtime/regions';
import { createResultStore } from '@varendo/runtime/results';

export const SMALL_ROW_COUNT = 100;
export const MEDIUM_ROW_COUNT = 10_000;
export const MEDIUM_VIEW_COUNT = 30;
export const MEDIUM_FIELD_COUNT = 100;
const MEDIUM_CANDIDATE_COUNT = 64;
export const LARGE_TRANSFERRED_ROW_COUNT = 100;

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const FIRST_SAMPLE_COUNT = 10;
const SUBSEQUENT_SAMPLE_COUNT = 30;
let plannerObservation = 0;

export function percentile(values, percentileValue) {
  if (!Number.isFinite(percentileValue) || percentileValue <= 0 || percentileValue > 1)
    throw new Error('A percentile fraction in (0, 1] is required.');
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Finite nonnegative observations are required.');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? 0;
}

function summary(values) {
  return {
    count: values.length,
    minMs: values.length === 0 ? 0 : Math.min(...values),
    maxMs: values.length === 0 ? 0 : Math.max(...values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

/**
 * First/subsequent observations deliberately avoid claiming a process or
 * browser-cache cold start. The caller owns the page/context lifecycle when
 * a true cold-cache measurement is needed; this helper measures a repeatable
 * first invocation and reuse of one already-loaded page/process.
 */
export async function firstSubsequent(label, operation, options = {}) {
  const firstCount = options.firstCount ?? FIRST_SAMPLE_COUNT;
  const subsequentCount = options.subsequentCount ?? SUBSEQUENT_SAMPLE_COUNT;
  const firstMs = [];
  const subsequentMs = [];
  const firstResults = [];
  const subsequentResults = [];
  for (let index = 0; index < firstCount; index += 1) {
    const started = now();
    firstResults.push(await operation('first', index));
    firstMs.push(now() - started);
  }
  for (let index = 0; index < subsequentCount; index += 1) {
    const started = now();
    subsequentResults.push(await operation('subsequent', index));
    subsequentMs.push(now() - started);
  }
  return {
    label,
    first: { rawMs: firstMs, ...summary(firstMs) },
    subsequent: { rawMs: subsequentMs, ...summary(subsequentMs) },
    results: { first: firstResults, subsequent: subsequentResults },
    sampleCounts: { first: firstCount, subsequent: subsequentCount },
    condition: 'first/subsequent reuse in one process or page',
  };
}

export function makeRows(count, fieldCount = 4) {
  const rows = [];
  // Share field names within setup; every row and cell value is still created anew.
  const fieldKeys = [];
  if (count > 0) {
    for (let field = 1; field < fieldCount; field += 1) fieldKeys[field] = `field-${String(field).padStart(3, '0')}`;
  }
  for (let index = 0; index < count; index += 1) {
    const row = { id: `row-${index + 1}`, label: `Row ${index + 1}`, value: index };
    for (let field = 1; field < fieldCount; field += 1) row[fieldKeys[field]] = `v-${index}-${field}`;
    rows.push(row);
  }
  return rows;
}

export function semanticFields(count = MEDIUM_FIELD_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' };
    return {
      id: `field-${String(index).padStart(3, '0')}`,
      label: `Field ${index}`,
      type: { value: 'text', nullable: true },
      role: 'attribute',
    };
  });
}

function mediumResult() {
  const ref = {
    id: 'performance-medium-result',
    revision: '1',
    outputId: 'rows',
    queryDigest: 'performance-medium-query',
    scopeDigest: 'performance-medium-scope',
  };
  const fields = semanticFields();
  return {
    version: '1',
    ref,
    taskId: 'performance-medium-task',
    fields,
    identity: ['id'],
    rowGrain: ['id'],
    counts: {
      loaded: MEDIUM_ROW_COUNT,
      population: { kind: 'exact', value: MEDIUM_ROW_COUNT, populationDigest: 'performance-medium-population' },
    },
    precision: { kind: 'exact' },
    coverage: { kind: 'complete', populationDigest: 'performance-medium-population' },
    consistency: { kind: 'snapshot', snapshotId: 'performance-medium-snapshot', sourceRevisions: { records: '1' } },
    evidence: { kind: 'observed', source: { id: 'performance-medium-source', revision: '1' } },
    filters: [],
    warnings: [],
    lineage: [],
  };
}

function mediumContext() {
  const result = mediumResult();
  const needs = Array.from({ length: MEDIUM_VIEW_COUNT }, (_, index) => ({
    id: `view-${String(index + 1).padStart(2, '0')}`,
    operation: AELIQO_OPERATION_REFS.read,
    outputId: result.ref.outputId,
    fields: [result.fields[index + 1]?.id ?? 'id'],
    required: true,
  }));
  const task = {
    version: '1',
    id: 'performance-medium-task',
    revision: 'performance-task-1',
    catalogRevision: 'performance-catalog-1',
    functionRegistryDigest: 'performance-functions-1',
    regionId: 'performance-medium-region',
    goal: 'Render the medium workload',
    kind: 'presentation',
    needs,
    assumptions: [],
    inputs: [result.ref],
  };
  const current = {
    scopeDigest: 'performance-medium-scope',
    policyRevision: 'performance-policy-1',
    taskRevision: task.revision,
    regionRevision: 'performance-region-1',
    catalogRevision: task.catalogRevision,
    experienceRevision: 'performance-experience-1',
    functionRegistryDigest: task.functionRegistryDigest,
    results: [result.ref],
  };
  const experience = {
    version: '1',
    id: 'performance-medium-experience',
    revision: current.experienceRevision,
    mode: 'composable',
    agentAllowed: false,
    allowedRepresentations: [AELIQO_PRESENTATION_REFS.stack.id, AELIQO_PRESENTATION_REFS.table.id],
    allowedPatterns: [],
    composition: { allowWithoutPreset: true, maxNodes: 64, maxExpansions: MEDIUM_CANDIDATE_COUNT },
    requiredOperations: [],
    tokenProfile: { id: 'tokens.default', revision: '1' },
    extensionAllowlist: [],
    transitionPolicy: 'stable',
  };
  const environment = {
    inlineSize: { state: 'known', value: 1280 },
    blockSize: { state: 'known', value: 900 },
    textScale: { state: 'known', value: 1 },
    pointer: 'fine',
    hover: 'available',
    keyboard: 'available',
    locale: 'en-US',
    direction: 'ltr',
    reducedMotion: false,
    forcedColors: false,
  };
  return { result, task, current, experience, environment };
}

export function mediumPlan() {
  const { result, task, current, experience, environment } = mediumContext();
  const nodes = [
    {
      id: 'layout',
      role: 'structure',
      representation: AELIQO_PRESENTATION_REFS.stack,
      config: { schema: AELIQO_CONFIG_SCHEMAS.stack, values: {} },
      children: [],
    },
  ];
  const tableNodes = [];
  for (let index = 0; index < MEDIUM_VIEW_COUNT; index += 1) {
    const id = `view-${String(index + 1).padStart(2, '0')}`;
    tableNodes.push({
      id,
      role: 'table',
      representation: AELIQO_PRESENTATION_REFS.table,
      result: result.ref,
      config: { schema: AELIQO_CONFIG_SCHEMAS.table, values: { selection: 'none' } },
      children: [],
    });
  }
  nodes[0].children = tableNodes.map((node) => node.id);
  nodes.push(...tableNodes);
  const plan = {
    id: 'performance-medium-plan',
    revision: 'performance-plan-1',
    rootId: 'layout',
    preconditions: current,
    nodes,
    links: [],
    coverage: task.needs.map((need, index) => ({
      needId: need.id,
      nodeIds: [tableNodes[index]?.id ?? 'view-01'],
      operations: [AELIQO_OPERATION_REFS.read],
    })),
    stateTransfer: [],
    diagnostics: [],
  };
  const registryResult = createAeliqoPresentationRegistry({ resolveEntity: () => 'record' });
  if (!registryResult.ok)
    throw new Error(`presentation registry unavailable: ${registryResult.diagnostics[0]?.message ?? 'unknown error'}`);
  const context = {
    task,
    experience,
    results: [result],
    current,
    environment,
    rendererCapabilities: [AELIQO_PRESENTATION_REFS.stack, AELIQO_PRESENTATION_REFS.table],
  };
  const candidates = Array.from({ length: MEDIUM_CANDIDATE_COUNT }, (_, gap) => ({
    source: 'explicit',
    plan: {
      ...plan,
      nodes: plan.nodes.map((node, index) =>
        index === 0 ? { ...node, config: { ...node.config, values: { gap } } } : node,
      ),
    },
  }));
  return { context, registry: registryResult.value, plan, candidates, rowFieldCount: MEDIUM_FIELD_COUNT };
}

export function runMediumPlanner(options = {}) {
  const timed = options.timed !== false;
  const workload = mediumPlan();
  const started = timed ? now() : undefined;
  const composed = composePresentation(
    {
      id: 'performance-medium-composition',
      revision: 'performance-composition-1',
      preconditions: workload.context.current,
      context: workload.context,
      candidates: workload.candidates,
    },
    workload.registry,
  );
  const finished = timed ? now() : undefined;
  const timing = timed ? { durationMs: finished - started } : {};
  // Record the captured interval after timing it; tracing work is outside durationMs.
  if (timed && typeof globalThis.performance?.measure === 'function')
    globalThis.performance.measure('aeliqo.presentation.compose', {
      start: started,
      end: finished,
      detail: { observation: ++plannerObservation },
    });
  if (!composed.ok) throw new Error(`medium composition failed: ${JSON.stringify(composed.diagnostics)}`);
  return {
    ...timing,
    status: composed.value.status,
    expansions: composed.value.expansions,
    nodes: composed.value.presentation?.plan.nodes.length ?? 0,
    candidateCount: MEDIUM_CANDIDATE_COUNT,
    rowCount: MEDIUM_ROW_COUNT,
    viewCount: MEDIUM_VIEW_COUNT,
    fieldCount: MEDIUM_FIELD_COUNT,
    rowFieldCount: workload.rowFieldCount,
  };
}

export async function runTargetedReducer(iterations = 100, options = {}) {
  const timed = options.timed !== false;
  const authority = {
    principalKey: 'performance-principal',
    scopeDigest: 'performance-reducer-scope',
    policyRevision: 'performance-reducer-policy',
    catalogRevision: 'performance-reducer-catalog',
    experienceRevision: 'performance-reducer-experience',
    functionRegistryDigest: 'performance-reducer-functions',
    results: [],
  };
  const task = {
    version: '1',
    id: 'performance-reducer-task',
    revision: 'performance-reducer-task-1',
    catalogRevision: authority.catalogRevision,
    functionRegistryDigest: authority.functionRegistryDigest,
    regionId: 'performance-reducer-region',
    goal: 'Edit a bounded draft',
    kind: 'presentation',
    needs: [],
    assumptions: [],
    inputs: [],
  };
  const store = createRegionStore({
    readAuthority: () => ({ ok: true, value: authority }),
    authorizeCommit: async () => ({ ok: true, value: undefined }),
  });
  const created = store.create({ id: task.regionId, state: { task } });
  if (!created.ok) throw new Error(`reducer region failed: ${created.diagnostics[0]?.message ?? 'unknown error'}`);
  const region = created.value;
  const graph = createInteractionGraph({
    nodes: [
      { id: 'editor', ports: [{ id: 'draft', direction: 'output', payload: 'draft' }] },
      { id: 'unrelated', ports: [{ id: 'draft', direction: 'input', payload: 'draft' }] },
    ],
    links: [],
    mappings: [],
  });
  const host = () => ({
    principalKey: authority.principalKey,
    draftDomain: 'performance',
    actor: { id: 'performance-user', kind: 'user' },
    grants: ['experience.commit', 'draft.edit'],
    scopeDigest: authority.scopeDigest,
    policyRevision: authority.policyRevision,
    catalogRevision: authority.catalogRevision,
    experienceRevision: authority.experienceRevision,
    functionRegistryDigest: authority.functionRegistryDigest,
    results: [],
  });
  const controller = createInteractionController({
    region,
    graph,
    readContext: host,
    validateDraft: () => ({ ok: true, value: undefined }),
  });
  const durations = [];
  let successful = 0;
  let unrelatedRoutes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const event = {
      eventId: `draft-${index + 1}`,
      causationId: `cause-${index + 1}`,
      regionId: task.regionId,
      regionRevision: region.snapshot().regionRevision,
      originNodeId: 'editor',
      payload: {
        kind: 'draft',
        entity: 'record',
        key: 'row-1',
        field: 'field-001',
        value: `draft-${index + 1}`,
        entityRevision: '1',
      },
    };
    const started = timed ? now() : undefined;
    const outcome = await controller.dispatch(event, { sourcePortId: 'draft' });
    if (timed) durations.push(now() - started);
    if (outcome.ok) {
      successful += 1;
      unrelatedRoutes += outcome.value.routed.filter((item) => item.route.nodeId === 'unrelated').length;
    }
  }
  const finalState = controller.state();
  controller.dispose();
  graph.dispose();
  store.dispose();
  return {
    iterations,
    successful,
    unrelatedRoutes,
    finalDraftCount: finalState.drafts.length,
    ...(timed ? { rawMs: durations, ...summary(durations) } : {}),
  };
}

/** Exercise the owning runtime leases/observers/controllers, not only DOM removal. */
export function runRuntimeResourceCycles(cycles = 100) {
  let retainedHandles = 0;
  let liveRegions = 0;
  let openObservers = 0;
  for (let index = 0; index < cycles; index += 1) {
    const resultStore = createResultStore({ maxEntries: 1 });
    const cacheKey = {
      principalKey: 'performance-cleanup-principal',
      scopeDigest: 'performance-cleanup-scope',
      policyRevision: 'performance-cleanup-policy',
      queryDigest: 'performance-cleanup-query',
      catalogRevision: 'performance-cleanup-catalog',
      functionRegistryDigest: 'performance-cleanup-functions',
      sourceRevision: 'performance-cleanup-source',
      outputId: 'rows',
      taskId: 'performance-cleanup-task',
    };
    const handle = resultStore.begin({ ...cacheKey, requestId: `cleanup-${index + 1}` });
    handle.dispose();
    if (resultStore.get(cacheKey) !== undefined) retainedHandles += 1;
    resultStore.dispose();

    const regionId = `performance-cleanup-region-${index + 1}`;
    const authority = {
      principalKey: 'performance-cleanup-principal',
      scopeDigest: 'performance-cleanup-scope',
      policyRevision: 'performance-cleanup-policy',
      catalogRevision: 'performance-cleanup-catalog',
      experienceRevision: 'performance-cleanup-experience',
      functionRegistryDigest: 'performance-cleanup-functions',
      results: [],
    };
    const task = {
      version: '1',
      id: 'performance-cleanup-task',
      revision: 'performance-cleanup-task-1',
      catalogRevision: authority.catalogRevision,
      functionRegistryDigest: authority.functionRegistryDigest,
      regionId,
      goal: 'Own a disposable region',
      kind: 'presentation',
      needs: [],
      assumptions: [],
      inputs: [],
    };
    const regionStore = createRegionStore({
      readAuthority: () => ({ ok: true, value: authority }),
      authorizeCommit: async () => ({ ok: true, value: undefined }),
    });
    const created = regionStore.create({ id: regionId, state: { task } });
    if (!created.ok) throw new Error(`cleanup region failed: ${created.diagnostics[0]?.message ?? 'unknown error'}`);
    const region = created.value;
    const observer = region.observe(() => {});
    const graph = createInteractionGraph({
      nodes: [{ id: 'editor', ports: [{ id: 'draft', direction: 'output', payload: 'draft' }] }],
      links: [],
      mappings: [],
    });
    const controller = createInteractionController({
      region,
      graph,
      readContext: () => ({
        principalKey: authority.principalKey,
        draftDomain: 'performance',
        actor: { id: 'performance-user', kind: 'user' },
        grants: ['experience.commit', 'draft.edit'],
        scopeDigest: authority.scopeDigest,
        policyRevision: authority.policyRevision,
        catalogRevision: authority.catalogRevision,
        experienceRevision: authority.experienceRevision,
        functionRegistryDigest: authority.functionRegistryDigest,
        results: [],
      }),
    });
    controller.dispose();
    graph.dispose();
    region.dispose();
    if (!observer.closed) openObservers += 1;
    if (regionStore.get(regionId) !== undefined) liveRegions += 1;
    regionStore.dispose();
  }
  return {
    cycles,
    retainedHandles,
    liveRegions,
    openObservers,
    bounded: retainedHandles === 0 && liveRegions === 0 && openObservers === 0,
  };
}

export function environmentSnapshot() {
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof navigator !== 'undefined')
    return {
      runtime: 'browser',
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
      devicePixelRatio: globalThis.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    };
  return { runtime: 'node', node: process.version, platform: process.platform, arch: process.arch };
}
