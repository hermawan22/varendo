import { describe, expect, it } from 'vitest';
import { createActionPort } from '../../packages/runtime/src/actions/boundary.js';
import { ActionRegistry } from '../../packages/runtime/src/actions/registry.js';
import type {
  ActionDescriptor,
  ActionDispatchResult,
  ActionEntity,
  ActionPayload,
  ActionRegistration,
  ActionSchema,
  ActionSideEffect,
  IssueActionConfirmation,
  TrustedActionContext,
} from '../../packages/runtime/src/actions/types.js';
import { WIRE_LIMITS } from '../../packages/core/src/index.js';
import type { Outcome, Scalar, VersionRef } from '../../packages/core/src/index.js';

const outcome = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = <T = never>(code = 'test.denied'): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message: 'Rejected by test host.', retryable: false }],
});
const inputRef = (id: string): VersionRef => ({ id: `${id}-input`, revision: '1' });
const outputRef = (id: string): VersionRef => ({ id: `${id}-output`, revision: '1' });
const canonical = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
};
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const context = (overrides: Partial<TrustedActionContext> = {}): TrustedActionContext => ({
  principalKey: 'principal-a',
  actorKey: 'actor-a',
  scopeDigest: 'scope-a',
  policyRevision: 'policy-a',
  domainRevision: 'domain-a',
  confirmationEpoch: 'confirmation-a',
  grants: ['action.propose', 'action.execute'],
  ...overrides,
});

function schema(
  ref: VersionRef,
  parse: (value: unknown) => Outcome<ActionPayload> = (value) => outcome(value as ActionPayload),
): ActionSchema {
  return { ref, parse };
}

function register(
  registry: ActionRegistry,
  options: {
    readonly id?: string;
    readonly revision?: string;
    readonly sideEffect?: ActionSideEffect;
    readonly confirmation?: 'none' | 'required';
    readonly idempotency?: 'optional' | 'required';
    readonly entityRevision?: 'none' | 'required';
    readonly inputParse?: (value: unknown) => Outcome<ActionPayload>;
    readonly dispatch?: ActionRegistration['dispatch'];
    readonly outputParse?: (value: unknown) => Outcome<ActionPayload>;
  } = {},
): ActionDescriptor {
  const id = options.id ?? 'save';
  const revision = options.revision ?? '1';
  const input = inputRef(`${id}-${revision}`);
  const output = outputRef(`${id}-${revision}`);
  const descriptor: ActionDescriptor = {
    ref: { id, revision },
    input,
    output,
    sideEffect: options.sideEffect ?? 'domain-write',
    confirmation: options.confirmation ?? 'none',
    idempotency: options.idempotency ?? 'optional',
    entityRevision: options.entityRevision ?? 'none',
  };
  const outputParse =
    options.outputParse ??
    ((value: unknown): Outcome<ActionPayload> => {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).ok === true &&
        Object.hasOwn(value, 'value')
      )
        return value as Outcome<ActionPayload>;
      return fail('test.output');
    });
  const registration: ActionRegistration = {
    descriptor,
    inputSchema: schema(input, options.inputParse),
    outputSchema: schema(output, outputParse),
    dispatch: options.dispatch ?? (() => ({ state: 'completed', output: { ok: true, value: { saved: true } } })),
  };
  const registered = registry.register(registration);
  expect(registered.ok).toBe(true);
  return descriptor;
}

function makePort(
  options: {
    readonly registry?: ActionRegistry;
    readonly current?: TrustedActionContext;
    readonly confirm?: IssueActionConfirmation;
  } = {},
) {
  const registry = options.registry ?? new ActionRegistry();
  let current = options.current ?? context();
  const host = {
    readContext: () => outcome(current),
    ...(options.confirm === undefined ? {} : { issueConfirmation: options.confirm }),
  };
  const port = createActionPort({ host, registry });
  return {
    port,
    registry,
    setContext: (next: TrustedActionContext) => {
      current = next;
    },
    getContext: () => current,
  };
}

