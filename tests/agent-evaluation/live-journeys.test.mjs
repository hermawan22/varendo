import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateLiveJourneyPlan, reserveLiveJourneyCase } from './live-journeys.mjs';

const corpusPath = fileURLToPath(new URL('./j1-j3-corpus.json', import.meta.url));
const model = {
  protocol: 'openai-compatible-chat',
  endpoint: 'https://provider.example/v1/',
  model: 'approved-tool-model',
  expectedReportedModel: 'approved-tool-model',
  authScheme: 'bearer',
  capabilities: ['tool-calls', 'usage'],
  credentialEnvironment: 'AELIQO_MODEL_API_KEY',
  inputUSDPerMillion: 0.5,
  outputUSDPerMillion: 0.5,
  priceSource: 'owner-approved test rate',
};

async function approved() {
  const bytes = await readFile(corpusPath);
  return {
    corpus: JSON.parse(bytes.toString('utf8')),
    corpusBytes: bytes,
    config: {
      authorized: true,
      authorizationReference: 'test-only-authorization',
      corpusSha256: createHash('sha256').update(bytes).digest('hex'),
      maxRequests: 60,
      maxUSD: 1,
      maxModelRequestsPerCase: 4,
      maxInputTokensPerRequest: 32000,
      maxOutputTokensPerRequest: 2000,
      model,
    },
  };
}

test('corpus pins four safety outcomes for each real J1–J3 journey', async () => {
  const input = await approved();
  const plan = validateLiveJourneyPlan(input);
  assert.equal(plan.cases.length, 12);
  for (const journey of ['J1', 'J2', 'J3']) {
    assert.deepEqual(
      plan.cases
        .filter((item) => item.journey === journey)
        .map((item) => item.kind)
        .sort(),
      ['adversarial', 'ambiguity', 'success-id', 'unsupported'],
    );
  }
  assert.equal(plan.maxRequests, 60);
  assert.ok(plan.reservedMaximumUSD <= 1);
});

test('rejects altered corpus, model ambiguity, and excessive spend before any trial', async () => {
  const input = await approved();
  assert.throws(() => validateLiveJourneyPlan({ ...input, corpusBytes: Buffer.from('[]') }), /digest/u);
  assert.throws(
    () => validateLiveJourneyPlan({ ...input, config: { ...input.config, model: [model, model] } }),
    /one approved model/u,
  );
  assert.throws(() => validateLiveJourneyPlan({ ...input, config: { ...input.config, maxUSD: 1.01 } }), /\$1/u);
  assert.throws(() => validateLiveJourneyPlan({ ...input, config: { ...input.config, maxRequests: 61 } }), /60/u);
  assert.throws(
    () => validateLiveJourneyPlan({ ...input, config: { ...input.config, authorized: false } }),
    /authorization/u,
  );
  assert.throws(
    () =>
      validateLiveJourneyPlan({
        ...input,
        config: { ...input.config, model: { ...model, credentialEnvironment: 'AELIQO_OTHER_KEY' } },
      }),
    /credential/u,
  );
});

test('reserves worst-case requests and estimated cost before starting each case', async () => {
  const plan = validateLiveJourneyPlan(await approved());
  const first = reserveLiveJourneyCase(plan, { reservedRequests: 0, reservedUSD: 0 });
  assert.equal(first.reservedRequests, 4);
  assert.equal(first.reservedUSD, 0.068);
  assert.throws(() => reserveLiveJourneyCase(plan, { reservedRequests: 60, reservedUSD: 0 }), /request ceiling/u);
  assert.throws(() => reserveLiveJourneyCase(plan, { reservedRequests: 0, reservedUSD: 0.99 }), /spend ceiling/u);
});

test('the DeepSeek test template pins this corpus and remains unauthorized', async () => {
  const input = await approved();
  const template = JSON.parse(await readFile(new URL('./live-journey-config.example.json', import.meta.url), 'utf8'));
  assert.equal(template.authorized, false);
  assert.equal(template.corpusSha256, input.config.corpusSha256);
  const plan = validateLiveJourneyPlan({
    ...input,
    config: { ...template, authorized: true, authorizationReference: 'test-only-authorization' },
  });
  assert.equal(plan.model.model, 'deepseek-flash');
  assert.ok(plan.reservedMaximumUSD < 1);
});
