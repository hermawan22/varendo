import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseResult, parseWireValue, type Outcome, type Task } from '@varendo/core';
import { VARENDO_MCP_PROTOCOL_REVISION, createMcpClientEndpoint } from '../../packages/agent/src/mcp/index.js';
import type { EvaluatedOutput, EvaluationFixture } from './host.js';
import type { DataRecord, DataValue } from '../../packages/runtime/src/data/index.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const dataValue = (value: unknown): value is DataValue =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  typeof value === 'string' ||
  (object(value) && Object.keys(value).length === 1 && typeof value.decimal === 'string');
const dataRecord = (value: unknown): value is DataRecord => object(value) && Object.values(value).every(dataValue);
const failure = (code: string): Outcome<readonly EvaluatedOutput[]> => ({
  ok: false,
  diagnostics: [
    { code, message: 'The explicit MCP baseline did not return validated evaluation outputs.', retryable: false },
  ],
});

async function observeChildExit(pid: number | null): Promise<boolean | null> {
  if (pid === null) return null;
  const deadline = performance.now() + 5_000;
  do {
    try {
      process.kill(pid, 0);
    } catch (error) {
      return object(error) && error.code === 'ESRCH' ? true : null;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  } while (performance.now() < deadline);
  return false;
}

export function parseMcpEvaluationOutputs(input: unknown): Outcome<readonly EvaluatedOutput[]> {
  const wire = parseWireValue(input);
  if (!wire.ok) return wire;
  if (
    !object(wire.value) ||
    !Array.isArray(wire.value.outputs) ||
    wire.value.outputs.length === 0 ||
    wire.value.outputs.length > 128
  )
    return failure('evaluation.mcp-output');
  const outputs: EvaluatedOutput[] = [];
  for (const output of wire.value.outputs) {
    if (!object(output) || !Array.isArray(output.rows) || !output.rows.every(dataRecord))
      return failure('evaluation.mcp-output');
    const descriptor = parseResult(output.descriptor);
    if (!descriptor.ok) return descriptor;
    outputs.push({ descriptor: descriptor.value, rows: output.rows });
  }
  return { ok: true, value: outputs };
}

/** Real official SDK client and stdio child. Explicit tasks only; no model call. */
export async function runExplicitMcp(fixture: EvaluationFixture, task: Task) {
  const directory = await mkdtemp(join(tmpdir(), 'varendo-evaluation-mcp-'));
  const fixturePath = join(directory, 'fixture.json');
  const childFixture: EvaluationFixture = {
    id: fixture.id,
    catalog: fixture.catalog,
    records: fixture.records,
    sourceRevision: fixture.sourceRevision,
    scopeDigest: fixture.scopeDigest,
    principalKey: fixture.principalKey,
    regionId: fixture.regionId,
    goalEpoch: fixture.goalEpoch,
    budget: fixture.budget,
  };
  const client = new Client({ name: 'varendo-evaluation-client', version: '0.0.0-test' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, 'mcp-baseline-child.mjs'), fixturePath],
    stderr: 'pipe',
    maxBufferSize: 2_000_000,
  });
  const started = performance.now();
  let stderrBytes = 0;
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
  });
  let result: Outcome<readonly EvaluatedOutput[]> = failure('evaluation.mcp-transport');
  let discoveredTools: readonly string[] = [];
  let toolSchemaSha256: string | null = null;
  let server: ReturnType<Client['getServerVersion']>;
  let callElapsedMs: number | null = null;
  let receiptState: string | null = null;
  let childPid: number | null = null;
  let childExited: boolean | null = null;
  let cleanupSucceeded = false;
  const signal = AbortSignal.timeout(Math.min(60_000, fixture.budget.maxMilliseconds + 10_000));
  try {
    await writeFile(fixturePath, JSON.stringify(childFixture), { mode: 0o600 });
    await client.connect(transport, { signal });
    childPid = transport.pid;
    server = client.getServerVersion();
    const endpoint = createMcpClientEndpoint({
      client,
      transport,
      targetRegionId: fixture.regionId,
      goalEpoch: fixture.goalEpoch,
    });
    const discovered = await endpoint.discover({ signal });
    if (!discovered.ok) result = discovered;
    else {
      discoveredTools = discovered.value.map((tool) => tool.name);
      toolSchemaSha256 = createHash('sha256').update(JSON.stringify(discovered.value)).digest('hex');
      const callStarted = performance.now();
      const receipt = await endpoint.invoke('evaluate_task', task, { requestId: 'explicit-mcp-baseline', signal });
      callElapsedMs = performance.now() - callStarted;
      if (!receipt.ok) result = receipt;
      else {
        receiptState = receipt.value.state;
        result =
          receipt.value.state === 'data-ready'
            ? parseMcpEvaluationOutputs(receipt.value.value)
            : failure('evaluation.mcp-state');
      }
    }
  } catch {
    result = failure('evaluation.mcp-transport');
  } finally {
    childPid ??= transport.pid;
    const closes = await Promise.allSettled([client.close(), transport.close()]);
    childExited = await observeChildExit(childPid);
    let fixtureRemoved = false;
    try {
      await rm(fixturePath, { force: true });
      await rmdir(directory);
      fixtureRemoved = true;
    } catch {
      /* Record bounded cleanup failure without exposing fixture contents or paths. */
    }
    cleanupSucceeded = closes.every((close) => close.status === 'fulfilled') && childExited === true && fixtureRemoved;
    if (!cleanupSucceeded) result = failure('evaluation.mcp-cleanup');
  }
  return {
    result,
    observation: {
      transport: 'official-sdk-stdio',
      protocolPin: VARENDO_MCP_PROTOCOL_REVISION,
      server: server ?? null,
      node: process.version,
      discoveredTools,
      toolSchemaSha256,
      receiptState,
      callElapsedMs,
      elapsedMs: performance.now() - started,
      transportDetached: transport.pid === null,
      childPid,
      childExited,
      cleanupSucceeded,
      stderrBytes,
      modelExecution: 'No model adapter is configured.',
      fixtureProjection: 'Application fixture fields only; expected answers and prompts are omitted.',
      limits: [
        'Explicit normalized-task baseline only. No external model reasoning, HTTP deployment, UI completion or narrative grounding is asserted.',
      ],
    },
  };
}
