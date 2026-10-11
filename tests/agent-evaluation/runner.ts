import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseCatalog, parseTask, parseWireValue, type Task } from '@varendo/core';
import { createOpaqueModelSecret, createOpenAICompatibleToolModel } from '../../packages/agent/src/model/index.js';
import type { ToolModelCapability } from '../../packages/agent/src/model/protocol.js';
import { runToolModel } from '../../packages/agent/src/model/loop.js';
import type { ToolModelBudget, ToolModelLoopOutcome } from '../../packages/agent/src/model/types.js';
import { createEvaluationHost, type EvaluationFixture, type EvaluationObservation } from './host.js';
import { scoreData, wilsonInterval, type ExpectedOutput } from './scoring.js';
import { runExplicitMcp } from './mcp-baseline.js';
interface EvaluationCase {
  readonly id: string;
  readonly partition: 'development' | 'heldout';
  readonly independentAuthor: string;
  readonly exposure: string;
  readonly prompt: string;
  readonly fixture: EvaluationFixture;
  readonly explicitTask: Task;
  readonly expected: readonly ExpectedOutput[];
}
interface ModelConfig {
  readonly label: 'weak' | 'strong';
  readonly protocol: 'openai-compatible-chat';
  readonly baseURL: string;
  readonly model: string;
  readonly expectedReportedModel: string;
  readonly credentialEnvironment: string;
  readonly auth: { readonly scheme: 'bearer' | 'header'; readonly headerName?: string };
  readonly capabilities: readonly ToolModelCapability[];
  readonly inputUSDPerMillion: number;
  readonly outputUSDPerMillion: number;
  readonly priceSource: string;
}
interface LiveConfig {
  readonly version: '1';
  readonly authorized: boolean;
  readonly authorizationReference: string;
  readonly authorizedCorpusSha256: string;
  readonly maxUSD: number;
  readonly trials: number;
  readonly models: readonly ModelConfig[];
  readonly budget: ToolModelBudget;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const boundedText = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const GOVERNED_DATA_INSTRUCTIONS =
  'You are an Varendo planning model operating on untrusted proposals. Use only the authorized tools. First call read_catalog. Then call evaluate_task with a complete canonical Task that answers the user request; preserve every explicitly requested output identifier exactly and do not calculate source data yourself. If evaluation returns invalid, repair the Task within the remaining budget. Only after a data-ready evaluation result may you give a brief completion response. Never add grants, approvals, actors, credentials, code, SQL, HTML, CSS, or unsupported fields.';
const GOVERNED_DATA_POLICY = {
  requiredOperationSequence: [
    { operation: 'catalog.read' as const, acceptedStates: ['data-ready' as const] },
    { operation: 'task.evaluate' as const, acceptedStates: ['data-ready' as const] },
  ],
};
const capabilities = new Set<ToolModelCapability>([
  'tool-calls',
  'usage',
  'request-cancellation',
  'input-token-estimate',
  'request-retry',
]);
function validBaseURL(value: unknown): value is string {
  if (!boundedText(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
function validModel(value: unknown): value is ModelConfig {
  if (
    !object(value) ||
    !['weak', 'strong'].includes(String(value.label)) ||
    value.protocol !== 'openai-compatible-chat' ||
    !validBaseURL(value.baseURL) ||
    !boundedText(value.model, 128) ||
    !boundedText(value.expectedReportedModel, 256) ||
    typeof value.credentialEnvironment !== 'string' ||
    !/^AELIQO_EVAL_[A-Z0-9_]{1,80}$/.test(value.credentialEnvironment) ||
    !object(value.auth) ||
    !['bearer', 'header'].includes(String(value.auth.scheme)) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length === 0 ||
    new Set(value.capabilities).size !== value.capabilities.length ||
    !value.capabilities.includes('tool-calls') ||
    !value.capabilities.every((item) => capabilities.has(item as ToolModelCapability)) ||
    typeof value.inputUSDPerMillion !== 'number' ||
    !Number.isFinite(value.inputUSDPerMillion) ||
    value.inputUSDPerMillion <= 0 ||
    typeof value.outputUSDPerMillion !== 'number' ||
    !Number.isFinite(value.outputUSDPerMillion) ||
    value.outputUSDPerMillion <= 0 ||
    !boundedText(value.priceSource, 512)
  )
    return false;
  if (
    value.auth.scheme === 'header' &&
    (!boundedText(value.auth.headerName, 128) || !/^[-A-Za-z0-9]+$/.test(value.auth.headerName))
  )
    return false;
  if (value.auth.scheme === 'bearer' && value.auth.headerName !== undefined) return false;
  return true;
}
function parseConfig(value: unknown): LiveConfig | undefined {
  if (
    !object(value) ||
    value.version !== '1' ||
    typeof value.authorized !== 'boolean' ||
    !boundedText(value.authorizationReference, 512) ||
    typeof value.authorizedCorpusSha256 !== 'string' ||
    !/^([a-f0-9]{64})$/.test(value.authorizedCorpusSha256) ||
    !integer(value.trials, 1, 20) ||
    typeof value.maxUSD !== 'number' ||
    !Number.isFinite(value.maxUSD) ||
    value.maxUSD <= 0 ||
    !Array.isArray(value.models) ||
    value.models.length !== 2 ||
    !object(value.budget)
  )
    return;
  const models = value.models;
  const [first, second] = models;
  if (
    !first ||
    !second ||
    !models.every(validModel) ||
    new Set(models.map((model) => model.label)).size !== 2 ||
    first.model === second.model ||
    first.expectedReportedModel === second.expectedReportedModel
  )
    return;
  const budget = value.budget;
  for (const [key, max] of Object.entries({
    maxTurns: 32,
    maxModelRequests: 64,
    maxToolCalls: 64,
    maxMilliseconds: 300000,
    maxInputTokens: 1000000,
    maxOutputTokens: 100000,
    maxTotalTokens: 2000000,
    maxInputBytes: 1000000,
    maxOutputBytes: 1000000,
    maxRepeatedCalls: 4,
  }))
    if (!integer(budget[key], 1, max)) return;
  return value as unknown as LiveConfig;
}
function parseCase(value: unknown): EvaluationCase | undefined {
  if (
    !object(value) ||
    !boundedText(value.id) ||
    !['development', 'heldout'].includes(String(value.partition)) ||
    !boundedText(value.independentAuthor, 512) ||
    !boundedText(value.exposure, 2048) ||
    !boundedText(value.prompt, 16000) ||
    !object(value.fixture) ||
    !Array.isArray(value.expected)
  )
    return;
  const fixture = value.fixture;
  if (
    !parseCatalog(fixture.catalog).ok ||
    !parseTask(value.explicitTask).ok ||
    !object(fixture.records) ||
    !object(fixture.budget)
  )
    return;
  for (const key of ['id', 'sourceRevision', 'scopeDigest', 'principalKey', 'regionId', 'goalEpoch'])
    if (!boundedText(fixture[key])) return;
  for (const [key, max] of Object.entries({
    maxRows: 10000,
    maxBytes: 8 * 1024 * 1024,
    maxMessages: 1000,
    maxMilliseconds: 60000,
    maxColumns: 256,
  }))
    if (!integer(fixture.budget[key], 1, max)) return;
  if (
    !Object.values(fixture.records).every((rows) => Array.isArray(rows) && rows.length <= 10000 && rows.every(object))
  )
    return;
  if (
    !value.expected.every(
      (output) =>
        object(output) &&
        boundedText(output.id) &&
        Array.isArray(output.fields) &&
        output.fields.every((field) => boundedText(field)) &&
        Array.isArray(output.grain) &&
        output.grain.every((field) => boundedText(field)) &&
        Array.isArray(output.rows) &&
        output.rows.every(object) &&
        typeof output.orderMatters === 'boolean' &&
        ['complete', 'partial', 'sample', 'unknown'].includes(String(output.coverage)),
    )
  )
    return;
  if (value.expected.length === 0 || new Set(value.expected.map((output) => output.id)).size !== value.expected.length)
    return;
  for (const output of value.expected) {
    const quality = output.quality;
    if (
      !object(quality) ||
      !Array.isArray(quality.identity) ||
      !quality.identity.every((id) => boundedText(id)) ||
      new Set(quality.identity).size !== quality.identity.length ||
      !integer(quality.populationCount, 0, 10000) ||
      quality.precision !== 'exact' ||
      !object(quality.sourceRevisions) ||
      !Object.values(quality.sourceRevisions).every((revision) => boundedText(revision)) ||
      !['observed', 'computed'].includes(String(quality.evidenceKind)) ||
      !Array.isArray(quality.definitions) ||
      !quality.definitions.every((ref) => object(ref) && boundedText(ref.id) && boundedText(ref.revision))
    )
      return;
    if (
      new Set(output.fields).size !== output.fields.length ||
      output.fields.length === 0 ||
      new Set(output.grain).size !== output.grain.length ||
      !output.rows.every(
        (row: Record<string, unknown>) =>
          Object.keys(row).length === output.fields.length &&
          output.fields.every((field: string) => Object.hasOwn(row, field)),
      )
    )
      return;
  }
  if (!parseWireValue(value).ok) return;
  return value as unknown as EvaluationCase;
}
function safeResult(result: ToolModelLoopOutcome): Record<string, unknown> {
  if (!result.ok) return { ok: false, diagnosticCodes: result.diagnostics.map((item) => item.code) };
  return {
    ok: true,
    stop: result.value.stop,
    turns: result.value.turns,
    modelRequests: result.value.modelRequests,
    toolCalls: result.value.toolCalls,
    inputTokens: result.value.inputTokens,
    outputTokens: result.value.outputTokens,
    receiptStates: result.value.receipts.map((receipt) => ({ operation: receipt.operation, state: receipt.state })),
    ...(result.value.incompleteRequiredOperations === undefined
      ? {}
      : { incompleteRequiredOperations: result.value.incompleteRequiredOperations }),
  };
}
function safeObservations(observations: readonly EvaluationObservation[]): readonly Record<string, unknown>[] {
  return observations.map((item) => ({
    stage: item.stage,
    elapsedMs: item.elapsedMs,
    outputCount: item.outputs?.length ?? 0,
    rowCount: item.outputs?.reduce((total, output) => total + output.rows.length, 0) ?? 0,
    diagnosticCodes: item.diagnostics ?? [],
  }));
}
export async function runEvaluation(args: readonly string[]): Promise<number> {
  const options = new Map<string, string>();
  const selectedCaseIds: string[] = [];
  let selectedModelLabel: 'weak' | 'strong' | undefined;
  let live = false;
  let mcpExplicit = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--live') {
      live = true;
      continue;
    }
    if (argument === '--mcp-explicit') {
      mcpExplicit = true;
      continue;
    }
    if (argument === '--case') {
      const id = args[++index];
      if (!id) throw Error('--case requires an exact corpus case ID.');
      selectedCaseIds.push(id);
      continue;
    }
    if (argument === '--model-label') {
      const label = args[++index];
      if (label !== 'weak' && label !== 'strong') throw Error('--model-label must be weak or strong.');
      selectedModelLabel = label;
      continue;
    }
    if (!['--config', '--corpus', '--output'].includes(argument) || !args[index + 1])
      throw Error(
        'Use --config FILE --corpus FILE --output DIRECTORY [--live] [--mcp-explicit] [--case ID ...] [--model-label weak|strong].',
      );
    options.set(argument, args[++index]!);
  }
  const corpusPath = options.get('--corpus');
  const configPath = options.get('--config');
  const outputPath = options.get('--output');
  if (!corpusPath || !outputPath) throw Error('Provide a corpus file and output directory.');
  const corpusBytes = await readFile(resolve(corpusPath), 'utf8');
  const raw: unknown = JSON.parse(corpusBytes);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) throw Error('The corpus must contain 1–200 cases.');
  const cases = raw.map(parseCase);
  if (cases.some((item) => item === undefined) || new Set(cases.map((item) => item!.id)).size !== cases.length)
    throw Error('The corpus contains invalid or repeated cases.');
  const validCases = cases as EvaluationCase[];
  if (new Set(selectedCaseIds).size !== selectedCaseIds.length) throw Error('Selected case IDs must be unique.');
  const selectedCaseSet = new Set(selectedCaseIds);
  if (selectedCaseIds.some((id) => !validCases.some((item) => item.id === id)))
    throw Error('Every selected case ID must exist in the authorized corpus.');
  const runCases =
    selectedCaseIds.length === 0 ? validCases : validCases.filter((item) => selectedCaseSet.has(item.id));
  const root = resolve(import.meta.dirname, '../..');
  const sourceDigest = () =>
    execFileSync('node', ['scripts/source-digest.mjs'], { cwd: root, encoding: 'utf8' }).trim();
  const before = sourceDigest();
  const output = resolve(outputPath);
  await mkdir(output, { recursive: true });
  const rows: Record<string, unknown>[] = [];
  const blocks: string[] = [];
  const config = configPath ? parseConfig(JSON.parse(await readFile(resolve(configPath), 'utf8'))) : undefined;
  for (const testCase of runCases) {
    const host = createEvaluationHost(testCase.fixture);
    try {
      const started = performance.now();
      const evaluated = await host.evaluate(testCase.explicitTask);
      rows.push({
        caseId: testCase.id,
        partition: testCase.partition,
        mode: 'explicit-task',
        model: null,
        elapsedMs: performance.now() - started,
        score: evaluated.ok
          ? scoreData(evaluated.value, testCase.expected, testCase.fixture.scopeDigest, testCase.fixture.sourceRevision)
          : { dataCorrect: false, diagnostics: evaluated.diagnostics },
        observations: host.observations,
      });
    } finally {
      host.dispose();
    }
    if (mcpExplicit) {
      const baseline = await runExplicitMcp(testCase.fixture, testCase.explicitTask);
      rows.push({
        caseId: testCase.id,
        partition: testCase.partition,
        mode: 'explicit-mcp',
        model: null,
        score: baseline.result.ok
          ? scoreData(
              baseline.result.value,
              testCase.expected,
              testCase.fixture.scopeDigest,
              testCase.fixture.sourceRevision,
            )
          : { dataCorrect: false, diagnostics: baseline.result.diagnostics },
        observation: baseline.observation,
        outputs: baseline.result.ok ? baseline.result.value : undefined,
      });
    }
  }
  if (!live) blocks.push('Live trials were not requested. No provider request was made.');
  else if (!config || !config.authorized)
    blocks.push(
      'An explicit owner-authorized configuration with exact weak/strong models, prices, and spend ceiling is required.',
    );
  else if (config.authorizedCorpusSha256 !== hash(corpusBytes))
    blocks.push('The corpus bytes differ from the owner-authorized corpus digest. No provider request was made.');
  else if (
    config.models
      .filter((model) => selectedModelLabel === undefined || model.label === selectedModelLabel)
      .some((model) => !process.env[model.credentialEnvironment])
  )
    blocks.push('One or more selected opaque model credentials are unavailable. No provider request was made.');
  else {
    let reservedUSD = 0;
    for (const model of config.models.filter(
      (item) => selectedModelLabel === undefined || item.label === selectedModelLabel,
    ))
      for (const testCase of runCases)
        for (let trial = 1; trial <= config.trials; trial++) {
          // Reserve the whole configured trial bound before making either counting or generation requests.
          const maximum =
            (config.budget.maxModelRequests * config.budget.maxInputTokens * model.inputUSDPerMillion +
              config.budget.maxTurns * config.budget.maxOutputTokens * model.outputUSDPerMillion) /
            1_000_000;
          if (!Number.isFinite(maximum) || reservedUSD + maximum > config.maxUSD) {
            blocks.push(`Spend reservation prevents ${model.label}/${testCase.id}/trial-${trial}.`);
            continue;
          }
          reservedUSD += maximum;
          const snapshots: {
            reportedModel?: string;
            reportedModelSha256: string;
            matchesExpected: boolean;
            responseIdSha256: string;
          }[] = [];
          const host = createEvaluationHost(testCase.fixture, 'byok');
          const started = performance.now();
          try {
            const secret = process.env[model.credentialEnvironment]!;
            const port = createOpenAICompatibleToolModel({
              baseURL: model.baseURL,
              model: model.model,
              secret: createOpaqueModelSecret(secret, 'trusted-server'),
              auth: model.auth,
              capabilities: model.capabilities,
              policy: { allowExternalEgress: true, allowedOrigins: [new URL(model.baseURL).origin] },
              retry: { maxAttempts: 1 },
              cost: {
                currency: 'USD',
                inputUSDPerMillion: model.inputUSDPerMillion,
                outputUSDPerMillion: model.outputUSDPerMillion,
                source: model.priceSource,
              },
              onResponse: (observation) => {
                if (observation.providerModel !== undefined && observation.responseId !== undefined) {
                  const matchesExpected = observation.providerModel === model.expectedReportedModel;
                  snapshots.push({
                    ...(matchesExpected ? { reportedModel: model.expectedReportedModel } : {}),
                    reportedModelSha256: hash(observation.providerModel),
                    matchesExpected,
                    responseIdSha256: hash(observation.responseId),
                  });
                }
              },
            });
            const result = await runToolModel({
              requestId: `trial-${trial}`,
              goal: 'chat',
              prompt: testCase.prompt,
              instructions: GOVERNED_DATA_INSTRUCTIONS,
              policy: GOVERNED_DATA_POLICY,
              endpoint: host.endpoint,
              model: port,
              budget: config.budget,
            });
            const qualifiedModelSnapshot = snapshots.length > 0 && snapshots.every((item) => item.matchesExpected);
            if (!qualifiedModelSnapshot)
              blocks.push(
                `Missing or non-authorized reported model snapshot for ${model.label}/${testCase.id}/trial-${trial}.`,
              );
            const evaluations = host.observations.filter((item) => item.stage === 'evaluate');
            const first = evaluations[0]?.outputs;
            const last = evaluations.at(-1)?.outputs;
            rows.push({
              caseId: testCase.id,
              partition: testCase.partition,
              mode: 'governed-model-data',
              model: model.model,
              modelLabel: model.label,
              qualifiedModelSnapshot,
              connection: {
                protocol: model.protocol,
                origin: new URL(model.baseURL).origin,
                authScheme: model.auth.scheme,
                capabilities: model.capabilities,
              },
              snapshots,
              trial,
              elapsedMs: performance.now() - started,
              reservedUSD: maximum,
              firstAttempt: first
                ? scoreData(first, testCase.expected, testCase.fixture.scopeDigest, testCase.fixture.sourceRevision)
                : { dataCorrect: false },
              score:
                last && result.ok && result.value.stop === 'text-ready'
                  ? scoreData(last, testCase.expected, testCase.fixture.scopeDigest, testCase.fixture.sourceRevision)
                  : { dataCorrect: false },
              result: safeResult(result),
              observations: safeObservations(host.observations),
              uiTaskCompletion: null,
              narrativeGrounding: null,
              chargedUSD: null,
              usageEstimatedUSD: result.ok
                ? (result.value.inputTokens * model.inputUSDPerMillion +
                    result.value.outputTokens * model.outputUSDPerMillion) /
                  1_000_000
                : null,
              priceSource: model.priceSource,
            });
          } catch {
            blocks.push(
              `Provider trial failed before an authorized model snapshot for ${model.label}/${testCase.id}/trial-${trial}.`,
            );
            rows.push({
              caseId: testCase.id,
              partition: testCase.partition,
              mode: 'governed-model-data',
              model: model.model,
              modelLabel: model.label,
              qualifiedModelSnapshot: false,
              trial,
              status: 'provider-failed',
              elapsedMs: performance.now() - started,
              score: { dataCorrect: false },
              reservedUSD: maximum,
            });
          } finally {
            host.dispose();
          }
        }
  }
  const groups = ['weak', 'strong'].map((label) => {
    const attempted = rows.filter((row) => row.modelLabel === label);
    const trials = attempted.filter((row) => row.qualifiedModelSnapshot === true);
    const successes = trials.filter((row) => object(row.score) && row.score.dataCorrect === true).length;
    return {
      label,
      attemptedTrials: attempted.length,
      unqualifiedTrials: attempted.length - trials.length,
      trials: trials.length,
      dataCorrect: successes,
      interval: wilsonInterval(successes, trials.length),
      uiTaskCompletion: null,
      narrativeGrounding: null,
    };
  });
  const after = sourceDigest();
  if (after !== before) blocks.push('Source changed during the run; these results cannot qualify the candidate.');
  if (!mcpExplicit) blocks.push('Actual MCP-client explicit trials were not requested.');
  blocks.push(
    'This data-only runner does not establish full release qualification: UI completion, narrative review, fixed-template ablation, external MCP-host reasoning trials, and independently accepted held-out coverage remain separate requirements.',
  );
  const report = {
    schemaVersion: 1,
    status: 'blocked',
    mcpExplicit,
    sourceDigest: before,
    sourceChangedDuringRun: after !== before,
    corpus: {
      path: resolve(corpusPath),
      sha256: hash(corpusBytes),
      cases: validCases.map((item) => ({
        id: item.id,
        partition: item.partition,
        independentAuthor: item.independentAuthor,
        exposure: item.exposure,
      })),
      selection: {
        caseIds: runCases.map((item) => item.id),
        modelLabels: selectedModelLabel === undefined ? ['weak', 'strong'] : [selectedModelLabel],
      },
    },
    authorization: config
      ? {
          reference: config.authorizationReference,
          maximumUSD: config.maxUSD,
          authorizedCorpusSha256: config.authorizedCorpusSha256,
        }
      : null,
    groups,
    blocks,
    rows,
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evaluation evidence written to ${join(output, 'report.json')}. Overall release qualification: BLOCKED.`);
  return rows.some(
    (row) =>
      (row.mode === 'explicit-task' || row.mode === 'explicit-mcp') &&
      object(row.score) &&
      row.score.dataCorrect === false,
  )
    ? 1
    : 2;
}
export { parseConfig, parseCase };
