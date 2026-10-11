import { parseResultEvent, WIRE_LIMITS } from '@varendo/core';
import type { Diagnostic, Outcome, QuerySpec } from '@varendo/core';
import type { AuthorizeRead, CatalogTarget, PlanTarget, ReadContext, ReadGrant } from '../types.js';
import { assertSafeId, canonical, failure, isSafePositive } from './shared.js';

const DEFAULT_SCOPE = 'scope-public';

const authorizationFailure = (message: string) => failure<ReadGrant>('data.authorization', message);

function validIdentifier(value: unknown, label: string): boolean {
  try {
    assertSafeId(value as string, label);
    return typeof value === 'string';
  } catch {
    return false;
  }
}

function validateReadGrant(grant: ReadGrant): Outcome<ReadGrant> {
  if (!isRecord(grant)) return authorizationFailure('The data service authorization returned an invalid outcome.');
  if (!validIdentifier(grant.scopeDigest, 'scopeDigest'))
    return authorizationFailure('The data service authorization returned an invalid scope digest.');
  if (grant.cursorPartition !== undefined && !validIdentifier(grant.cursorPartition, 'cursorPartition'))
    return authorizationFailure('The data service authorization returned an invalid cursor partition.');
  if (grant.policyRevision !== undefined && !validIdentifier(grant.policyRevision, 'policyRevision'))
    return authorizationFailure('The data service authorization returned an invalid policy revision.');
  const entityError = validateEntityScope(grant.entities);
  if (entityError !== undefined) return authorizationFailure(entityError);
  const fieldError = validateFieldScope(grant.fields);
  if (fieldError !== undefined) return authorizationFailure(fieldError);
  const budgetError = validateBudgetScope(grant.maxBudget);
  if (budgetError !== undefined) return authorizationFailure(budgetError);
  if (grant.rowPolicy !== undefined && typeof grant.rowPolicy !== 'function')
    return authorizationFailure('The data service authorization returned an invalid row policy.');
  return { ok: true, value: grant };
}

function validateEntityScope(entities: ReadGrant['entities']): string | undefined {
  if (entities === undefined) return undefined;
  if (!Array.isArray(entities) || entities.length > WIRE_LIMITS.array || hasDuplicates(entities))
    return 'The data service authorization returned an invalid entity scope.';
  if (!entities.every((entity) => validIdentifier(entity, 'entity scope')))
    return 'The data service authorization returned an invalid entity scope.';
  return undefined;
}

function validateFieldScope(fields: ReadGrant['fields']): string | undefined {
  if (fields === undefined) return undefined;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields))
    return 'The data service authorization returned an invalid field scope.';
  for (const [entity, fieldIds] of Object.entries(fields)) {
    if (!validIdentifier(entity, 'field scope entity') || !validFieldList(fieldIds))
      return 'The data service authorization returned an invalid field scope.';
  }
  return undefined;
}

function validFieldList(fields: readonly string[]): boolean {
  if (!Array.isArray(fields) || fields.length > WIRE_LIMITS.array || hasDuplicates(fields)) return false;
  return fields.every((field) => validIdentifier(field, 'field scope'));
}

function validateBudgetScope(budget: ReadGrant['maxBudget']): string | undefined {
  if (budget === undefined) return undefined;
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget))
    return 'The data service authorization returned an invalid budget.';
  const allowed = new Set(['maxRows', 'maxBytes', 'maxMessages', 'maxMilliseconds', 'maxColumns']);
  for (const [key, value] of Object.entries(budget)) {
    if (!allowed.has(key) || !isSafePositive(value))
      return 'The data service authorization returned an invalid budget.';
  }
  return undefined;
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function denialDiagnostics(value: unknown): Outcome<ReadGrant> {
  if (!isRecord(value)) return authorizationFailure('The data service authorization returned malformed diagnostics.');
  const diagnosticsValue = value.diagnostics;
  if (
    !Array.isArray(diagnosticsValue) ||
    diagnosticsValue.length === 0 ||
    diagnosticsValue.length > WIRE_LIMITS.diagnostics
  )
    return authorizationFailure('The data service authorization returned malformed diagnostics.');
  const diagnostics: Diagnostic[] = [];
  for (const candidate of diagnosticsValue) {
    const parsed = parseResultEvent({ kind: 'error', requestId: 'authorization', error: candidate });
    if (!parsed.ok || parsed.value.kind !== 'error')
      return authorizationFailure('The data service authorization returned malformed diagnostics.');
    diagnostics.push(parsed.value.error);
  }
  return { ok: false, diagnostics: diagnostics as [Diagnostic, ...Diagnostic[]] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuthorizationOutcome(value: unknown): Outcome<ReadGrant> {
  if (!isRecord(value)) return authorizationFailure('The data service authorization returned an invalid outcome.');
  if (value.ok === true) return validateReadGrant(value.value as ReadGrant);
  if (value.ok === false) return denialDiagnostics(value);
  return authorizationFailure('The data service authorization returned an invalid outcome.');
}

interface Deadline {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly cleanup: () => void;
}

function makeDeadline(context: ReadContext, milliseconds: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (context.signal?.aborted) controller.abort();
  else context.signal?.addEventListener('abort', onParentAbort, { once: true });
  const delay = Math.min(Math.max(0, milliseconds), 2_147_483_647);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, delay);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export function resolveValueWithAbort<T>(
  value: Promise<T> | T,
  signal: AbortSignal | undefined,
  code: string,
  message: string,
): Promise<Outcome<T>> {
  let pending: Promise<T>;
  try {
    pending = Promise.resolve(value);
  } catch {
    return Promise.resolve(failure(code, message));
  }
  if (signal === undefined) return resolveWithoutSignal(pending, code, message);
  if (signal.aborted) return Promise.resolve(failure('data.aborted', 'The result execution was cancelled.'));
  return resolveWithSignal(pending, signal, code, message);
}

function resolveWithoutSignal<T>(pending: Promise<T>, code: string, message: string): Promise<Outcome<T>> {
  return pending.then(
    (resolved) => ({ ok: true, value: resolved }) as const,
    () => failure(code, message),
  );
}

function resolveWithSignal<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  code: string,
  message: string,
): Promise<Outcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Outcome<T>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish(failure('data.aborted', 'The result execution was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (resolved) => finish({ ok: true, value: resolved }),
      () => finish(failure(code, message)),
    );
  });
}