async function previewAndConfirm(
  port: ReturnType<typeof makePort>['port'],
  descriptor: ActionDescriptor,
  input: ActionPayload = { id: 'entity-1' },
  extra: Record<string, unknown> = {},
) {
  const proposed = await port.preview({
    requestId: `request-${Math.random()}`,
    action: descriptor.ref,
    input,
    ...extra,
  });
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) throw new Error('preview setup failed');
  const confirmed = await port.confirm(proposed.value);
  expect(confirmed.ok).toBe(true);
  if (!confirmed.ok) throw new Error('confirmation setup failed');
  return confirmed.value;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('action registry and authority boundary', () => {
  it('keeps dispatch callbacks behind a module-private registry and replaces only the active version', () => {
    const registry = new ActionRegistry(1);
    const first = register(registry, { id: 'publish', revision: '1' });
    expect(Object.keys(registry)).toEqual([]);
    expect((registry as unknown as { entries?: unknown }).entries).toBeUndefined();
    expect(registry.describe(first.ref)).toEqual(first);
    expect(
      registry.register({
        descriptor: first,
        inputSchema: schema(first.input),
        outputSchema: schema(first.output),
        dispatch: () => ({ state: 'completed', output: { ok: true, value: {} } }),
      }).ok,
    ).toBe(false);

    const second = register(registry, { id: 'publish', revision: '2' });
    expect(registry.describe(first.ref)).toBeUndefined();
    expect(registry.describe(second.ref)).toEqual(second);
    expect(registry.size).toBe(1);
    expect(
      registry.register({
        descriptor: { ...second, ref: { id: 'other', revision: '1' } },
        inputSchema: schema(second.input),
        outputSchema: schema(second.output),
        dispatch: () => ({ state: 'completed', output: { ok: true, value: {} } }),
      }).ok,
    ).toBe(false);
    expect(registry.unregister('publish')).toBe(true);
    expect(registry.describe(second.ref)).toBeUndefined();
  });

  it('requires proposal and execution grants independently and derives actor from host context', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'archive' });
    const state = makePort({ registry, current: context({ grants: ['action.propose'] }) });
    const allowedPreview = await state.port.preview({ requestId: 'request-1', action: descriptor.ref, input: {} });
    expect(allowedPreview.ok).toBe(true);
    if (!allowedPreview.ok) return;
    const denied = await state.port.confirm(allowedPreview.value);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.diagnostics[0]!.code).toBe('action.denied');

    state.setContext(context({ actorKey: 'trusted-actor' }));
    const preview = await state.port.preview({ requestId: 'request-2', action: descriptor.ref, input: { amount: 3 } });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect((preview.value as unknown as Record<string, unknown>).actorKey).toBeUndefined();
    const receipt = await state.port.confirm(preview.value);
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(Object.keys(receipt.value)).toEqual(['state', 'id', 'previewId', 'action', 'sideEffect', 'confirmation']);
    const execution = await state.port.execute(receipt.value);
    expect(execution.ok).toBe(true);
    if (execution.ok && execution.value.state === 'executed') expect(execution.value.output).toEqual({ saved: true });
  });

  it('does not accept forged preview or receipt objects', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry);
    const { port } = makePort({ registry });
    const preview = await port.preview({ requestId: 'request-forge', action: descriptor.ref, input: {} });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const forgedPreview = { ...preview.value };
    expect((await port.confirm(forgedPreview)).ok).toBe(false);
    const confirmed = await port.confirm(preview.value);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const forgedReceipt = { ...confirmed.value };
    expect((await port.execute(forgedReceipt)).ok).toBe(false);
    expect((await port.execute(confirmed.value)).ok).toBe(true);
    expect((await port.execute(confirmed.value)).ok).toBe(false);
  });
});

