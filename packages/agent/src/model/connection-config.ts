import type { ToolModelCapability } from './protocol.js';
import { configuration } from './connection-error.js';
import { readModelSecret } from './auth-handle.js';
import type {
  NormalizedToolModelConnection,
  ToolModelAuth,
  ToolModelConnectionOptions,
  ToolModelConnectionPolicy,
} from './connection-types.js';

const supportedCapabilities = new Set<ToolModelCapability>([
  'tool-calls',
  'usage',
  'request-cancellation',
  'input-token-estimate',
  'request-retry',
]);

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateAdapter(options: ToolModelConnectionOptions): void {
  const adapter = options?.adapter;
  if (
    adapter === null ||
    typeof adapter !== 'object' ||
    !text(adapter.id, 128) ||
    !text(adapter.endpointPath, 256) ||
    typeof adapter.encodeRequest !== 'function' ||
    typeof adapter.estimateInputTokens !== 'function' ||
    typeof adapter.decodeResponse !== 'function'
  )
    configuration('The model connection requires a complete protocol adapter.');
}

function validatePolicy(policy: ToolModelConnectionPolicy | undefined): asserts policy is ToolModelConnectionPolicy {
  if (policy?.allowExternalEgress !== true) configuration('The model connection requires an explicit egress grant.');
}

function validateModel(model: string | undefined): asserts model is string {
  if (!text(model, 160)) configuration('The model connection requires a bounded model identifier.');
}

function normalizeAuth(auth: ToolModelAuth | undefined): { readonly auth: ToolModelAuth; readonly secret?: string } {
  if (auth === null || typeof auth !== 'object' || !['none', 'bearer', 'header'].includes(auth.scheme))
    configuration('The model connection requires an explicit authentication scheme.');
  if (auth.scheme === 'none') {
    if ('secret' in auth || 'headerName' in auth)
      configuration('The no-auth model connection cannot include a credential or authentication header.');
    return { auth };
  }
  let secret: string;
  try {
    secret = readModelSecret(auth.secret);
  } catch {
    configuration('The model connection requires a valid server-owned credential.');
  }
  if (
    auth.scheme === 'header' &&
    (!text(auth.headerName, 128) ||
      ['authorization', 'cookie', 'proxy-authorization'].includes(auth.headerName.toLowerCase()))
  )
    configuration('The model connection requires a safe authentication header.');
  return { auth, secret };
}

function validateProtocolAndCredentials(parsed: URL): void {
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    configuration('The model endpoint URL must not contain credentials, query parameters, or fragments.');
}

function originIsCanonical(origin: string): boolean {
  try {
    return new URL(origin).origin === origin;
  } catch {
    return false;
  }
}

function validateAllowedOrigins(policy: ToolModelConnectionPolicy, origin: string): void {
  const allowedOrigins = policy.allowedOrigins;
  if (allowedOrigins === undefined) return;
  if (allowedOrigins.length === 0 || !allowedOrigins.includes(origin))
    configuration('The model endpoint origin is not allowlisted.');
  for (const allowed of allowedOrigins) {
    if (!originIsCanonical(allowed)) configuration('The model origin allowlist contains an invalid origin.');
  }
}

function validateNoAuthPolicy(auth: ToolModelAuth, policy: ToolModelConnectionPolicy, baseURL: string): void {
  if (auth.scheme !== 'none') return;
  const parsed = new URL(baseURL);
  const origin = parsed.origin;
  if (policy.allowedOrigins === undefined || !policy.allowedOrigins.includes(origin))
    configuration('The no-auth model connection requires an explicitly allowlisted endpoint origin.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    configuration('The no-auth model connection requires a local endpoint.');
}

function normalizeBaseURL(value: string, policy: ToolModelConnectionPolicy): string {
  if (!text(value, 2048)) configuration('The model endpoint requires a bounded absolute URL.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    configuration('The model endpoint URL is invalid.');
  }
  validateProtocolAndCredentials(parsed);
  if (parsed.protocol === 'http:' && policy.allowInsecureHttp !== true)
    configuration('The model endpoint requires explicit insecure-HTTP permission.');
  validateAllowedOrigins(policy, parsed.origin);
  return parsed.toString().replace(/\/$/u, '');
}

function endpointURL(baseURL: string, path: string): string {
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u.test(path)) configuration('The model adapter endpoint path is invalid.');
  return new URL(path.slice(1), new URL(`${baseURL}/`)).toString();
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  secret: string | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  if (headers === undefined) return result;
  for (const [name, value] of Object.entries(headers)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name) ||
      !text(value, 4096) ||
      (secret !== undefined && value.includes(secret))
    )
      configuration('The model connection contains an invalid or credential-bearing header.');
    const lower = name.toLowerCase();
    if (
      ['authorization', 'cookie', 'proxy-authorization', 'set-cookie', 'content-length', 'content-type'].includes(lower)
    )
      configuration('The model connection cannot override a protected HTTP header.');
    result[name] = value;
  }
  return Object.freeze(result);
}

