import { expect, it } from 'vitest';
import { runExplicitMcp, parseMcpEvaluationOutputs } from './mcp-baseline.js';
import { developmentCase, fixture, task } from './development.js';
import { scoreData } from './scoring.js';

it('evaluates the explicit development task through an official MCP client and separate stdio host', async () => {
  const baseline = await runExplicitMcp(fixture, task);
  expect(baseline.observation).toMatchObject({
    transport: 'official-sdk-stdio',
    discoveredTools: ['read_catalog', 'evaluate_task'],
    receiptState: 'data-ready',
    transportDetached: true,
    childExited: true,
    cleanupSucceeded: true,
  });
  expect(baseline.result.ok).toBe(true);
  if (!baseline.result.ok) return;
  expect(
    scoreData(baseline.result.value, developmentCase.expected, fixture.scopeDigest, fixture.sourceRevision),
  ).toEqual({
    dataCorrect: true,
    findings: [],
    uiTaskCompletion: null,
    narrativeGrounding: null,
  });
}, 30_000);

it('does not turn malformed MCP output data into an evaluated result', () => {
  for (const value of [
    undefined,
    null,
    {},
    { outputs: [] },
    { outputs: [{ descriptor: {}, rows: [] }] },
    { outputs: [{ descriptor: {}, rows: [null] }] },
  ])
    expect(parseMcpEvaluationOutputs(value).ok).toBe(false);
});
