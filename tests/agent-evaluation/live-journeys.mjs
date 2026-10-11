import { createHash } from 'node:crypto';

const JOURNEYS = ['J1', 'J2', 'J3'];
const KINDS = ['success-id', 'ambiguity', 'unsupported', 'adversarial'];
const CAPABILITIES = new Set(['tool-calls', 'usage', 'request-cancellation', 'input-token-estimate']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, max = 512) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validateCorpus(cases) {
  if (!Array.isArray(cases) || cases.length !== 12) throw new Error('The J1–J3 corpus must contain exactly 12 cases.');
  const ids = new Set();
  for (const journey of JOURNEYS)
    for (const kind of KINDS) {
      const matches = cases.filter((item) => item?.journey === journey && item?.kind === kind);
      if (matches.length !== 1) throw new Error(`The corpus requires one ${journey}/${kind} case.`);
    }
  for (const item of cases) {
    if (!object(item) || !bounded(item.id, 80) || ids.has(item.id) || !bounded(item.prompt, 4000))
      throw new Error('The corpus contains an invalid or repeated case.');
    ids.add(item.id);
    if (
      !object(item.expectation) ||
      typeof item.expectation.commit !== 'boolean' ||
      item.expectation.commit !== (item.kind === 'success-id') ||
      !(item.expectation.representation === null || bounded(item.expectation.representation, 80)) ||
      !(item.expectation.evidence === null || bounded(item.expectation.evidence, 160))
    )
      throw new Error(`The ${item.id} expectation is invalid.`);
  }
}

function validateModel(model) {
  if (Array.isArray(model) || !object(model)) throw new Error('Live journeys require exactly one approved model.');
  if (
    model.protocol !== 'openai-compatible-chat' ||
    !bounded(model.model, 160) ||
    !bounded(model.expectedReportedModel, 256) ||
    !bounded(model.priceSource, 512) ||
    model.credentialEnvironment !== 'AELIQO_MODEL_API_KEY' ||
    !['bearer', 'header'].includes(model.authScheme) ||
    !Array.isArray(model.capabilities) ||
    !model.capabilities.includes('tool-calls') ||
    new Set(model.capabilities).size !== model.capabilities.length ||
    !model.capabilities.every((capability) => CAPABILITIES.has(capability))
  )
    throw new Error('The approved model profile or credential binding is incomplete or unsupported.');
  if (
    model.authScheme === 'header' &&
    (!bounded(model.authHeaderName, 128) || !/^[A-Za-z0-9-]+$/u.test(model.authHeaderName))
  )
    throw new Error('The approved header credential needs an explicit header name.');
  if (model.authScheme === 'bearer' && model.authHeaderName !== undefined)
    throw new Error('The approved bearer credential cannot name a custom header.');
  for (const rate of [model.inputUSDPerMillion, model.outputUSDPerMillion])
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw new Error('The approved model needs positive explicit USD token prices.');
  let endpoint;
  try {
    endpoint = new URL(model.endpoint);
  } catch {
    throw new Error('The approved model endpoint is invalid.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error('The approved model endpoint must use HTTPS without URL credentials or query data.');
}

/** Preflight only: every model call still requires an explicit --live execution path. */
export function validateLiveJourneyPlan({ corpus, corpusBytes, config }) {
  if (!object(config) || config.authorized !== true || !bounded(config.authorizationReference))
    throw new Error('Explicit owner authorization is required for live journeys.');
  const digest = createHash('sha256').update(corpusBytes).digest('hex');
  if (config.corpusSha256 !== digest) throw new Error('The owner-approved corpus digest does not match these bytes.');
  validateCorpus(corpus);
  validateModel(config.model);
  if (!integer(config.maxRequests, 1, 60)) throw new Error('The request ceiling must be at most 60.');
  if (!integer(config.maxModelRequestsPerCase, 1, 4))
    throw new Error('Each journey case permits at most four model requests.');
  if (!integer(config.maxInputTokensPerRequest, 1, 32_000) || !integer(config.maxOutputTokensPerRequest, 1, 2_000))
    throw new Error('The per-request token bounds are invalid.');
  if (typeof config.maxUSD !== 'number' || !Number.isFinite(config.maxUSD) || config.maxUSD <= 0 || config.maxUSD > 1)
    throw new Error('The live journey spend ceiling must be at most $1.');
  const requestsPerCase = config.maxModelRequestsPerCase;
  const reservedCaseUSD =
    (requestsPerCase *
      (config.maxInputTokensPerRequest * config.model.inputUSDPerMillion +
        config.maxOutputTokensPerRequest * config.model.outputUSDPerMillion)) /
    1_000_000;
  const reservedMaximumUSD = reservedCaseUSD * corpus.length;
  if (requestsPerCase * corpus.length > config.maxRequests || reservedMaximumUSD > config.maxUSD)
    throw new Error('The full corpus cannot fit within the approved request and spend ceilings.');
  return Object.freeze({
    cases: corpus,
    corpusSha256: digest,
    model: config.model,
    authorizationReference: config.authorizationReference,
    maxRequests: config.maxRequests,
    maxUSD: config.maxUSD,
    requestsPerCase,
    reservedCaseUSD,
    reservedMaximumUSD,
  });
}

/** Reserve a complete trial before provider egress; never silently skip a case. */
export function reserveLiveJourneyCase(plan, spent) {
  const reservedRequests = spent.reservedRequests + plan.requestsPerCase;
  if (reservedRequests > plan.maxRequests) throw new Error('The approved model request ceiling would be exceeded.');
  const reservedUSD = spent.reservedUSD + plan.reservedCaseUSD;
  if (reservedUSD > plan.maxUSD) throw new Error('The approved model spend ceiling would be exceeded.');
  return { reservedRequests, reservedUSD };
}