function validateCapabilities(options: ToolModelConnectionOptions): void {
  const adapterCapabilities = new Set(options.adapter.capabilities);
  for (const capability of adapterCapabilities) {
    if (!supportedCapabilities.has(capability)) configuration('The model adapter declares an unknown capability.');
  }
  const requested = options.capabilities;
  if (!Array.isArray(requested) || requested.length === 0 || !requested.includes('tool-calls'))
    configuration('The model connection requires an explicit tool-calls capability declaration.');
  for (const capability of requested) {
    if (!adapterCapabilities.has(capability))
      configuration('The requested model capability is not supported by the adapter.');
  }
}

interface ConnectionLimits {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
}

function retryLimits(options: ToolModelConnectionOptions) {
  return {
    timeoutMs: options.timeoutMs ?? 60_000,
    maxAttempts: options.retry?.maxAttempts ?? 1,
    baseDelayMs: options.retry?.baseDelayMs ?? 100,
    maxDelayMs: options.retry?.maxDelayMs ?? 2_000,
  };
}

function payloadLimits(options: ToolModelConnectionOptions) {
  return {
    maxRequestBytes: options.budget?.maxRequestBytes ?? 512 * 1024,
    maxResponseBytes: options.budget?.maxResponseBytes ?? 2 * 1024 * 1024,
  };
}

function validRetryLimits(limits: ReturnType<typeof retryLimits>): boolean {
  return (
    integer(limits.timeoutMs, 1, 300_000) &&
    integer(limits.maxAttempts, 1, 4) &&
    integer(limits.baseDelayMs, 0, 5_000) &&
    integer(limits.maxDelayMs, limits.baseDelayMs, 30_000)
  );
}

function validPayloadLimits(limits: ReturnType<typeof payloadLimits>): boolean {
  return integer(limits.maxRequestBytes, 1, 8 * 1024 * 1024) && integer(limits.maxResponseBytes, 1, 8 * 1024 * 1024);
}

function normalizeLimits(options: ToolModelConnectionOptions): ConnectionLimits {
  const retry = retryLimits(options);
  const payload = payloadLimits(options);
  const valid = validRetryLimits(retry) && validPayloadLimits(payload);
  if (!valid) configuration('The model connection limits are outside the supported bounds.');
  return { ...retry, ...payload };
}

function validateCost(cost: ToolModelConnectionOptions['cost']): void {
  if (cost === undefined) return;
  const valid =
    (cost.currency === undefined || cost.currency === 'USD') &&
    (cost.inputUSDPerMillion === undefined || number(cost.inputUSDPerMillion, 0, 1_000_000)) &&
    (cost.outputUSDPerMillion === undefined || number(cost.outputUSDPerMillion, 0, 1_000_000)) &&
    (cost.source === undefined || text(cost.source, 512));
  if (!valid) configuration('The model cost policy is invalid.');
}

function resolveFetch(fetcher: ToolModelConnectionOptions['fetch']): NonNullable<ToolModelConnectionOptions['fetch']> {
  const fetch = fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  if (fetch === undefined) configuration('The model connection requires a fetch implementation.');
  return fetch;
}

export function normalizeToolModelConnection(options: ToolModelConnectionOptions): NormalizedToolModelConnection {
  validateAdapter(options);
  validatePolicy(options.policy);
  validateModel(options.model);
  const { auth, secret } = normalizeAuth(options.auth);
  const baseURL = normalizeBaseURL(options.baseURL, options.policy);
  validateNoAuthPolicy(auth, options.policy, baseURL);
  const url = endpointURL(baseURL, options.adapter.endpointPath);
  validateCapabilities(options);
  const limits = normalizeLimits(options);
  validateCost(options.cost);
  return Object.freeze({
    adapter: options.adapter,
    baseURL,
    url,
    model: options.model,
    auth,
    headers: normalizeHeaders(options.headers, secret),
    ...limits,
    ...(options.cost === undefined ? {} : { cost: options.cost }),
    fetch: resolveFetch(options.fetch),
    ...(options.onResponse === undefined ? {} : { onResponse: options.onResponse }),
  });
}
