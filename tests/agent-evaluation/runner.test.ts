import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runEvaluation, parseConfig, parseCase } from './runner.js';
import { developmentCase } from './development.js';
it('runs an explicit baseline without credentials or network and labels live evaluation blocked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-preflight-'));
  const corpus = join(directory, 'corpus.json');
  await writeFile(corpus, JSON.stringify([developmentCase]));
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider egress'));
  try {
    expect(await runEvaluation(['--corpus', corpus, '--output', directory])).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    expect(report.status).toBe('blocked');
    expect(report.rows[0].score).toMatchObject({ dataCorrect: true, uiTaskCompletion: null, narrativeGrounding: null });
    expect(
      report.groups.every(
        (group: { trials: number; interval: unknown }) => group.trials === 0 && group.interval === null,
      ),
    ).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});
it('runs an exact predeclared corpus and model subset without weakening corpus authorization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-selection-'));
  const corpus = join(directory, 'corpus.json');
  const second = { ...developmentCase, id: 'second-development-records' };
  await writeFile(corpus, JSON.stringify([developmentCase, second]));
  expect(
    await runEvaluation(['--corpus', corpus, '--output', directory, '--case', second.id, '--model-label', 'weak']),
  ).toBe(2);
  const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
  expect(report.corpus.cases).toHaveLength(2);
  expect(report.corpus.selection).toEqual({ caseIds: [second.id], modelLabels: ['weak'] });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].caseId).toBe(second.id);
  await expect(runEvaluation(['--corpus', corpus, '--output', directory, '--case', 'absent'])).rejects.toThrow(
    'must exist',
  );
});
it('does not infer spend authorization or accept malformed corpus documents', () => {
  expect(parseConfig({ version: '1', authorized: true })).toBeUndefined();
  expect(parseCase({ ...developmentCase, fixture: { ...developmentCase.fixture, catalog: {} } })).toBeUndefined();
  expect(parseCase(developmentCase)?.partition).toBe('development');
});
it('pins live data egress to the exact owner-approved corpus bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-corpus-pin-'));
  const corpus = join(directory, 'corpus.json');
  const config = join(directory, 'config.json');
  const connection = {
    protocol: 'openai-compatible-chat',
    baseURL: 'https://provider.example/v1',
    credentialEnvironment: 'AELIQO_EVAL_PROVIDER_SECRET',
    auth: { scheme: 'bearer' },
    capabilities: ['tool-calls', 'usage', 'request-cancellation'],
  };
  await writeFile(corpus, JSON.stringify([developmentCase]));
  await writeFile(
    config,
    JSON.stringify({
      version: '1',
      authorized: true,
      authorizationReference: 'Synthetic test authorization only',
      authorizedCorpusSha256: '0'.repeat(64),
      maxUSD: 1,
      trials: 1,
      models: [
        {
          label: 'weak',
          ...connection,
          model: 'synthetic-weak',
          expectedReportedModel: 'synthetic-weak',
          inputUSDPerMillion: 1,
          outputUSDPerMillion: 1,
          priceSource: 'synthetic test rate',
        },
        {
          label: 'strong',
          ...connection,
          model: 'synthetic-strong',
          expectedReportedModel: 'synthetic-strong',
          inputUSDPerMillion: 1,
          outputUSDPerMillion: 1,
          priceSource: 'synthetic test rate',
        },
      ],
      budget: {
        maxTurns: 1,
        maxModelRequests: 2,
        maxToolCalls: 1,
        maxMilliseconds: 5000,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        maxTotalTokens: 200,
        maxInputBytes: 100000,
        maxOutputBytes: 100000,
        maxRepeatedCalls: 1,
      },
    }),
  );
  vi.stubEnv('AELIQO_EVAL_PROVIDER_SECRET', 'synthetic-never-sent');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider egress'));
  try {
    expect(await runEvaluation(['--corpus', corpus, '--config', config, '--output', directory, '--live'])).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    expect(report.blocks).toContain(
      'The corpus bytes differ from the owner-authorized corpus digest. No provider request was made.',
    );
    expect(report.groups.every((group: { trials: number }) => group.trials === 0)).toBe(true);
  } finally {
    fetch.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('rejects ambiguous or incomplete expected-output oracles', () => {
  expect(
    parseCase({ ...developmentCase, expected: [developmentCase.expected[0], developmentCase.expected[0]] }),
  ).toBeUndefined();
  expect(
    parseCase({ ...developmentCase, expected: [{ ...developmentCase.expected[0], fields: ['id', 'id'] }] }),
  ).toBeUndefined();
  expect(
    parseCase({ ...developmentCase, expected: [{ ...developmentCase.expected[0], rows: [{ id: 'a' }] }] }),
  ).toBeUndefined();
});

it('rejects unbounded or incomplete fixture execution budgets', () => {
  expect(parseCase({ ...developmentCase, fixture: { ...developmentCase.fixture, budget: {} } })).toBeUndefined();
  expect(
    parseCase({
      ...developmentCase,
      fixture: { ...developmentCase.fixture, budget: { ...developmentCase.fixture.budget, maxRows: 10001 } },
    }),
  ).toBeUndefined();
});

it('records a real MCP explicit baseline separately from model-quality groups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-mcp-runner-'));
  const corpus = join(directory, 'corpus.json');
  await writeFile(corpus, JSON.stringify([developmentCase]));
  expect(await runEvaluation(['--corpus', corpus, '--output', directory, '--mcp-explicit'])).toBe(2);
  const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
  expect(report).toMatchObject({ status: 'blocked', mcpExplicit: true });
  expect(report.rows.map((row: { mode: string }) => row.mode)).toEqual(['explicit-task', 'explicit-mcp']);
  expect(report.rows[1]).toMatchObject({
    model: null,
    score: { dataCorrect: true, uiTaskCompletion: null, narrativeGrounding: null },
    observation: {
      transport: 'official-sdk-stdio',
      transportDetached: true,
      childExited: true,
      cleanupSucceeded: true,
      receiptState: 'data-ready',
    },
  });
  expect(report.rows[1].observation.toolSchemaSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    report.groups.every(
      (group: { trials: number; interval: unknown }) => group.trials === 0 && group.interval === null,
    ),
  ).toBe(true);
}, 30000);

