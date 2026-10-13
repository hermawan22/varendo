import { expect, it } from 'vitest';
import { compileIntent, type Intent } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createPresentationRegistry, resolvePresentation } from '@varendo/core/presentation';
import { createVarendoRuntime, createLocalDataBinding } from '@varendo/runtime';
import { createVarendoPresentationRegistry } from '@varendo/web/region';
import {
  REGION,
  GOAL,
  PATTERN,
  METRIC,
  ROLES,
  REF,
  feature,
  goalRegistry,
  overviewPattern,
} from '../../examples/vnext/workspace/goal.js';

it('commits a registered summary, daily trend, and employee breakdown workspace without inventing anomaly', async () => {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const binding = createLocalDataBinding({
    feature,
    snapshot: {
      catalog: feature.catalog,
      sourceRevision: 'attendance-1',
      records: {
        attendance: [
          { id: 'a', employee: 'Ada', day: '2026-09-01', team: 'Engineering', present: 1 },
          { id: 'b', employee: 'Sam', day: '2026-09-02', team: 'Engineering', present: 1 },
          { id: 'c', employee: 'Lee', day: '2026-09-02', team: 'Design', present: 1 },
        ],
      },
    },
    initialState: { rows: [] },
    coverage: {
      fields: ['id', 'employee', 'day', 'team', 'present'],
      metrics: [METRIC],
      operators: ['eq'],
      pagination: 'snapshot',
      stableOrder: ['id'],
      sorting: 'stable-fields-only',
      aggregation: 'registered-only',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['streaming', 'live-updates'],
    },
    normalize: async () => ({ rows: [] }),
    serviceOptions: {
      functionRegistry: functions.value,
      authorize: () => ({ ok: true, value: { scopeDigest: 'attendance-scope', policyRevision: '1' } }),
    },
  });
  const intents = goalRegistry();
  const runtime = createVarendoRuntime({
    runtimeId: 'attendance-runtime',
    resources: [{ resource: feature.resource, data: binding.service }],
    intents,
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'attendance-user',
          scopeDigest: 'attendance-scope',
          policyRevision: '1',
          experienceRevision: '1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: 'attendance-user' },
        },
      }),
    },
  });
  try {
    const mounted = runtime.mount({ regionId: REGION, resourceId: feature.id });
    expect(mounted.ok).toBe(true);
    const intent: Intent = {
      version: '1',
      id: 'attendance-overview',
      resource: feature.id,
      kind: 'custom',
      intent: GOAL,
      input: { team: 'Engineering' },
    };
    const lowered = compileIntent(intent, { resource: feature.resource, regionId: REGION, customIntents: intents });
    expect(lowered.ok).toBe(true);
    if (!lowered.ok) return;
    expect(lowered.value.needs.map((need) => need.id)).toEqual([...ROLES]);
    expect(lowered.value.needs).toHaveLength(3);
    expect(lowered.value.needs.every((need) => need.required && need.simultaneousGroup === 'overview')).toBe(true);
    expect(lowered.value.kind).toBe('data');
    if (lowered.value.kind !== 'data') return;
    expect(lowered.value.outputs).toHaveLength(3);

    const receipt = await runtime.render({ regionId: REGION, intent });
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed');
    if (receipt.status !== 'committed') return;
    expect(receipt.outputs).toHaveLength(3);
    expect(receipt.outputs.map((output) => output.outputId)).toEqual([...ROLES]);
    const rows = Object.fromEntries(
      receipt.outputs.map((output) => [
        output.outputId,
        output.handle.snapshot().batches.flatMap((batch) => batch.rows),
      ]),
    );
    expect(rows.summary).toHaveLength(1);
    expect(rows.trend).toHaveLength(2);
    expect(rows.breakdown).toHaveLength(2);
    expect(rows.summary?.map((row) => row[METRIC.id])).toEqual([2]);
    expect(rows.trend?.map((row) => row[METRIC.id])).toEqual([1, 1]);
    expect(rows.breakdown?.map((row) => row[METRIC.id])).toEqual([1, 1]);
    expect(JSON.stringify(rows)).not.toContain('Lee');
    const results = receipt.outputs.map((output) => output.handle.snapshot().descriptor);
    expect(results.every((result) => result !== undefined)).toBe(true);
    if (results.some((result) => result === undefined)) return;
    const descriptors = results as NonNullable<(typeof results)[number]>[];
    const current = receipt.region.readSet;
    expect(current).toBeDefined();
    if (current === undefined) return;
    const { dataRevision: _dataRevision, ...preconditions } = current;
    const registered = createVarendoPresentationRegistry({
      data: receipt.outputs.map((output, index) => ({
        result: descriptors[index]!,
        rows: output.handle.snapshot().batches.flatMap((batch) => batch.rows),
        columns: descriptors[index]!.fields.map((field) => ({ key: field.id, label: field.label })),
      })),
      visualizations: receipt.outputs.map((output, index) => ({
        result: descriptors[index]!,
        context: { results: [descriptors[index]!] },
        datasets: [
          { result: descriptors[index]!.ref, rows: output.handle.snapshot().batches.flatMap((batch) => batch.rows) },
        ],
      })),
      resolveEntity: () => feature.id,
    });
    expect(registered.ok, JSON.stringify(registered)).toBe(true);
    if (!registered.ok) return;
    const withPattern = createPresentationRegistry(registered.value.manifests, registered.value.mappings, [
      overviewPattern(),
    ]);
    expect(withPattern.ok, JSON.stringify(withPattern)).toBe(true);
    if (!withPattern.ok) return;
    const decision = resolvePresentation({
      id: 'attendance-resolve',
      revision: '1',
      preconditions,
      context: {
        task: receipt.task,
        experience: {
          version: '1',
          id: 'attendance-experience',
          revision: preconditions.experienceRevision,
          mode: 'composable',
          agentAllowed: false,
          allowedRepresentations: Object.values(REF).map((ref) => ref.id),
          allowedPatterns: [PATTERN.id],
          composition: { allowWithoutPreset: false, maxNodes: 4, maxExpansions: 8 },
          requiredOperations: [],
          tokenProfile: { id: 'tokens.default', revision: '1' },
          extensionAllowlist: [],
          transitionPolicy: 'stable',
        },
        results: descriptors,
        current: preconditions,
        environment: {
          inlineSize: { state: 'known', value: 1024 },
          blockSize: { state: 'known', value: 720 },
          textScale: { state: 'unknown' },
          pointer: 'fine',
          hover: 'available',
          keyboard: 'available',
          locale: 'en-US',
          direction: 'ltr',
          reducedMotion: false,
          forcedColors: false,
        },
        rendererCapabilities: Object.values(REF),
      },
      registry: withPattern.value,
      target: {
        address: {
          runtimeId: 'attendance-runtime',
          scopeInstanceId: 'attendance-scope',
          activationEpoch: 1,
          surfaceId: REGION,
          surfaceGeneration: 1,
        },
        state: 'active',
      },
      candidates: [],
    });
    expect(decision.status, JSON.stringify(decision)).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.receipt.selectedCandidate).toBe('registered');
    expect(decision.plan.plan.id).toBe('attendance-resolve');
    expect(decision.plan.plan.nodes).toHaveLength(4);
    expect(decision.plan.plan.coverage.map((entry) => entry.needId)).toEqual([...ROLES]);
    const committed = await runtime.commitPresentation({
      regionId: REGION,
      requestId: receipt.requestId,
      task: receipt.task,
      presentation: decision.plan.plan,
    });
    expect(committed.ok).toBe(true);
    expect(runtime.snapshot(REGION)?.region?.state?.presentation?.nodes.map((node) => node.role)).toEqual([
      'structure',
      'metric',
      'trend',
      'table',
    ]);
    const committedPresentation = runtime.snapshot(REGION)?.region?.state?.presentation;

    for (const unknown of ['attendance.unknown', 'attendance.anomaly']) {
      const attempt = await runtime.render({
        regionId: REGION,
        intent: { ...intent, id: `reject-${unknown}`, intent: { id: unknown, revision: '1' } },
      });
      expect(attempt.status).toBe('unsupported');
      expect(attempt.diagnostics[0]?.code).toBe('intent.unknown-custom');
      expect(runtime.snapshot(REGION)?.region?.state?.presentation).toEqual(committedPresentation);
    }
  } finally {
    runtime.dispose();
  }
});
