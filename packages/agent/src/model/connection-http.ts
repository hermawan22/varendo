import type { ToolModelRequest, ToolModelResponse } from './types.js';
import { ToolModelProviderError } from './connection-error.js';
import { readModelSecret } from './auth-handle.js';
import { withToolModelCost } from './connection-cost.js';
import type { NormalizedToolModelConnection, ToolModelProviderObservation } from './connection-types.js';
import { isRecord } from '../guards.js';

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function linkAbort(parent: AbortSignal, controller: AbortController): () => void {
  const abort = (): void => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener('abort', abort, { once: true });
  return () => parent.removeEventListener('abort', abort);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ToolModelProviderError('cancelled', 'The model request was cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new ToolModelProviderError('cancelled', 'The model request was cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (response.body === null) {
    const value = await response.text();
    if (byteLength(value) > limit)
      throw new ToolModelProviderError('response-too-large', 'The model response exceeded its byte limit.');
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        output += decoder.decode();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ToolModelProviderError('response-too-large', 'The model response exceeded its byte limit.');
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return output;
}

function providerCode(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    const source = isRecord(parsed) ? (parsed as { error?: unknown }).error : undefined;
    const code = isRecord(source) ? (source as { code?: unknown }).code : undefined;
    return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,128}$/u.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

async function httpError(response: Response): Promise<ToolModelProviderError> {
  const status = response.status;
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  let code: string | undefined;
  try {
    code = providerCode(await boundedText(response, 64 * 1024));
  } catch {
    /* Error bodies are never surfaced. */
  }
  const authenticationFailure = status === 401 || status === 403;
  return new ToolModelProviderError(
    authenticationFailure ? 'authentication' : 'http',
    `The model endpoint returned HTTP ${status}.`,
    {
      status,
      retryable: authenticationFailure ? false : retryable,
      ...(code === undefined ? {} : { providerCode: code }),
    },
  );
}

function normalizeFailure(error: unknown, timedOut: boolean, signal: AbortSignal): ToolModelProviderError {
  if (error instanceof ToolModelProviderError) return error;
  if (timedOut)
    return new ToolModelProviderError('timeout', 'The model request exceeded its timeout.', { retryable: true });
  if (signal.aborted) return new ToolModelProviderError('cancelled', 'The model request was cancelled.');
  return new ToolModelProviderError('network', 'The model endpoint could not be reached.', { retryable: true });
}

function requestHeaders(config: NormalizedToolModelConnection): Record<string, string> {
  const result: Record<string, string> = {
    ...config.headers,
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (config.auth.scheme === 'none') return result;
  const secret = readModelSecret(config.auth.secret);
  if (config.auth.scheme === 'bearer') result.authorization = `Bearer ${secret}`;
  else result[config.auth.headerName] = secret;
  return result;
}

function encodedRequest(config: NormalizedToolModelConnection, request: ToolModelRequest): string {
  let value: unknown;
  try {
    value = config.adapter.encodeRequest({ request, model: config.model });
  } catch {
    throw new ToolModelProviderError('malformed-response', 'The model request could not be encoded.');
  }
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch {
    throw new ToolModelProviderError('malformed-response', 'The model request could not be encoded.');
  }
  if (typeof body !== 'string' || byteLength(body) > config.maxRequestBytes)
    throw new ToolModelProviderError('request-too-large', 'The model request exceeded its byte limit.');
  return body;
}

function decodedResponse(config: NormalizedToolModelConnection, tokens: number, body: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch {
    throw new ToolModelProviderError('malformed-response', 'The model endpoint returned invalid JSON.');
  }
  try {
    return config.adapter.decodeResponse(decoded, { model: config.model, estimatedInputTokens: tokens });
  } catch {
    throw new ToolModelProviderError('malformed-response', 'The model endpoint returned a malformed response.');
  }
}

function observe(config: NormalizedToolModelConnection, response: ToolModelResponse): void {
  if (config.onResponse === undefined) return;
  const observation: ToolModelProviderObservation = Object.freeze({
    protocol: config.adapter.id,
    configuredModel: config.model,
    ...(response.provider?.model === undefined ? {} : { providerModel: response.provider.model }),
    ...(response.provider?.responseId === undefined ? {} : { responseId: response.provider.responseId }),
    usage: response.usage,
  });
  try {
    config.onResponse(observation);
  } catch {
    /* Observability cannot change an accepted model response. */
  }
}

function withUsage(config: NormalizedToolModelConnection, response: ToolModelResponse): ToolModelResponse {
  const usage = withToolModelCost(response.usage, config.cost);
  if (usage === response.usage) return response;
  return {
    ...response,
    usage,
    ...(response.provider === undefined ? {} : { provider: { ...response.provider, usage } }),
  };
}

async function sendAttempt(
  config: NormalizedToolModelConnection,
  body: string,
  tokens: number,
  signal: AbortSignal,
): Promise<ToolModelResponse> {
  const controller = new AbortController();
  const unlink = linkAbort(signal, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  try {
    const response = await config.fetch(config.url, {
      method: 'POST',
      redirect: 'error',
      headers: requestHeaders(config),
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw await httpError(response);
    const text = await boundedText(response, config.maxResponseBytes);
    const decoded = decodedResponse(config, tokens, text);
    const normalized = withUsage(config, decoded);
    observe(config, normalized);
    return normalized;
  } catch (error) {
    throw normalizeFailure(error, timedOut, signal);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

function estimatedTokens(config: NormalizedToolModelConnection, request: ToolModelRequest): number {
  const value = config.adapter.estimateInputTokens(request);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
    throw new ToolModelProviderError('malformed-response', 'The model adapter returned an invalid token estimate.');
  return value;
}

export async function completeToolModelRequest(
  config: NormalizedToolModelConnection,
  request: ToolModelRequest,
  signal: AbortSignal,
): Promise<ToolModelResponse> {
  if (signal.aborted) throw new ToolModelProviderError('cancelled', 'The model request was cancelled.');
  const body = encodedRequest(config, request);
  const tokens = estimatedTokens(config, request);
  let last: ToolModelProviderError | undefined;
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await sendAttempt(config, body, tokens, signal);
    } catch (error) {
      const normalized = normalizeFailure(error, false, signal);
      last = normalized;
      if (!normalized.retryable || attempt + 1 >= config.maxAttempts) throw normalized;
      await wait(Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt), signal);
    }
  }
  throw last ?? new ToolModelProviderError('network', 'The model endpoint could not be reached.', { retryable: true });
}

export function estimateToolModelTokens(config: NormalizedToolModelConnection, request: ToolModelRequest): number {
  return estimatedTokens(config, request);
}