it('never persists model prose, tool payloads, response IDs, or configured credential values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-secret-report-'));
  const corpus = join(directory, 'corpus.json');
  const config = join(directory, 'config.json');
  const corpusBytes = JSON.stringify([developmentCase]);
  const secret = 'synthetic-provider-secret-never-persist';
  const connection = {
    protocol: 'openai-compatible-chat',
    baseURL: 'https://provider.example/v1',
    credentialEnvironment: 'AELIQO_EVAL_PROVIDER_SECRET',
    auth: { scheme: 'bearer' },
    capabilities: ['tool-calls', 'usage', 'request-cancellation'],
  };
  const models = [
    {
      label: 'weak',
      ...connection,
      model: 'synthetic-weak',
      expectedReportedModel: 'reported-weak',
      inputUSDPerMillion: 1,
      outputUSDPerMillion: 1,
      priceSource: 'synthetic test rate',
    },
    {
      label: 'strong',
      ...connection,
      model: 'synthetic-strong',
      expectedReportedModel: 'reported-strong',
      inputUSDPerMillion: 1,
      outputUSDPerMillion: 1,
      priceSource: 'synthetic test rate',
    },
  ];
  await writeFile(corpus, corpusBytes);
  await writeFile(
    config,
    JSON.stringify({
      version: '1',
      authorized: true,
      authorizationReference: 'Synthetic test authorization only',
      authorizedCorpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
      maxUSD: 1,
      trials: 1,
      models,
      budget: {
        maxTurns: 1,
        maxModelRequests: 1,
        maxToolCalls: 1,
        maxMilliseconds: 5000,
        maxInputTokens: 10000,
        maxOutputTokens: 100,
        maxTotalTokens: 20000,
        maxInputBytes: 1000000,
        maxOutputBytes: 100000,
        maxRepeatedCalls: 1,
      },
    }),
  );
  vi.stubEnv('AELIQO_EVAL_PROVIDER_SECRET', secret);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const model = body.model === 'synthetic-weak' ? 'reported-weak' : 'reported-strong';
    return new Response(
      JSON.stringify({
        id: `response-${secret}`,
        model,
        choices: [{ message: { role: 'assistant', content: secret }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  try {
    expect(await runEvaluation(['--corpus', corpus, '--config', config, '--output', directory, '--live'])).toBe(2);
    const report = await readFile(join(directory, 'report.json'), 'utf8');
    expect(report).not.toContain(secret);
    const parsed = JSON.parse(report);
    expect(parsed.groups).toMatchObject([
      { label: 'weak', attemptedTrials: 1, unqualifiedTrials: 0, trials: 1 },
      { label: 'strong', attemptedTrials: 1, unqualifiedTrials: 0, trials: 1 },
    ]);
    expect(
      parsed.rows
        .filter((row: { mode: string }) => row.mode === 'governed-model-data')
        .every((row: { result: Record<string, unknown> }) => !Object.hasOwn(row.result, 'textDraft')),
    ).toBe(true);
  } finally {
    fetch.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('rejects duplicate reported snapshots even when configured aliases differ', () => {
  const connection = {
    protocol: 'openai-compatible-chat',
    baseURL: 'https://provider.example/v1',
    credentialEnvironment: 'AELIQO_EVAL_PROVIDER_SECRET',
    auth: { scheme: 'bearer' },
    capabilities: ['tool-calls'],
  };
  const budget = {
    maxTurns: 1,
    maxModelRequests: 1,
    maxToolCalls: 1,
    maxMilliseconds: 5000,
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxTotalTokens: 200,
    maxInputBytes: 100000,
    maxOutputBytes: 100000,
    maxRepeatedCalls: 1,
  };
  expect(
    parseConfig({
      version: '1',
      authorized: true,
      authorizationReference: 'Synthetic test authorization only',
      authorizedCorpusSha256: '0'.repeat(64),
      maxUSD: 1,
      trials: 1,
      models: [
        {
          label: 'weak',
          ...connection,
          model: 'alias-a',
          expectedReportedModel: 'same-snapshot',
          inputUSDPerMillion: 1,
          outputUSDPerMillion: 1,
          priceSource: 'synthetic',
        },
        {
          label: 'strong',
          ...connection,
          model: 'alias-b',
          expectedReportedModel: 'same-snapshot',
          inputUSDPerMillion: 1,
          outputUSDPerMillion: 1,
          priceSource: 'synthetic',
        },
      ],
      budget,
    }),
  ).toBeUndefined();
});

it('keeps a mismatched provider snapshot out of the model score denominator', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-eval-model-pin-'));
  const corpus = join(directory, 'corpus.json');
  const config = join(directory, 'config.json');
  const corpusBytes = JSON.stringify([developmentCase]);
  const connection = {
    protocol: 'openai-compatible-chat',
    baseURL: 'https://provider.example/v1',
    credentialEnvironment: 'AELIQO_EVAL_PROVIDER_SECRET',
    auth: { scheme: 'bearer' },
    capabilities: ['tool-calls', 'usage'],
  };
  const models = [
    {
      label: 'weak',
      ...connection,
      model: 'alias-weak',
      expectedReportedModel: 'reported-weak',
      inputUSDPerMillion: 1,
      outputUSDPerMillion: 1,
      priceSource: 'synthetic',
    },
    {
      label: 'strong',
      ...connection,
      model: 'alias-strong',
      expectedReportedModel: 'reported-strong',
      inputUSDPerMillion: 1,
      outputUSDPerMillion: 1,
      priceSource: 'synthetic',
    },
  ];
  const budget = {
    maxTurns: 1,
    maxModelRequests: 1,
    maxToolCalls: 1,
    maxMilliseconds: 5000,
    maxInputTokens: 10000,
    maxOutputTokens: 100,
    maxTotalTokens: 20000,
    maxInputBytes: 1000000,
    maxOutputBytes: 100000,
    maxRepeatedCalls: 1,
  };
  await writeFile(corpus, corpusBytes);
  await writeFile(
    config,
    JSON.stringify({
      version: '1',
      authorized: true,
      authorizationReference: 'Synthetic test authorization only',
      authorizedCorpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
      maxUSD: 1,
      trials: 1,
      models,
      budget,
    }),
  );
  vi.stubEnv('AELIQO_EVAL_PROVIDER_SECRET', 'synthetic');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const model = body.model === 'alias-weak' ? 'unexpected-snapshot' : 'reported-strong';
    return new Response(
      JSON.stringify({
        id: `response-${model}`,
        model,
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }),
      { status: 200 },
    );
  });
  try {
    expect(await runEvaluation(['--corpus', corpus, '--config', config, '--output', directory, '--live'])).toBe(2);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    expect(report.groups).toMatchObject([
      { label: 'weak', attemptedTrials: 1, unqualifiedTrials: 1, trials: 0, interval: null },
      { label: 'strong', attemptedTrials: 1, unqualifiedTrials: 0, trials: 1 },
    ]);
    expect(report.blocks).toContain(
      'Missing or non-authorized reported model snapshot for weak/development-records/trial-1.',
    );
  } finally {
    fetch.mockRestore();
    vi.unstubAllEnvs();
  }
});