describe('confirmation and execute rechecks', () => {
  it('cancels preview when input validation aborts its caller signal', async () => {
    const registry = new ActionRegistry();
    const abort = new AbortController();
    const descriptor = register(registry, {
      id: 'parser-cancel',
      inputParse: (value) => {
        abort.abort();
        return outcome(value as ActionPayload);
      },
    });
    const port = createActionPort({ registry, host: { readContext: () => outcome(context()) } });
    const preview = await port.preview(
      { requestId: 'parser-cancel-request', action: descriptor.ref, input: { amount: 1 } },
      { signal: abort.signal },
    );
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.diagnostics[0]!.code).toBe('action.cancelled');
  });

  it('does not admit a preview when input normalization revokes authority', async () => {
    const registry = new ActionRegistry();
    const descriptor: ActionDescriptor = {
      ref: { id: 'normalize-revoke', revision: '1' },
      input: inputRef('normalize-revoke'),
      output: outputRef('normalize-revoke'),
      sideEffect: 'domain-write',
      confirmation: 'none',
      idempotency: 'optional',
      entityRevision: 'none',
    };
    let port: ReturnType<typeof createActionPort> | undefined;
    const registration: ActionRegistration = {
      descriptor,
      inputSchema: schema(descriptor.input, (value) => {
        port!.revoke('input normalization revoked authority');
        return outcome(value as ActionPayload);
      }),
      outputSchema: schema(descriptor.output),
      dispatch: () => ({ state: 'completed', output: { ok: true, value: { saved: true } } }),
    };
    expect(registry.register(registration).ok).toBe(true);
    port = createActionPort({ registry, host: { readContext: () => outcome(context()) } });
    const preview = await port.preview({
      requestId: 'normalize-revoke-request',
      action: descriptor.ref,
      input: { amount: 1 },
    });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.diagnostics[0]!.code).toBe('action.revoked');
  });

  it('requires a trusted positive confirmation for required actions and rechecks after it', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, {
      id: 'delete',
      confirmation: 'required',
      idempotency: 'required',
      entityRevision: 'required',
      sideEffect: 'irreversible',
    });
    const calls: string[] = [];
    const state = makePort({
      registry,
      current: context({ entityRevisions: { 'row-1': 'rev-1' } }),
      confirm: ({ context: trusted, preview }) => {
        calls.push(`${trusted.actorKey}:${preview.entity?.key}`);
        return outcome(undefined);
      },
    });
    const preview = await state.port.preview({
      requestId: 'request-delete',
      action: descriptor.ref,
      input: { ok: true },
      entity: { key: 'row-1', revision: 'rev-1' },
      idempotencyKey: 'delete-1',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const receipt = await state.port.confirm(preview.value);
    expect(receipt.ok).toBe(true);
    expect(calls).toEqual(['actor-a:row-1']);
    if (!receipt.ok) return;

    state.setContext(context({ entityRevisions: { 'row-1': 'rev-2' } }));
    const stale = await state.port.execute(receipt.value);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics[0]!.code).toBe('action.stale');
  });

  it('invalidates a preview when confirmation changes authority before receipt creation', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'approve', confirmation: 'required' });
    let reads = 0;
    let current = context();
    const host = {
      readContext: () => {
        reads++;
        if (reads === 3) current = context({ policyRevision: 'policy-b' });
        return outcome(current);
      },
      issueConfirmation: () => outcome(undefined),
    };
    const port = createActionPort({ registry, host });
    const preview = await port.preview({ requestId: 'request-approve', action: descriptor.ref, input: {} });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const stale = await port.confirm(preview.value);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics[0]!.code).toBe('action.stale');
    expect((await port.confirm(preview.value)).ok).toBe(false);
  });

  it('denies receipt creation when confirmation loses proposal authority without a policy revision', async () => {
    const registry = new ActionRegistry();
    let current = context();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'withdraw-proposal',
      confirmation: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    const port = createActionPort({
      registry,
      host: {
        readContext: () => outcome(current),
        issueConfirmation: () => {
          current = context({ grants: ['action.execute'] });
          return outcome(undefined);
        },
      },
    });
    const preview = await port.preview({
      requestId: 'withdraw-proposal-request',
      action: descriptor.ref,
      input: { amount: 1 },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const denied = await port.confirm(preview.value);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.diagnostics[0]!.code).toBe('action.denied');
    expect(dispatches).toBe(0);
    expect(preview.value.input).toBeUndefined();
  });

  it('rejects an overbounded host grant list before proposal admission', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'grant-budget' });
    const grants = Array.from({ length: WIRE_LIMITS.array + 1 }, () => 'action.propose' as const);
    const port = createActionPort({ registry, host: { readContext: () => outcome(context({ grants })) } });
    const preview = await port.preview({ requestId: 'grant-budget-request', action: descriptor.ref, input: {} });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.diagnostics[0]!.code).toBe('action.denied');
  });

  it('treats malformed callback diagnostics and output as bounded ambiguity', async () => {
    const registry = new ActionRegistry();
    const malformed = register(registry, {
      id: 'malformed',
      dispatch: () => ({ state: 'rejected', diagnostics: [null] as never }),
    });
    const invalidOutput = register(registry, {
      id: 'invalid-output',
      dispatch: () => ({ state: 'completed', output: { ok: true, value: { nested: { bad: undefined } } } }),
    });
    const state = makePort({ registry });
    const malformedReceipt = await previewAndConfirm(state.port, malformed);
    const rejected = await state.port.execute(malformedReceipt);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0]!.code).toBe('action.callback');
    const invalidReceipt = await previewAndConfirm(state.port, invalidOutput);
    const ambiguous = await state.port.execute(invalidReceipt);
    expect(ambiguous.ok).toBe(true);
    if (ambiguous.ok) expect(ambiguous.value.state).toBe('ambiguous');
  });

  it('accepts bounded nested JSON for forms, repeaters, and multiselect values', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'nested-form' });
    const state = makePort({ registry });
    const input = {
      profile: { name: 'Ada', locations: [{ city: 'London' }, { city: 'Paris' }] },
      roles: ['admin', 'editor'],
    };
    const proposed = await state.port.preview({ requestId: 'nested-form-request', action: descriptor.ref, input });
    expect(proposed.ok).toBe(true);
    if (proposed.ok) expect(proposed.value.input).toEqual(input);
  });

  it('returns ambiguity when the caller cancels after dispatch completion', async () => {
    const registry = new ActionRegistry();
    const abort = new AbortController();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'dispatch-cancelled',
      outputParse: (value) => {
        abort.abort();
        return outcome(value as ActionPayload);
      },
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    const port = createActionPort({ registry, host: { readContext: () => outcome(context()) } });
    const receipt = await previewAndConfirm(port, descriptor);
    const result = await port.execute(receipt, { signal: abort.signal });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
  });

  it('cancels before dispatch when the final clock barrier aborts the caller', async () => {
    const registry = new ActionRegistry();
    const abort = new AbortController();
    let clocks = 0;
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'clock-abort-before-dispatch',
      idempotency: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    const port = createActionPort({
      registry,
      now: () => {
        clocks++;
        // preview clock, confirmation clock, idempotency reservation clock,
        // then the final pre-dispatch clock barrier.
        if (clocks === 4) abort.abort();
        return clocks;
      },
      host: { readContext: () => outcome(context()) },
    });
    const receipt = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'clock-abort-before-dispatch-1' });
    const cancelled = await port.execute(receipt, { signal: abort.signal });
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.diagnostics[0]!.code).toBe('action.cancelled');
    expect(dispatches).toBe(0);
    const inspection = await port.inspect('clock-abort-before-dispatch-1');
    expect(inspection).toEqual({ ok: true, value: undefined });

    const replayReceipt = await previewAndConfirm(
      port,
      descriptor,
      {},
      { idempotencyKey: 'clock-abort-before-dispatch-1' },
    );
    expect((await port.execute(replayReceipt)).ok).toBe(true);
    expect(dispatches).toBe(1);
  });

  it('exposes preview input to trusted confirmation only while the preview is live', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'confirmation-input', confirmation: 'required' });
    let seen: ActionPayload | undefined;
    const state = makePort({
      registry,
      confirm: ({ preview }) => {
        seen = preview.input;
        return outcome(undefined);
      },
    });
    const preview = await state.port.preview({
      requestId: 'confirmation-input-request',
      action: descriptor.ref,
      input: { amount: 2 },
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.input).toEqual({ amount: 2 });
    const confirmed = await state.port.confirm(preview.value);
    expect(confirmed.ok).toBe(true);
    expect(seen).toEqual({ amount: 2 });
    expect(preview.value.input).toBeUndefined();
  });
});