async function authorizeResult(
  authorize: AuthorizeRead | undefined,
  operation: 'describe' | 'plan' | 'execute',
  requestId: string,
  target: CatalogTarget | PlanTarget,
  context: ReadContext,
  query?: QuerySpec,
): Promise<Outcome<ReadGrant>> {
  if (authorize === undefined) return defaultGrant(context);
  const pending = startAuthorization(authorize, {
    operation,
    requestId,
    target,
    context,
    ...(query === undefined ? {} : { query }),
  });
  if (!pending.ok) return pending;
  return awaitAuthorization(pending.value, context.signal);
}

function defaultGrant(context: ReadContext): Promise<Outcome<ReadGrant>> {
  if (context.signal?.aborted)
    return Promise.resolve(failure('data.aborted', 'The data service authorization was cancelled.'));
  return Promise.resolve({ ok: true, value: { scopeDigest: DEFAULT_SCOPE, cursorPartition: DEFAULT_SCOPE } });
}

function startAuthorization(
  authorize: AuthorizeRead,
  input: {
    readonly operation: 'describe' | 'plan' | 'execute';
    readonly requestId: string;
    readonly target: CatalogTarget | PlanTarget;
    readonly context: ReadContext;
    readonly query?: QuerySpec;
  },
): Outcome<Promise<Outcome<ReadGrant>>> {
  try {
    const { query, ...required } = input;
    const result = authorize({ ...required, ...(query === undefined ? {} : { query }) });
    return { ok: true, value: Promise.resolve(result) };
  } catch {
    return failure('data.authorization', 'The data service authorization failed.');
  }
}

function awaitAuthorization(
  pending: Promise<Outcome<ReadGrant>>,
  signal: AbortSignal | undefined,
): Promise<Outcome<ReadGrant>> {
  if (signal === undefined)
    return pending.then(normalizeAuthorizationOutcome, () =>
      failure('data.authorization', 'The data service authorization failed.'),
    );
  if (signal.aborted) return Promise.resolve(failure('data.aborted', 'The data service authorization was cancelled.'));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Outcome<ReadGrant>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result.ok ? validateReadGrant(result.value) : result);
    };
    const onAbort = () => finish(failure('data.aborted', 'The data service authorization was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (result) => finish(normalizeAuthorizationOutcome(result)),
      () => finish(failure('data.authorization', 'The data service authorization failed.')),
    );
  });
}

/**
 * Await one host/expensive operation under a fresh linked deadline. The
 * expired callback supplies the outcome when no budget remains; a lapsed
 * deadline that was not a caller abort fails with `data.budget`.
 */
export async function awaitBoundedResult<T>(
  context: ReadContext,
  milliseconds: number,
  expired: () => Outcome<T>,
  timeoutMessage: string,
  run: (signal: AbortSignal) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  if (milliseconds <= 0) return expired();
  const deadline = makeDeadline(context, milliseconds);
  try {
    const result = await run(deadline.signal);
    if (deadline.timedOut() && !context.signal?.aborted) return failure('data.budget', timeoutMessage);
    return result;
  } finally {
    deadline.cleanup();
  }
}

export function authorizeWithDeadline(
  authorize: AuthorizeRead | undefined,
  operation: 'describe' | 'plan' | 'execute',
  requestId: string,
  target: CatalogTarget | PlanTarget,
  context: ReadContext,
  milliseconds: number,
  query?: QuerySpec,
): Promise<Outcome<ReadGrant>> {
  return awaitBoundedResult(
    context,
    milliseconds,
    () => expiredAuthorization(context),
    'Authorization exceeded the effective time budget.',
    (signal) => authorizeResult(authorize, operation, requestId, target, { ...context, signal }, query),
  );
}

function expiredAuthorization(context: ReadContext): Outcome<ReadGrant> {
  if (context.signal?.aborted) return failure('data.aborted', 'The data service authorization was cancelled.');
  return failure('data.budget', 'Authorization exceeded the effective time budget.');
}

async function digest(value: unknown, prefix: string): Promise<string> {
  const text = canonical(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('WebCrypto SHA-256 is required for data service digests.');
  const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let encoded = '';
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
  return `${prefix}-${encoded}`;
}

export function digestWithDeadline(
  value: unknown,
  prefix: string,
  context: ReadContext,
  milliseconds: number,
): Promise<Outcome<string>> {
  return awaitBoundedResult(
    context,
    milliseconds,
    () => expiredDigest(context),
    'The data service operation exceeded the effective time budget.',
    (signal) =>
      resolveValueWithAbort(
        digest(value, prefix),
        signal,
        'data.crypto',
        'WebCrypto SHA-256 is required for immutable data service identities.',
      ),
  );
}

function expiredDigest(context: ReadContext): Outcome<string> {
  if (context.signal?.aborted) return failure('data.aborted', 'The data service operation was cancelled.');
  return failure('data.budget', 'The data service operation exceeded the effective time budget.');
}
