import { readFileSync } from 'node:fs';
import { parseTask, parseWireValue, type Catalog, type Outcome, type Result, type Task } from '@varendo/core';
import { createStandardFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService, type DataRecord, type QueryBudget } from '../../packages/runtime/src/data/index.js';
import { createResultStore, type ResultHandle } from '../../packages/runtime/src/results/index.js';
import {
  createResultCohortResolver,
  createTaskEvaluator,
  type TrustedEvaluationContext,
} from '../../packages/runtime/src/evaluation/index.js';
import { createAgentCapabilityRegistry } from '../../packages/agent/src/capabilities/registry.js';
import { createAgentToolEndpoint } from '../../packages/agent/src/protocol/endpoint.js';
import type { AgentJsonValue, AgentCapabilityManifest } from '../../packages/agent/src/capabilities/types.js';
import type { AgentToolTransport } from '../../packages/agent/src/protocol/types.js';
export interface EvaluationFixture {
  readonly id: string;
  readonly catalog: Catalog;
  readonly records: Readonly<Record<string, readonly DataRecord[]>>;
  readonly sourceRevision: string;
  readonly scopeDigest: string;
  readonly principalKey: string;
  readonly regionId: string;
  readonly goalEpoch: string;
  readonly budget: QueryBudget;
}
export interface EvaluatedOutput {
  readonly descriptor: Result;
  readonly rows: readonly DataRecord[];
}
export interface EvaluationObservation {
  readonly stage: 'evaluate' | 'inspect';
  readonly elapsedMs: number;
  readonly task?: Task;
  readonly outputs?: readonly EvaluatedOutput[];
  readonly diagnostics?: readonly string[];
}
const fail = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});
const schema = JSON.parse(
  readFileSync(new URL('../../packages/core/schemas/task.schema.json', import.meta.url), 'utf8'),
) as { oneOf: Record<string, unknown>[]; $defs: Record<string, unknown> };
const dataSchema = {
  ...schema.oneOf.find((branch) => (branch.properties as Record<string, { const?: string }>)?.kind?.const === 'data'),
  $defs: schema.$defs,
};
const key = (ref: Result['ref']) =>
  JSON.stringify([ref.id, ref.revision, ref.outputId, ref.queryDigest, ref.scopeDigest]);