describe('bounded idempotency and lifecycle', () => {
  it('replays only the complete identity within the trusted principal scope', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'charge',
      idempotency: 'required',
      dispatch: ({ context: trusted }) => {
        dispatches++;
        return {
          state: 'completed',
          output: { ok: true, value: { principal: trusted.principalKey, count: dispatches } },
        };
      },
    });
    const state = makePort({ registry });
    const first = await previewAndConfirm(state.port, descriptor, { amount: 10 }, { idempotencyKey: 'charge-1' });
    const firstExecution = await state.port.execute(first);
    expect(firstExecution.ok).toBe(true);
    const replay = await previewAndConfirm(state.port, descriptor, { amount: 10 }, { idempotencyKey: 'charge-1' });
    const replayExecution = await state.port.execute(replay);
    expect(replayExecution.ok).toBe(true);
    if (firstExecution.ok && replayExecution.ok) {
      expect(replayExecution.value.state).toBe(firstExecution.value.state);
      expect(replayExecution.value.action).toEqual(firstExecution.value.action);
      if (replayExecution.value.state === 'executed' && firstExecution.value.state === 'executed')
        expect(replayExecution.value.output).toEqual(firstExecution.value.output);
    }
    expect(dispatches).toBe(1);

    const changed = await previewAndConfirm(state.port, descriptor, { amount: 11 }, { idempotencyKey: 'charge-1' });
    const changedExecution = await state.port.execute(changed);
    expect(changedExecution.ok).toBe(false);
    if (!changedExecution.ok) expect(changedExecution.diagnostics[0]!.code).toBe('action.idempotency');

    state.setContext(context({ principalKey: 'principal-b', actorKey: 'actor-b', scopeDigest: 'scope-b' }));
    const other = await previewAndConfirm(state.port, descriptor, { amount: 10 }, { idempotencyKey: 'charge-1' });
    const otherExecution = await state.port.execute(other);
    expect(otherExecution.ok).toBe(true);
    expect(dispatches).toBe(2);
    const ownInspection = await state.port.inspect('charge-1');
    expect(ownInspection.ok).toBe(true);
    if (ownInspection.ok) expect(ownInspection.value?.outputAvailable).toBe(true);
  });

  it('partitions inspect and history by the authenticated principal and scope', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'partitioned', idempotency: 'required' });
    const state = makePort({ registry });
    const receipt = await previewAndConfirm(state.port, descriptor, { amount: 2 }, { idempotencyKey: 'partitioned-1' });
    expect((await state.port.execute(receipt)).ok).toBe(true);

    const ownHistory = await state.port.history();
    expect(ownHistory.ok).toBe(true);
    if (ownHistory.ok) {
      expect(ownHistory.value.length).toBeGreaterThan(0);
      for (const entry of ownHistory.value) {
        expect(Object.keys(entry)).not.toContain('principalKey');
        expect(Object.keys(entry)).not.toContain('actorKey');
        expect(Object.keys(entry)).not.toContain('scopeDigest');
        expect(Object.keys(entry)).not.toContain('input');
        expect(Object.keys(entry)).not.toContain('output');
      }
    }
    const ownInspect = await state.port.inspect('partitioned-1');
    expect(ownInspect.ok).toBe(true);
    if (ownInspect.ok) expect(ownInspect.value?.outputAvailable).toBe(true);

    state.setContext(
      context({
        principalKey: 'principal-b',
        actorKey: 'actor-b',
        scopeDigest: 'scope-b',
        policyRevision: 'policy-b',
        domainRevision: 'domain-b',
        grants: [],
      }),
    );
    const foreignInspect = await state.port.inspect('partitioned-1');
    expect(foreignInspect).toEqual({ ok: true, value: undefined });
    const foreignHistory = await state.port.history();
    expect(foreignHistory).toEqual({ ok: true, value: [] });

    state.setContext(context());
    const restoredHistory = await state.port.history();
    expect(restoredHistory.ok).toBe(true);
    if (restoredHistory.ok) expect(restoredHistory.value.length).toBeGreaterThan(0);
  });

  it('refuses new idempotency admission when the bounded ledger is full', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'bounded', idempotency: 'required' });
    const state = makePort({ registry });
    const first = await previewAndConfirm(state.port, descriptor, {}, { idempotencyKey: 'key-1' });
    expect((await state.port.execute(first)).ok).toBe(true);
    const second = await previewAndConfirm(state.port, descriptor, {}, { idempotencyKey: 'key-2' });
    const thirdPreview = await state.port.preview({
      requestId: 'third',
      action: descriptor.ref,
      input: {},
      idempotencyKey: 'key-3',
    });
    expect(thirdPreview.ok).toBe(true);
    if (!thirdPreview.ok) return;
    const third = await state.port.confirm(thirdPreview.value);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    const limited = createActionPort({
      host: { readContext: () => outcome(context()) },
      registry,
      maxIdempotencyEntries: 2,
    });
    // Fill the bounded ledger on a separate port to exercise its admission check.
    const a = await previewAndConfirm(limited, descriptor, {}, { idempotencyKey: 'a' });
    const b = await previewAndConfirm(limited, descriptor, {}, { idempotencyKey: 'b' });
    expect((await limited.execute(a)).ok).toBe(true);
    expect((await limited.execute(b)).ok).toBe(true);
    const c = await previewAndConfirm(limited, descriptor, {}, { idempotencyKey: 'c' });
    const refused = await limited.execute(c);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.diagnostics[0]!.code).toBe('action.budget');
    expect((await limited.execute(c)).ok).toBe(false);
    void second;
    void third;
  });

  it('allows only one execution for a receipt even without an idempotency key', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'slow' });
    let resolveDispatch: ((value: ActionDispatchResult) => void) | undefined;
    let dispatches = 0;
    const replacement = register(registry, { id: 'slow-2' });
    void replacement;
    // Register a fresh action with the deferred callback so the active receipt can be held open.
    const slow = register(registry, {
      id: 'slow-deferred',
      dispatch: () => {
        dispatches++;
        return new Promise<ActionDispatchResult>((resolve) => {
          resolveDispatch = resolve;
        });
      },
    });
    const state = makePort({ registry });
    const receipt = await previewAndConfirm(state.port, slow);
    const first = state.port.execute(receipt);
    await waitFor(() => resolveDispatch !== undefined);
    const duplicate = await state.port.execute(receipt);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0]!.code).toBe('action.in-flight');
    resolveDispatch!({ state: 'completed', output: { ok: true, value: { done: true } } });
    const executed = await first;
    expect(executed.ok).toBe(true);
    expect(dispatches).toBe(1);
    void descriptor;
  });

  it('clears pending receipts on revoke and ignores late callback completion', async () => {
    const registry = new ActionRegistry();
    let resolveDispatch: ((value: ActionDispatchResult) => void) | undefined;
    const descriptor = register(registry, {
      id: 'revoke',
      idempotency: 'required',
      dispatch: () =>
        new Promise<ActionDispatchResult>((resolve) => {
          resolveDispatch = resolve;
        }),
    });
    const state = makePort({ registry });
    const receipt = await previewAndConfirm(state.port, descriptor, {}, { idempotencyKey: 'revoke-1' });
    const running = state.port.execute(receipt);
    await waitFor(() => resolveDispatch !== undefined);
    expect(state.port.revoke('test revoke')).toBe(true);
    const result = await running;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('ambiguous');
    resolveDispatch!({ state: 'completed', output: { ok: true, value: { late: true } } });
    // A terminally revoked port cannot accept replay, so retained ledger
    // identities and outputs are released rather than kept indefinitely.
    const revokedInspection = await state.port.inspect('revoke-1');
    expect(revokedInspection.ok).toBe(false);
    if (!revokedInspection.ok) expect(revokedInspection.diagnostics[0]!.code).toBe('action.revoked');
    const revokedHistory = await state.port.history();
    expect(revokedHistory.ok).toBe(false);
    if (!revokedHistory.ok) expect(revokedHistory.diagnostics[0]!.code).toBe('action.revoked');
    expect((await state.port.execute(receipt)).ok).toBe(false);
  });

  it('reserves preview capacity before asynchronous context reads', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'preview-budget' });
    let reads = 0;
    const resolvers: Array<(value: Outcome<TrustedActionContext>) => void> = [];
    const port = createActionPort({
      registry,
      maxPreviews: 2,
      maxPending: 2,
      host: {
        readContext: () => {
          reads++;
          return new Promise<Outcome<TrustedActionContext>>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    });
    const first = port.preview({ requestId: 'preview-1', action: descriptor.ref, input: {} });
    const second = port.preview({ requestId: 'preview-2', action: descriptor.ref, input: {} });
    const refused = port.preview({ requestId: 'preview-3', action: descriptor.ref, input: {} });
    await Promise.resolve();
    expect(reads).toBe(2);
    const refusedResult = await refused;
    expect(refusedResult.ok).toBe(false);
    if (!refusedResult.ok) expect(refusedResult.diagnostics[0]!.code).toBe('action.budget');
    for (const resolve of resolvers) resolve(outcome(context()));
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
  });

  it('bounds concurrent host confirmation reads with the callback budget', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'confirm-budget' });
    let releaseRead: ((value: Outcome<TrustedActionContext>) => void) | undefined;
    let holdRead = false;
    const port = createActionPort({
      registry,
      maxInFlight: 1,
      host: {
        readContext: () => {
          if (!holdRead) return outcome(context());
          return new Promise<Outcome<TrustedActionContext>>((resolve) => {
            releaseRead = resolve;
          });
        },
      },
    });
    const firstPreview = await port.preview({ requestId: 'confirm-1', action: descriptor.ref, input: {} });
    const secondPreview = await port.preview({ requestId: 'confirm-2', action: descriptor.ref, input: {} });
    expect(firstPreview.ok && secondPreview.ok).toBe(true);
    if (!firstPreview.ok || !secondPreview.ok) return;
    holdRead = true;
    const first = port.confirm(firstPreview.value);
    const second = port.confirm(secondPreview.value);
    const refused = await second;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.diagnostics[0]!.code).toBe('action.budget');
    holdRead = false;
    releaseRead!(outcome(context()));
    expect((await first).ok).toBe(true);
  });

  it('retains a collision-safe identity when output retention overflows', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'large-output',
      idempotency: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { large: 'this output is too large' } } };
      },
    });
    const port = createActionPort({
      registry,
      maxOutputBytes: 8,
      host: { readContext: () => outcome(context()) },
    });
    const first = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'large-1' });
    const ambiguous = await port.execute(first);
    expect(ambiguous.ok).toBe(true);
    if (ambiguous.ok) expect(ambiguous.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
    const largeInspection = await port.inspect('large-1');
    expect(largeInspection.ok).toBe(true);
    if (largeInspection.ok) expect(largeInspection.value).toMatchObject({ state: 'ambiguous', outputAvailable: false });
    const replay = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'large-1' });
    const replayResult = await port.execute(replay);
    expect(replayResult.ok).toBe(true);
    if (replayResult.ok) expect(replayResult.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
    const changed = await previewAndConfirm(port, descriptor, { changed: true }, { idempotencyKey: 'large-1' });
    const changedResult = await port.execute(changed);
    expect(changedResult.ok).toBe(false);
    if (!changedResult.ok) expect(changedResult.diagnostics[0]!.code).toBe('action.idempotency');
  });

  it('marks output ambiguous when aggregate ledger bytes are exhausted', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'ledger-output',
      idempotency: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    const input = {};
    const identity = (key: string): string =>
      canonical({ key, action: descriptor.ref, input, inputSchema: descriptor.input, outputSchema: descriptor.output });
    const identityBytes = utf8Bytes(identity('a'));
    const outputBytes = utf8Bytes(canonical({ saved: true }));
    const ledgerKey = (key: string): string =>
      canonical({
        principalKey: 'principal-a',
        actorKey: 'actor-a',
        scopeDigest: 'scope-a',
        policyRevision: 'policy-a',
        domainRevision: 'domain-a',
        key,
      });
    const metadataBytes = (key: string, receiptId: string): number =>
      utf8Bytes(
        canonical({
          ledgerKey: ledgerKey(key),
          key,
          action: descriptor.ref,
          receiptId,
          at: 0,
          partition: {
            principalKey: 'principal-a',
            actorKey: 'actor-a',
            scopeDigest: 'scope-a',
            policyRevision: 'policy-a',
            domainRevision: 'domain-a',
          },
        }),
      );
    const port = createActionPort({
      registry,
      now: () => 0,
      maxLedgerBytes:
        identityBytes + metadataBytes('a', 'receipt-2') + identityBytes + metadataBytes('b', 'receipt-4') + outputBytes,
      host: { readContext: () => outcome(context()) },
    });
    const first = await previewAndConfirm(port, descriptor, input, { idempotencyKey: 'a' });
    expect((await port.execute(first)).ok).toBe(true);
    const second = await previewAndConfirm(port, descriptor, input, { idempotencyKey: 'b' });
    const secondResult = await port.execute(second);
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) expect(secondResult.value.state).toBe('ambiguous');
    expect(dispatches).toBe(2);
    const ledgerInspection = await port.inspect('b');
    expect(ledgerInspection.ok).toBe(true);
    if (ledgerInspection.ok)
      expect(ledgerInspection.value).toMatchObject({ state: 'ambiguous', outputAvailable: false });
  });

  it('converts reentrant output-schema revocation into ambiguity', async () => {
    const registry = new ActionRegistry();
    let port: ReturnType<typeof createActionPort> | undefined;
    const descriptor = register(registry, {
      id: 'schema-revoke',
      idempotency: 'required',
      outputParse: (value) => {
        port!.revoke('schema revoked authority');
        return outcome(value as ActionPayload);
      },
    });
    port = createActionPort({ registry, host: { readContext: () => outcome(context()) } });
    const receipt = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'schema-1' });
    const result = await port.execute(receipt);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('ambiguous');
    const schemaInspection = await port.inspect('schema-1');
    expect(schemaInspection.ok).toBe(false);
    if (!schemaInspection.ok) expect(schemaInspection.diagnostics[0]!.code).toBe('action.revoked');
  });

  it('returns a structured failure when the pre-dispatch clock fails', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'clock-before-dispatch',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    let failClock = false;
    const port = createActionPort({
      registry,
      now: () => {
        if (failClock) throw new Error('clock unavailable');
        return 1;
      },
      host: { readContext: () => outcome(context()) },
    });
    const receipt = await previewAndConfirm(port, descriptor);
    failClock = true;
    const failed = await port.execute(receipt);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.diagnostics[0]!.code).toBe('action.callback');
    expect(dispatches).toBe(0);
    const replay = await port.execute(receipt);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.diagnostics[0]!.code).toBe('action.replay');
  });

  it('returns ambiguity without retaining output when the post-dispatch clock fails', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'clock-after-dispatch',
      idempotency: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    let clockCalls = 0;
    const port = createActionPort({
      registry,
      now: () => {
        clockCalls++;
        if (clockCalls === 5) throw new Error('clock unavailable after dispatch');
        return clockCalls;
      },
      host: { readContext: () => outcome(context()) },
    });
    const first = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'clock-after-1' });
    const ambiguous = await port.execute(first);
    expect(ambiguous.ok).toBe(true);
    if (ambiguous.ok) expect(ambiguous.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
    const clockInspection = await port.inspect('clock-after-1');
    expect(clockInspection.ok).toBe(true);
    if (clockInspection.ok) expect(clockInspection.value).toMatchObject({ state: 'ambiguous', outputAvailable: false });
    const replay = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'clock-after-1' });
    const replayResult = await port.execute(replay);
    expect(replayResult.ok).toBe(true);
    if (replayResult.ok) expect(replayResult.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
  });

  it('treats a reentrant clock revocation after dispatch as ambiguous', async () => {
    const registry = new ActionRegistry();
    let dispatches = 0;
    const descriptor = register(registry, {
      id: 'clock-revoke-after-dispatch',
      idempotency: 'required',
      dispatch: () => {
        dispatches++;
        return { state: 'completed', output: { ok: true, value: { saved: true } } };
      },
    });
    let port: ReturnType<typeof createActionPort> | undefined;
    let clockCalls = 0;
    port = createActionPort({
      registry,
      now: () => {
        clockCalls++;
        if (clockCalls === 5) port!.revoke('clock revoked authority');
        return clockCalls;
      },
      host: { readContext: () => outcome(context()) },
    });
    const receipt = await previewAndConfirm(port, descriptor, {}, { idempotencyKey: 'clock-revoke-1' });
    const result = await port.execute(receipt);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('ambiguous');
    expect(dispatches).toBe(1);
    const clockRevokeInspection = await port.inspect('clock-revoke-1');
    expect(clockRevokeInspection.ok).toBe(false);
    if (!clockRevokeInspection.ok) expect(clockRevokeInspection.diagnostics[0]!.code).toBe('action.revoked');
  });
});

