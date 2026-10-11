import { describe, expect, it } from 'vitest';
import type { Outcome, Scalar, VersionRef } from '../../packages/core/src/index.js';
import {
  createActionPort,
  ActionRegistry,
  type ActionDescriptor,
  type ActionPayload,
  type TrustedActionContext,
} from '../../packages/runtime/src/actions/index.js';

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function authority(principalKey: string): TrustedActionContext {
  return {
    principalKey,
    // Keep every other partition component identical so a replay can only be
    // isolated if the private principal key is included in its identity.
    actorKey: 'shared-actor',
    scopeDigest: 'scope-colliding',
    policyRevision: 'policy-shared',
    domainRevision: 'domain-shared',
    confirmationEpoch: 'confirmation-shared',
    grants: ['action.propose', 'action.execute'],
  };
}

function registerReplayAction(registry: ActionRegistry, dispatches: string[]): ActionDescriptor {
  const descriptor: ActionDescriptor = {
    ref: { id: 'security-write', revision: '1' },
    input: { id: 'security-write-input', revision: '1' },
    output: { id: 'security-write-output', revision: '1' },
    sideEffect: 'domain-write',
    confirmation: 'none',
    idempotency: 'required',
    entityRevision: 'none',
  };
  const scalarPayload = (value: unknown): Outcome<ActionPayload> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return { ok: false, diagnostics: [{ code: 'test.invalid', message: 'invalid', retryable: false }] };
    return ok(value as Readonly<Record<string, Scalar>>);
  };
  const registered = registry.register({
    descriptor,
    inputSchema: { ref: descriptor.input, parse: scalarPayload },
    outputSchema: { ref: descriptor.output, parse: scalarPayload },
    dispatch: ({ context }) => {
      dispatches.push(context.principalKey);
      return { state: 'completed', output: { principal: context.principalKey } };
    },
  });
  expect(registered.ok).toBe(true);
  return descriptor;
}

describe('action replay isolation', () => {
  it('does not replay a completed write across principals sharing scope and policy digests', async () => {
    const dispatches: string[] = [];
    const registry = new ActionRegistry();
    const descriptor = registerReplayAction(registry, dispatches);
    let current = authority('alice');
    const port = createActionPort({ registry, host: { readContext: () => ok(current) } });

    const firstPreview = await port.preview({
      requestId: 'alice-proposal',
      action: descriptor.ref,
      input: { amount: 10 },
      idempotencyKey: 'shared-write',
    });
    expect(firstPreview.ok).toBe(true);
    if (!firstPreview.ok) return;
    const firstReceipt = await port.confirm(firstPreview.value);
    expect(firstReceipt.ok).toBe(true);
    if (!firstReceipt.ok) return;
    const firstExecution = await port.execute(firstReceipt.value);
    expect(firstExecution).toMatchObject({ ok: true, value: { state: 'executed', output: { principal: 'alice' } } });

    current = authority('bob');
    const secondPreview = await port.preview({
      requestId: 'bob-proposal',
      action: descriptor.ref,
      input: { amount: 10 },
      idempotencyKey: 'shared-write',
    });
    expect(secondPreview.ok).toBe(true);
    if (!secondPreview.ok) return;
    const secondReceipt = await port.confirm(secondPreview.value);
    expect(secondReceipt.ok).toBe(true);
    if (!secondReceipt.ok) return;
    const secondExecution = await port.execute(secondReceipt.value);
    expect(secondExecution).toMatchObject({ ok: true, value: { state: 'executed', output: { principal: 'bob' } } });
    expect(dispatches).toEqual(['alice', 'bob']);
  });
});
