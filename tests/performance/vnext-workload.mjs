/**
 * vNext controller/module-scale qualification.
 *
 * This is deliberately a Node controller-commit profile: it does not claim
 * browser event-to-paint, GC heap, remote throughput, or physical-device data.
 * Those remain the existing browser, heap-lifecycle, and adverse-runtime gates.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { defineDataFeature } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createAeliqoRuntime, createLocalDataBinding } from '@varendo/runtime';
import { z } from 'zod';

const root = resolve(import.meta.dirname, '../..');
const repetitions = 5;
const interactionsPerRepetition = 100;
const activeSurfaces = 5;
const schema = z.object({ id: z.string(), name: z.string(), team: z.enum(['Design', 'Engineering']) });
const rows = Object.freeze(
  Array.from({ length: 1_000 }, (_, index) => ({
    id: `person-${index + 1}`,
    name: `Person ${index + 1}`,
    team: index % 2 === 0 ? 'Engineering' : 'Design',
  })),
);

const sourceCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

function percentile(values, fraction) {
  if (values.length === 0) throw new TypeError('A percentile requires samples.');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples) {
  return {
    count: samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}

function featureDefinitions(count) {
  return Array.from({ length: count }, (_, index) =>
    defineDataFeature({
      id: `performance-module-${String(index + 1).padStart(4, '0')}`,
      schema,
      identity: ['id'],
      fields: { team: { role: 'dimension' } },
    }),
  );
}

function createModuleWorkload(count) {
  const definitions = featureDefinitions(count);
  const feature = definitions[0];
  if (feature === undefined) throw new TypeError('A module workload requires one feature.');
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  let sourceReads = 0;
  let normalizations = 0;
  const bindings = createLocalDataBinding({
    feature,
    snapshot: { catalog: feature.catalog, sourceRevision: 'performance-module-1', records: { [feature.id]: rows } },
    initialState: Object.freeze({ rows: Object.freeze([]) }),
    coverage: {
      fields: ['id', 'name', 'team'],
      operators: ['eq', 'contains'],
      pagination: 'snapshot',
      stableOrder: ['id'],
      sorting: 'stable-fields-only',
      aggregation: 'unsupported',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['aggregation', 'streaming', 'live-updates'],
    },
    normalize: async (events) => {
      normalizations += 1;
      const result = [];
      for await (const event of events) {
        if (event.kind === 'error') throw new TypeError(event.error.message);
        if (event.kind !== 'batch') continue;
        result.push(...event.rows);
      }
      return Object.freeze({ rows: Object.freeze(result) });
    },
    serviceOptions: {
      functionRegistry: functions.value,
      authorize: () => ({ ok: true, value: { scopeDigest: 'performance-module-scope', policyRevision: '1' } }),
    },
  });
  const source = bindings.service;
  const countedService = {
    ...source,
    async *execute(...args) {
      sourceReads += 1;
      yield* source.execute(...args);
    },
  };
  const runtime = createAeliqoRuntime({
    runtimeId: `performance-module-runtime-${count}`,
    resources: [{ resource: feature.resource, data: source }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'performance-user',
          scopeDigest: 'performance-module-scope',
          policyRevision: '1',
          experienceRevision: '1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: 'performance-user' },
        },
      }),
    },
  });
  const scope = runtime.createLocalSurfaceScope({ id: `performance-module-${count}`, allowedFeatures: [feature.id] });
  const notifications = Array.from({ length: activeSurfaces }, () => 0);
  const surfaces = Array.from({ length: activeSurfaces }, (_, index) =>
    runtime.createSurface({
      scope,
      id: `performance-active-${index + 1}`,
      feature,
      bindings: {
        ...bindings,
        source: { ...bindings.source, service: countedService },
      },
    }),
  );
  const unsubscribers = surfaces.map((surface, index) =>
    surface.subscribe(() => {
      notifications[index] = (notifications[index] ?? 0) + 1;
    }),
  );
  return {
    declaredFeatures: definitions.length,
    activeSurfaceCount: surfaces.length,
    async changeFirst() {
      const result = await surfaces[0].request({
        kind: 'browse',
        filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
      });
      if (result.status !== 'committed') throw new TypeError(`Controller request was ${result.status}.`);
    },
    observation() {
      return { sourceReads, normalizations, notifications: [...notifications] };
    },
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const surface of surfaces) surface.dispose();
      runtime.dispose();
      scope.dispose();
    },
  };
}

async function measureTier(declaredFeatureCount) {
  const repetitionsReport = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const workload = createModuleWorkload(declaredFeatureCount);
    const rawInteractionMs = [];
    try {
      for (let interaction = 0; interaction < interactionsPerRepetition; interaction += 1) {
        const started = performance.now();
        await workload.changeFirst();
        rawInteractionMs.push(performance.now() - started);
      }
      const observation = workload.observation();
      if (observation.notifications.slice(1).some((count) => count !== 0))
        throw new TypeError('An unrelated active surface received a notification.');
      repetitionsReport.push({
        repetition: repetition + 1,
        rawInteractionMs,
        summary: summarize(rawInteractionMs),
        declaredFeatures: workload.declaredFeatures,
        activeSurfaces: workload.activeSurfaceCount,
        sourceReads: observation.sourceReads,
        normalizations: observation.normalizations,
        listenerNotifications: observation.notifications,
      });
    } finally {
      workload.dispose();
    }
  }
  const rawInteractionMs = repetitionsReport.flatMap((item) => item.rawInteractionMs);
  return {
    declaredFeatureCount,
    activeSurfaceCount: activeSurfaces,
    repetitions: repetitionsReport,
    interaction: { rawMs: rawInteractionMs, ...summarize(rawInteractionMs), budgetMsP95: 100 },
    status: percentile(rawInteractionMs, 0.95) <= 100 ? 'pass' : 'fail',
  };
}

const tiers = [];
for (const declaredFeatureCount of [10, 100, 1_000]) tiers.push(await measureTier(declaredFeatureCount));
const outputDirectory = process.env.AELIQO_PERFORMANCE_OUTPUT ?? join(root, 'artifacts/performance-workloads');
await mkdir(outputDirectory, { recursive: true });
const report = {
  task: 'T19',
  requirements: ['RQ27', 'RQ28'],
  sourceCommit,
  environment: {
    runtime: 'node-controller-commit',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? null,
    totalMemoryBytes: totalmem(),
  },
  workload: {
    syntheticRows: rows.length,
    repetitions,
    interactionsPerRepetition,
    activeSurfaces,
    moduleTiers: [10, 100, 1_000],
  },
  tiers,
  qualification: tiers.every((tier) => tier.status === 'pass') ? 'pass' : 'fail',
  limits: [
    'This is controller request-to-commit latency in Node, not browser event-to-paint.',
    'No remote database, provider/model request, or physical-device throughput is included.',
    'Heap qualification requires the existing GC-enabled browser heap-lifecycle gate; this report does not claim it.',
    'Installed-tarball bytes and no-agent import graph are covered by the existing bundle gate and the packaging task.',
  ],
};
const output = join(outputDirectory, `vnext-module-scale-${Date.now()}.json`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      output,
      qualification: report.qualification,
      tiers: tiers.map((tier) => ({
        count: tier.declaredFeatureCount,
        p95Ms: tier.interaction.p95Ms,
        status: tier.status,
      })),
    },
    null,
    2,
  ),
);
if (report.qualification !== 'pass') process.exitCode = 1;