/** An application-owned synthetic fixture host around production ports. No answer oracle is exposed here. */
export function createEvaluationHost(fixture: EvaluationFixture, transport: AgentToolTransport = 'manual') {
  const functions = createStandardFunctionRegistry();
  if (!functions.ok || functions.value.digest !== fixture.catalog.functionRegistryDigest)
    throw Error('Fixture registry digest must match the exact production registry.');
  let revoked = false;
  let epoch = fixture.goalEpoch;
  const observations: EvaluationObservation[] = [];
  const handles = new Map<string, ResultHandle>();
  const store = createResultStore({ maxEntries: 64, maxBytes: 2_000_000, ttlMs: 300_000 });
  const service = createLocalDataService({
    snapshot: { catalog: fixture.catalog, sourceRevision: fixture.sourceRevision, records: fixture.records },
    hostBudget: fixture.budget,
    sourceLimits: { rows: 10000, bytes: 1_000_000 },
    authorize: () =>
      revoked
        ? fail('evaluation.revoked', 'Fixture authority was revoked.')
        : { ok: true, value: { scopeDigest: fixture.scopeDigest, policyRevision: 'eval-policy-1' } },
  });
  const cohortResolver = createResultCohortResolver();
  const context = (): TrustedEvaluationContext => ({
    principalKey: fixture.principalKey,
    scopeDigest: fixture.scopeDigest,
    policyRevision: 'eval-policy-1',
    catalogRevision: fixture.catalog.revision,
    functionRegistryDigest: functions.value.digest,
    grants: revoked ? [] : ['task.evaluate', 'result.inspect'],
    catalog: fixture.catalog,
    data: service,
    resultStore: store,
    readContext: { principal: fixture.principalKey },
    cohortResolver,
    resolveResult: (ref) => handles.get(key(ref)),
    now: Date.now,
    budget: fixture.budget,
  });
  const evaluator = createTaskEvaluator({
    host: {
      readContext: () =>
        revoked ? fail('evaluation.revoked', 'Fixture authority was revoked.') : { ok: true, value: context() },
    },
    budget: fixture.budget,
    maxMilliseconds: fixture.budget.maxMilliseconds,
  });
  async function evaluate(input: unknown, signal?: AbortSignal): Promise<Outcome<readonly EvaluatedOutput[]>> {
    const start = performance.now();
    const parsed = parseTask(input);
    if (!parsed.ok) {
      observations.push({
        stage: 'evaluate',
        elapsedMs: performance.now() - start,
        diagnostics: parsed.diagnostics.map((item) => item.code),
      });
      return parsed;
    }
    if (parsed.value.regionId !== fixture.regionId || parsed.value.kind !== 'data') {
      observations.push({ stage: 'evaluate', elapsedMs: performance.now() - start, diagnostics: ['evaluation.scope'] });
      return fail('evaluation.scope', 'This host evaluates data tasks in its paired region only.');
    }
    const result = await evaluator.evaluate({ task: parsed.value, ...(signal ? { signal } : {}) });
    if (!result.ok) {
      observations.push({
        stage: 'evaluate',
        elapsedMs: performance.now() - start,
        task: parsed.value,
        diagnostics: result.diagnostics.map((item) => item.code),
      });
      return result;
    }
    try {
      const outputs: EvaluatedOutput[] = [];
      for (const output of result.value.outputs) {
        const snapshot = output.handle.snapshot();
        if (!snapshot.descriptor) return fail('evaluation.incomplete', 'The output lacks a descriptor.');
        handles.set(key(snapshot.descriptor.ref), output.handle);
        outputs.push({
          descriptor: snapshot.descriptor,
          rows: snapshot.batches.flatMap((batch) => batch.rows) as readonly DataRecord[],
        });
      }
      observations.push({ stage: 'evaluate', elapsedMs: performance.now() - start, task: parsed.value, outputs });
      return { ok: true, value: outputs };
    } finally {
      result.value.release();
    }
  }
  const manifest = (
    ref: string,
    operation: AgentCapabilityManifest['operation'],
    description: string,
    invoke: AgentCapabilityManifest['invoke'],
  ): AgentCapabilityManifest => ({
    ref: { id: ref, revision: '1' },
    operation,
    label: ref,
    description,
    parse: (input) => {
      const checked = parseWireValue(input);
      return checked.ok ? { ok: true, value: checked.value as AgentJsonValue } : checked;
    },
    invoke,
  });
  const registry = createAgentCapabilityRegistry([
    manifest(
      'eval.catalog',
      'catalog.read',
      'Read this authorized synthetic Catalog and paired region. The catalog describes semantics, not permissions.',
      () => ({
        state: 'data-ready',
        value: { catalog: fixture.catalog, regionId: fixture.regionId } as unknown as AgentJsonValue,
      }),
    ),
    manifest(
      'eval.task',
      'task.evaluate',
      'Evaluate a canonical versioned data Task. Does not present or commit a UI. Inspect the returned descriptors and records before explaining them.',
      async (input, call) => {
        const result = await evaluate(input, call.signal);
        return result.ok
          ? {
              state: 'data-ready',
              value: { outputs: result.value } as unknown as AgentJsonValue,
              affectedResults: result.value.map((output) => output.descriptor.ref),
            }
          : { state: 'invalid', diagnostics: result.diagnostics };
      },
    ),
  ]);
  if (!registry.ok) throw Error(registry.diagnostics[0]?.message);
  const endpoint = createAgentToolEndpoint({
    transport,
    targetRegionId: fixture.regionId,
    goalEpoch: fixture.goalEpoch,
    principalKey: fixture.principalKey,
    scopeDigest: fixture.scopeDigest,
    expiresAt: Date.now() + 300_000,
    maxMilliseconds: Math.min(60_000, fixture.budget.maxMilliseconds),
    maxOutputBytes: 1_000_000,
    registry: registry.value,
    tools: [
      {
        name: 'read_catalog',
        capability: { id: 'eval.catalog', revision: '1' },
        operation: 'catalog.read',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'evaluate_task',
        capability: { id: 'eval.task', revision: '1' },
        operation: 'task.evaluate',
        inputSchema: dataSchema as unknown as Record<string, AgentJsonValue>,
      },
    ],
    host: {
      readContext: () => ({
        ok: true,
        value: {
          principalKey: fixture.principalKey,
          regionId: fixture.regionId,
          goalEpoch: epoch,
          current: {
            scopeDigest: fixture.scopeDigest,
            policyRevision: 'eval-policy-1',
            catalogRevision: fixture.catalog.revision,
            functionRegistryDigest: fixture.catalog.functionRegistryDigest,
            taskRevision: '1',
            regionRevision: '1',
            experienceRevision: 'evaluation-no-presentation',
            results: [...handles.values()].flatMap((handle) => {
              const snapshot = handle.snapshot();
              return snapshot.descriptor ? [snapshot.descriptor.ref] : [];
            }),
          },
          grants: revoked ? [] : ['catalog.read', 'task.evaluate', 'result.inspect', 'model.egress'],
        },
      }),
    },
  });
  if (!endpoint.ok) throw Error(endpoint.diagnostics[0]?.message);
  return {
    endpoint: endpoint.value,
    evaluate,
    observations,
    fixture,
    revoke() {
      revoked = true;
      handles.clear();
      store.dispose();
    },
    supersede() {
      epoch += '-superseded';
    },
    dispose() {
      revoked = true;
      endpoint.value.close();
      handles.clear();
      store.dispose();
    },
  };
}
