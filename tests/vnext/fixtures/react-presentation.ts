import type { Experience, PresentationPlan, Result, Task, VersionRef } from '@varendo/core';
import {
  createPresentationRegistry,
  type PresentationManifest,
  type PresentationResolverInput,
} from '@varendo/core/presentation';
import { environment, experience, presentationPlan, presentationTask, result } from '../../contracts/fixtures.js';

export const tableRef = { id: 'data.table', revision: '1' } as const;
export const listRef = { id: 'data.list', revision: '1' } as const;
const read = { id: 'data.read', revision: '1' } as const;

function manifest(ref: VersionRef, quality: number): PresentationManifest {
  return {
    ref,
    configSchema: { id: `${ref.id}.config`, revision: '1' },
    roles: ['browse'],
    operations: [read],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: false,
    resolveConfig: (values, descriptor) =>
      descriptor === undefined
        ? { ok: false, diagnostics: [{ code: 'config.result', message: 'A result is required.', retryable: false }] }
        : { ok: true, value: { values, fields: descriptor.fields.map((field) => field.id), ports: [] } },
    assess: () => ({
      ok: true,
      value: { taskFit: quality, informationDensity: 0, interactionEffort: 0, legibilityPenalty: 0 },
    }),
  };
}

function candidate(id: string, ref: VersionRef): PresentationResolverInput['candidates'][number] {
  const plan: PresentationPlan = {
    ...presentationPlan,
    rootId: `${id}-node`,
    nodes: [
      {
        id: `${id}-node`,
        role: 'browse',
        representation: ref,
        result: result.ref,
        config: { schema: { id: `${ref.id}.config`, revision: '1' }, values: {} },
        children: [],
      },
    ],
    coverage: [{ needId: 'browse', nodeIds: [`${id}-node`], operations: [read] }],
  };
  return { id, source: 'explicit', plan };
}

/** Package-typed resolver evidence for the installed React adapter boundary. */
export function reactPresentationFixture(): PresentationResolverInput {
  const task: Task = {
    ...presentationTask,
    needs: [{ id: 'browse', operation: read, fields: ['employee.id'], outputId: 'rows', required: true }],
  };
  const allowed: Experience = {
    ...experience,
    mode: 'composable',
    allowedRepresentations: [tableRef.id, listRef.id],
  };
  const descriptor: Result = result;
  const created = createPresentationRegistry([manifest(tableRef, 20), manifest(listRef, 90)]);
  if (!created.ok) throw new Error(created.diagnostics[0].message);
  return {
    id: 'react-resolver-request',
    revision: '1',
    preconditions: presentationPlan.preconditions,
    context: {
      task,
      experience: allowed,
      results: [descriptor],
      current: presentationPlan.preconditions,
      environment,
      rendererCapabilities: [tableRef, listRef],
    },
    registry: created.value,
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
  };
}