describe('interaction action ingress', () => {
  it('cancels one preview without revoking the action port or other previews', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'cancel-preview' });
    const { port } = makePort({ registry });
    const first = await port.preview({ requestId: 'cancel-1', action: descriptor.ref, input: { value: 1 } });
    const second = await port.preview({ requestId: 'cancel-2', action: descriptor.ref, input: { value: 2 } });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(port.cancel(first.value)).toBe(true);
    expect(port.cancel(first.value)).toBe(false);
    expect((await port.confirm(first.value)).ok).toBe(false);
    expect((await port.confirm(second.value)).ok).toBe(true);
  });

  it('accepts only the typed action-request interaction payload', async () => {
    const registry = new ActionRegistry();
    const descriptor = register(registry, { id: 'from-interaction' });
    const { port } = makePort({ registry });
    const preview = await port.previewInteraction({
      eventId: 'event-1',
      causationId: 'event-0',
      regionId: 'region-1',
      regionRevision: 'region-rev',
      originNodeId: 'button-1',
      payload: { kind: 'action-request', action: descriptor.ref, input: { amount: 2 } },
    });
    expect(preview.ok).toBe(true);
    const wrong = await port.previewInteraction({
      eventId: 'event-2',
      causationId: 'event-1',
      regionId: 'region-1',
      regionRevision: 'region-rev',
      originNodeId: 'button-1',
      payload: { kind: 'navigate', route: { id: 'route', revision: '1' }, params: {} },
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.diagnostics[0]!.code).toMatch(/action.invalid|wire/);
  });
});
