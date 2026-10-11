import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readModelConfiguration } from '../../examples/local-agent/runner/model-config.mjs';
import { reserveLiveJourneyCase, validateLiveJourneyPlan } from './live-journeys.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const repositoryRoot = resolve(import.meta.dirname, '../..');
const sourceDigest = () =>
  execFileSync('node', ['scripts/source-digest.mjs'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();

function modelMatches(configured, approved) {
  return (
    configured?.protocol === approved.protocol &&
    configured.model === approved.model &&
    configured.endpoint.href === new URL(approved.endpoint).href &&
    configured.auth.scheme === approved.authScheme &&
    (approved.authScheme !== 'header' || configured.auth.headerName === approved.authHeaderName) &&
    configured.capabilities.length === approved.capabilities.length &&
    configured.capabilities.every((item) => approved.capabilities.includes(item))
  );
}

function exactJourneyResult(testCase, after) {
  const text = after.text ?? '';
  const chartRows = JSON.stringify(after.chartRows);
  switch (testCase.id) {
    case 'J1-success-id':
      return (
        text.includes('Ada Chen') &&
        text.includes('Jakarta') &&
        !['Sam Rivera', 'Iman Putra', 'Lee Morgan'].some((name) => text.includes(name))
      );
    case 'J2-success-id':
      return (
        text.includes('Tren') &&
        text.includes('Tingkat kehadiran') &&
        text.includes('Lihat tabel data') &&
        text.includes('Periode 1–5 September 2026') &&
        chartRows ===
          JSON.stringify([
            [
              ['2026-09-01', '1'],
              ['2026-09-02', '0.5'],
              ['2026-09-03', '1'],
            ],
          ]) &&
        !/2026-09-0[4-6]/u.test(text)
      );
    case 'J3-success-id':
      return (
        text.includes('Present employees 2') &&
        text.includes('Ada 1 Sam 1') &&
        !text.includes('Lee') &&
        chartRows ===
          JSON.stringify([
            [
              ['2026-09-01', '1'],
              ['2026-09-02', '1'],
            ],
          ]) &&
        after.needs === 'summary,trend,breakdown' &&
        after.presentation === 'registered'
      );
    default:
      return false;
  }
}

export function scoreCase(testCase, observation) {
  const { receipt, before, after, providerModels, providerRequests } = observation;
  const identityQualified =
    receipt.modelRequests > 0 &&
    providerRequests === receipt.modelRequests &&
    providerModels.length === receipt.modelRequests &&
    providerModels.every((value) => value === observation.expectedReportedModel);
  const committed = receipt.stop === 'renderer-ready';
  const unchanged = digest(JSON.stringify(before)) === digest(JSON.stringify(after));
  const representationReady =
    testCase.expectation.representation === 'table'
      ? after.tableCount > 0
      : testCase.expectation.representation === 'trend'
        ? after.chartCount > 0
        : after.needs === 'summary,trend,breakdown' && after.tableCount > 0 && after.chartCount > 0;
  const evidenceReady =
    testCase.expectation.evidence === null ||
    after.text.includes(testCase.expectation.evidence) ||
    after.needs === testCase.expectation.evidence;
  const correct = testCase.expectation.commit
    ? committed && representationReady && evidenceReady && exactJourneyResult(testCase, after)
    : receipt.stop === 'no-commit' && unchanged;
  return { correct, identityQualified, committed, unchanged, representationReady, evidenceReady };
}

/** Writes exact bounded evidence; a dry run never opens the browser or provider. */
export async function runLiveJourneyEvaluation({
  corpusPath,
  configPath,
  outputDirectory,
  live = false,
  openDriver = async (plan) => (await import('./live-browser/driver.mjs')).openLiveBrowserDriver(plan),
}) {
  const bytes = await readFile(resolve(corpusPath));
  const corpus = JSON.parse(bytes.toString('utf8'));
  const beforeSource = sourceDigest();
  const rows = [];
  const blocks = [];
  let plan;
  if (!live) blocks.push('Live provider execution was not authorized for execution in this run.');
  else if (!configPath) blocks.push('An owner-approved live configuration is required before provider egress.');
  else {
    try {
      const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
      plan = validateLiveJourneyPlan({ corpus, corpusBytes: bytes, config });
      if (!modelMatches(readModelConfiguration(process.env), plan.model))
        blocks.push('The trusted process model profile differs from the owner-approved model profile.');
      if (!process.env[plan.model.credentialEnvironment])
        blocks.push('The approved server-only model credential is unavailable.');
    } catch (error) {
      blocks.push(error instanceof Error ? error.message : 'The live configuration is invalid.');
    }
  }
  if (plan !== undefined && blocks.length === 0) {
    let reserved = { reservedRequests: 0, reservedUSD: 0 };
    const driver = await openDriver(plan);
    try {
      for (const testCase of plan.cases) {
        reserved = reserveLiveJourneyCase(plan, reserved);
        const beforeCounters = driver.counters?.();
        try {
          const observation = await driver.runCase(testCase);
          const score = scoreCase(testCase, observation);
          const estimatedUSD =
            (observation.observedUsage.inputTokens * plan.model.inputUSDPerMillion +
              observation.observedUsage.outputTokens * plan.model.outputUSDPerMillion) /
            1_000_000;
          rows.push({
            caseId: testCase.id,
            journey: testCase.journey,
            kind: testCase.kind,
            status: score.correct && score.identityQualified ? 'passed' : 'failed',
            score,
            result: observation.receipt,
            toolTrace: observation.toolTrace ?? [],
            providerRequests: observation.providerRequests,
            observedUsage: observation.observedUsage,
            providerModels: observation.providerModels,
            before: observation.before,
            after: observation.after,
            usageEstimatedUSD: estimatedUSD,
            chargedUSD: null,
            priceSource: plan.model.priceSource,
          });
        } catch (error) {
          const afterCounters = driver.counters?.();
          const providerRequests =
            beforeCounters && afterCounters ? afterCounters.requests - beforeCounters.requests : 0;
          const observedUsage =
            beforeCounters && afterCounters
              ? {
                  inputTokens: afterCounters.inputTokens - beforeCounters.inputTokens,
                  outputTokens: afterCounters.outputTokens - beforeCounters.outputTokens,
                }
              : { inputTokens: 0, outputTokens: 0 };
          rows.push({
            caseId: testCase.id,
            journey: testCase.journey,
            kind: testCase.kind,
            status: 'failed',
            error: error instanceof Error ? error.message : 'The trial failed.',
            providerRequests,
            observedUsage,
            usageEstimatedUSD:
              (observedUsage.inputTokens * plan.model.inputUSDPerMillion +
                observedUsage.outputTokens * plan.model.outputUSDPerMillion) /
              1_000_000,
          });
          blocks.push(`Trial ${testCase.id} failed; no fallback result was accepted.`);
        }
      }
    } finally {
      await driver.close();
    }
  }
  const afterSource = sourceDigest();
  if (afterSource !== beforeSource) blocks.push('Source changed during the run.');
  if (rows.some((row) => row.status === 'failed'))
    blocks.push('One or more J1–J3 model trials failed their expected outcome or provider identity check.');
  const report = {
    schemaVersion: 1,
    status:
      blocks.length === 0 && rows.length === 12 && rows.every((row) => row.status === 'passed') ? 'passed' : 'blocked',
    sourceDigest: beforeSource,
    sourceChangedDuringRun: afterSource !== beforeSource,
    corpus: { path: resolve(corpusPath), sha256: digest(bytes), caseIds: corpus.map((item) => item.id) },
    authorization:
      plan === undefined
        ? null
        : {
            reference: plan.authorizationReference,
            model: plan.model.model,
            protocol: plan.model.protocol,
            endpointOrigin: new URL(plan.model.endpoint).origin,
            maxRequests: plan.maxRequests,
            maxUSD: plan.maxUSD,
            reservedMaximumUSD: plan.reservedMaximumUSD,
          },
    requestsUsed: rows.reduce((total, row) => total + (row.providerRequests ?? 0), 0),
    usageEstimatedUSD: rows.reduce((total, row) => total + (row.usageEstimatedUSD ?? 0), 0),
    blocks,
    rows,
  };
  await mkdir(resolve(outputDirectory), { recursive: true });
  await writeFile(join(resolve(outputDirectory), 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
