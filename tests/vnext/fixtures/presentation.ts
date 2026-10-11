import { createPresentationRegistry } from '../../../packages/core/src/presentation/index.js';
import type {
  PresentationContext,
  PresentationManifest,
  PresentationRegistry,
  PresentationResolverInput,
} from '../../../packages/core/src/presentation/index.js';
import type { PresentationPlan, VersionRef } from '../../../packages/core/src/contracts/types.js';
import { environment, experience, presentationPlan, presentationTask, result } from '../../contracts/fixtures.js';

export const read = { id: 'data.read', revision: '1' } as const;
export const analyze = { id: 'data.analyze', revision: '1' } as const;
export const tableRef = { id: 'data.table', revision: '1' } as const;
export const listRef = { id: 'data.list', revision: '1' } as const;
export const cardRef = { id: 'data.card-collection', revision: '1' } as const;
export const trendRef = { id: 'data.trend', revision: '1' } as const;

interface ManifestOptions {
  readonly roles?: readonly string[];
  readonly operations?: readonly VersionRef[];
  readonly result?: PresentationManifest['result'];
  readonly children?: PresentationManifest['children'];
  readonly visibility?: PresentationManifest['visibility'];
}

export function manifest(ref: VersionRef, quality = 0, options: ManifestOptions = {}): PresentationManifest {
  return {
    ref,
    configSchema: { id: ref.id + '.config', revision: '1' },
    roles: options.roles ?? ['browse'],
    operations: options.operations ?? [read],
    result: options.result ?? 'required',
    children: options.children ?? { min: 0, max: 0 },
    visibility: options.visibility ?? 'leaf',
    extension: false,
    resolveConfig: (values, descriptor) =>
      descriptor === undefined && (options.result ?? 'required') !== 'none'
        ? { ok: false, diagnostics: [{ code: 'config.result', message: 'A result is required.', retryable: false }] }
        : {
            ok: true,
            value: { values, fields: descriptor?.fields.map((field) => field.id) ?? [], ports: [] },
          },
    assess: () => ({
      ok: true,
      value: { taskFit: quality, informationDensity: 0, interactionEffort: 0, legibilityPenalty: 0 },
    }),
  };
}

export function registry(
  entries: readonly PresentationManifest[] = [manifest(tableRef), manifest(listRef)],
): PresentationRegistry {
  const created = createPresentationRegistry(entries);
  if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
  return created.value;
}

interface CandidateOptions {
  readonly role?: string;
  readonly operation?: VersionRef;
  readonly children?: readonly string[];
  readonly needId?: string;
}

export function candidate(
  id: string,
  ref: VersionRef = tableRef,
  options: CandidateOptions = {},
): PresentationResolverInput['candidates'][number] {
  const plan: PresentationPlan = {
    ...presentationPlan,
    rootId: id + '-node',
    nodes: [
      {
        id: id + '-node',
        role: options.role ?? 'browse',
        representation: ref,
        result: result.ref,
        config: { schema: { id: ref.id + '.config', revision: '1' }, values: {} },
        children: options.children ?? [],
      },
    ],
    coverage: [
      { needId: options.needId ?? 'browse', nodeIds: [id + '-node'], operations: [options.operation ?? read] },
    ],
  };
  return { id, source: 'explicit', plan };
}

export function context(): PresentationContext {
  return {
    task: {
      ...presentationTask,
      needs: [{ id: 'browse', operation: read, fields: ['employee.id'], outputId: 'rows', required: true }],
    },
    experience: {
      ...experience,
      mode: 'composable',
      allowedRepresentations: [tableRef.id, listRef.id],
      composition: { ...experience.composition, maxExpansions: 8 },
    },
    results: [result],
    current: presentationPlan.preconditions,
    environment: { ...environment },
    rendererCapabilities: [tableRef, listRef],
  };
}

export function fixture(overrides: Partial<PresentationResolverInput> = {}): PresentationResolverInput {
  return {
    id: 'resolver-request',
    revision: '1',
    preconditions: presentationPlan.preconditions,
    context: context(),
    registry: registry(),
    target: {
      address: {
        runtimeId: 'runtime',
        scopeInstanceId: 'scope',
        activationEpoch: 1,
        surfaceId: 'region-1',
        surfaceGeneration: 1,
      },
      state: 'active',
    },
    candidates: [candidate('table', tableRef), candidate('list', listRef)],
    ...overrides,
  };
}

/**
 * A real resolver envelope for the ambiguous trend path: one authorized time
 * field and two authorized measures, with no arbitrary measure preference.
 */
export function twoMetricTrendFixture(): PresentationResolverInput {
  const trendResult = {
    ...result,
    fields: [
      { id: 'date', label: 'Date', type: { value: 'date' as const, nullable: false }, role: 'time' as const },
      {
        id: 'profit',
        label: 'Profit',
        type: { value: 'decimal' as const, nullable: false },
        role: 'measure' as const,
      },
      {
        id: 'revenue',
        label: 'Revenue',
        type: { value: 'decimal' as const, nullable: false },
        role: 'measure' as const,
      },
    ],
    identity: ['date'],
    rowGrain: ['date'],
  };
  const trendContext: PresentationContext = {
    task: {
      ...presentationTask,
      needs: [
        {
          id: 'trend',
          operation: analyze,
          fields: ['date', 'profit', 'revenue'],
          outputId: 'rows',
          required: true,
        },
      ],
    },
    experience: {
      ...experience,
      mode: 'composable',
      allowedRepresentations: [trendRef.id],
      composition: { ...experience.composition, maxExpansions: 8 },
    },
    results: [trendResult],
    current: { ...presentationPlan.preconditions },
    environment: { ...environment },
    rendererCapabilities: [trendRef],
  };

  return {
    id: 'trend-resolver-request',
    revision: '1',
    preconditions: presentationPlan.preconditions,
    context: trendContext,
    registry: registry([manifest(trendRef, 0, { roles: ['trend'], operations: [analyze] })]),
    target: {
      address: {
        runtimeId: 'runtime',
        scopeInstanceId: 'scope',
        activationEpoch: 1,
        surfaceId: 'region-1',
        surfaceGeneration: 1,
      },
      state: 'active',
    },
    candidates: [candidate('trend', trendRef, { role: 'trend', operation: analyze, needId: 'trend' })],
    clarification: {
      kind: 'measure',
      representation: trendRef,
      diagnostic: { code: 'presentation.ambiguous-measure', message: 'Choose a measure.', retryable: false },
      choices: [
        { id: 'profit', label: 'Profit' },
        { id: 'revenue', label: 'Revenue' },
      ],
    },
  };
}
