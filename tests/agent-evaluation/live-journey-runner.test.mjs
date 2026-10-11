import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLiveJourneyEvaluation, scoreCase } from './live-journey-runner.mjs';

test('negative trial needs a real identified model call and a no-commit stop', () => {
  const testCase = { expectation: { commit: false, representation: null, evidence: null } };
  const state = { tableCount: 0, chartCount: 0, needs: '', text: '' };
  const base = { before: state, after: state, expectedReportedModel: 'deepseek-flash' };
  const zero = scoreCase(testCase, {
    ...base,
    receipt: { stop: 'failed', modelRequests: 0 },
    providerRequests: 0,
    providerModels: [],
  });
  assert.equal(zero.correct, false);
  assert.equal(zero.identityQualified, false);
  const identified = scoreCase(testCase, {
    ...base,
    receipt: { stop: 'no-commit', modelRequests: 1 },
    providerRequests: 1,
    providerModels: ['deepseek-flash'],
  });
  assert.equal(identified.correct, true);
  assert.equal(identified.identityQualified, true);
});

test('a J2 live success must show Indonesian copy and the exact bounded daily rates', () => {
  const testCase = {
    id: 'J2-success-id',
    journey: 'J2',
    kind: 'success-id',
    expectation: { commit: true, representation: 'trend', evidence: '2026-09-01' },
  };
  const base = {
    receipt: { stop: 'renderer-ready', modelRequests: 2 },
    before: { text: '', tableCount: 0, chartCount: 0 },
    providerRequests: 2,
    providerModels: ['deepseek-flash', 'deepseek-flash'],
    expectedReportedModel: 'deepseek-flash',
  };
  const english = scoreCase(testCase, {
    ...base,
    after: {
      text: 'Trend Attendance rate View data table 2026-09-01 1 2026-09-02 0.5 2026-09-03 1',
      chartCount: 1,
      chartRows: [
        [
          ['2026-09-01', '1'],
          ['2026-09-02', '0.5'],
          ['2026-09-03', '1'],
        ],
      ],
    },
  });
  assert.equal(english.correct, false);
  const wrongRate = scoreCase(testCase, {
    ...base,
    after: {
      text: 'Tren Tingkat kehadiran Lihat tabel data 2026-09-01 1 2026-09-02 1 2026-09-03 1',
      chartCount: 1,
      chartRows: [
        [
          ['2026-09-01', '1'],
          ['2026-09-02', '1'],
          ['2026-09-03', '1'],
        ],
      ],
    },
  });
  assert.equal(wrongRate.correct, false);
  const exact = scoreCase(testCase, {
    ...base,
    after: {
      text: 'Tren Periode 1–5 September 2026 Tingkat kehadiran Lihat tabel data 2026-09-01 1 2026-09-02 0.5 2026-09-03 1',
      chartCount: 1,
      chartRows: [
        [
          ['2026-09-01', '1'],
          ['2026-09-02', '0.5'],
          ['2026-09-03', '1'],
        ],
      ],
    },
  });
  assert.equal(exact.correct, true);
});

test('a J1 or J3 render cannot pass with a wrong scope or extra person', () => {
  const base = {
    receipt: { stop: 'renderer-ready', modelRequests: 1 },
    before: { text: '', tableCount: 0, chartCount: 0 },
    providerRequests: 1,
    providerModels: ['deepseek-flash'],
    expectedReportedModel: 'deepseek-flash',
  };
  const j1 = { id: 'J1-success-id', expectation: { commit: true, representation: 'table', evidence: 'Jakarta' } };
  assert.equal(
    scoreCase(j1, {
      ...base,
      after: { text: 'Ada Chen Jakarta Sam Rivera Lisbon', tableCount: 1, chartCount: 0 },
    }).correct,
    false,
  );
  const j3 = {
    id: 'J3-success-id',
    expectation: { commit: true, representation: 'workspace', evidence: 'summary,trend,breakdown' },
  };
  assert.equal(
    scoreCase(j3, {
      ...base,
      after: {
        text: 'Present employees 3 Ada 1 Sam 1 Lee 1',
        needs: 'summary,trend,breakdown',
        presentation: 'registered',
        tableCount: 1,
        chartCount: 1,
      },
    }).correct,
    false,
  );
});

test('dry run records the exact corpus digest and makes no provider or browser call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-live-journeys-'));
  const source = new URL('./j1-j3-corpus.json', import.meta.url);
  const bytes = await readFile(source);
  const corpus = join(directory, 'corpus.json');
  await writeFile(corpus, bytes);
  const report = await runLiveJourneyEvaluation({
    corpusPath: corpus,
    outputDirectory: directory,
    live: false,
    openDriver: () => {
      throw new Error('The dry run tried to open the model/browser driver.');
    },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.corpus.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.rows.length, 0);
  assert.match(report.blocks.join(' '), /not authorized for execution/u);
});

test('the committed example configuration cannot dispatch a paid model trial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-live-journeys-template-'));
  const report = await runLiveJourneyEvaluation({
    corpusPath: new URL('./j1-j3-corpus.json', import.meta.url).pathname,
    configPath: new URL('./live-journey-config.example.json', import.meta.url).pathname,
    outputDirectory: directory,
    live: true,
    openDriver: () => {
      throw new Error('The unauthorized template opened a model driver.');
    },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.rows.length, 0);
  assert.match(report.blocks.join(' '), /authorization/u);
});
