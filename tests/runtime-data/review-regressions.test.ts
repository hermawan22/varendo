import { describe, expect, it, vi } from 'vitest';
import { type Catalog, type MeaningDefinition, type QuerySpec } from '../../packages/core/src/index.js';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import {
  createLocalDataService,
  parseResultEvent,
  type DataRecord,
  type LocalSnapshot,
  type QueryBudget,
  type ResultEvent,
} from '../../packages/runtime/src/data/index.js';

const registry = createStandardFunctionRegistry();
if (!registry.ok) throw new Error('standard registry unavailable');
const functionRegistryDigest = registry.value.digest;
const budget: QueryBudget = {
  maxRows: 100,
  maxBytes: 500_000,
  maxMessages: 8,
  maxMilliseconds: 10_000,
  maxColumns: 20,
};

const fields = [
  { id: 'id', label: 'ID', type: { value: 'text' as const, nullable: false }, role: 'identity' as const },
  { id: 'group', label: 'Group', type: { value: 'text' as const, nullable: false }, role: 'dimension' as const },
  {
    id: 'numerator',
    label: 'Numerator',
    type: { value: 'integer' as const, nullable: false },
    role: 'measure' as const,
  },
  {
    id: 'denominator',
    label: 'Denominator',
    type: { value: 'integer' as const, nullable: false },
    role: 'measure' as const,
  },
];
const rateMeaning: MeaningDefinition = {
  id: 'metric.rate',
  revision: '1',
  label: 'Rate',
  explanation: 'Pooled rate',
  output: { value: 'float', nullable: true },
  implementation: {
    kind: 'expression',
    expression: {
      kind: 'call',
      function: { id: 'core.ratio-of-sums.unknown', revision: '1' },
      arguments: [
        { kind: 'field', ref: 'numerator' },
        { kind: 'field', ref: 'denominator' },
      ],
    },
  },
  dependencies: [],
  functionRegistryDigest,
  origin: 'system',
  lifecycle: 'active',
  scope: 'workspace',
  authority: 'approved',
  aggregation: 'ratio-of-sums',
  aggregationDimensions: [],
  missingPolicy: 'exclude-pair',
};
const catalog: Catalog = {
  version: '1',
  revision: 'review-catalog-1',
  functionRegistryDigest,
  entities: [{ id: 'facts', label: 'Facts', identity: ['id'], rowGrain: ['id'], fields }],
  relationships: [],
  meanings: [rateMeaning],
  capabilities: [],
};
const rows: readonly DataRecord[] = Array.from({ length: 20 }, (_, index) => ({
  id: `row-${index}`,
  group: `group-${index}`,
  numerator: 1,
  denominator: 0,
}));
const snapshot = (sourceRevision = 'review-source-1'): LocalSnapshot => ({
  catalog,
  sourceRevision,
  records: { facts: rows },
});
const query: QuerySpec = {
  entity: 'facts',
  fields: ['group'],
  measures: [{ id: rateMeaning.id, revision: rateMeaning.revision }],
  relations: [],
  groupBy: ['group'],
  population: { kind: 'all-authorized' },
  order: [],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function collect(
  service: ReturnType<typeof createLocalDataService>,
  accepted: Exclude<Awaited<ReturnType<typeof service.plan>>, { ok: false }>['value'],
): Promise<ResultEvent[]> {
  const events: ResultEvent[] = [];
  for await (const event of service.execute(accepted)) events.push(event);
  return events;
}

describe('independent review regressions', () => {
  it('keeps unknown warnings within the result wire diagnostic bound', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const planned = await service.plan({
      version: '1',
      requestId: 'warning-overflow-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'warning-overflow-plan', outputId: 'facts-output' },
      query,
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const events = await collect(service, planned.value);
    const descriptor = events.find(
      (event): event is Extract<ResultEvent, { kind: 'descriptor' }> => event.kind === 'descriptor',
    );
    expect(descriptor).toBeDefined();
    if (descriptor === undefined) return;
    expect(descriptor.descriptor.warnings.length).toBeLessThanOrEqual(16);
    for (const event of events) expect(parseResultEvent(event).ok).toBe(true);
  });

  it('rejects a source replacement that races the first plan digest', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const digestStarted = deferred<void>();
    const releaseDigest = deferred<ArrayBuffer>();
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => {
      digestStarted.resolve();
      return releaseDigest.promise;
    });
    try {
      const planning = service.plan({
        version: '1',
        requestId: 'digest-race-plan',
        catalogRevision: catalog.revision,
        target: { taskId: 'digest-race-plan', outputId: 'facts-output' },
        query: { ...query, measures: [], groupBy: [], fields: ['id'] },
        budget,
      });
      await digestStarted.promise;
      expect(service.replaceSnapshot(snapshot('review-source-2'))).toMatchObject({ ok: true });
      const originalDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('release'));
      releaseDigest.resolve(originalDigest);
      const planned = await planning;
      expect(planned).toMatchObject({ ok: false, diagnostics: [{ code: 'data.stale-plan' }] });
    } finally {
      digestSpy.mockRestore();
    }
  });

  it('rejects a source replacement that races the execute result digest as stale', async () => {
    const service = createLocalDataService({ snapshot: snapshot() });
    const planned = await service.plan({
      version: '1',
      requestId: 'execute-digest-race-plan',
      catalogRevision: catalog.revision,
      target: { taskId: 'execute-digest-race-plan', outputId: 'facts-output' },
      query,
      budget,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const digestStarted = deferred<void>();
    const releaseDigest = deferred<ArrayBuffer>();
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => {
      digestStarted.resolve();
      return releaseDigest.promise;
    });
    try {
      const executing = collect(service, planned.value);
      await digestStarted.promise;
      expect(service.replaceSnapshot(snapshot('review-source-2'))).toMatchObject({ ok: true });
      releaseDigest.resolve(new Uint8Array(32).buffer);
      const events = await executing;
      expect(events).toMatchObject([
        { kind: 'error', requestId: 'execute-digest-race-plan', error: { code: 'data.stale-plan' } },
      ]);
      expect(events).toHaveLength(1);
    } finally {
      digestSpy.mockRestore();
    }
  });
});
