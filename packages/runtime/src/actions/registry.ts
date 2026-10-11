import type { Outcome, VersionRef } from '@varendo/core';
import type { ActionDescriptor, ActionDispatchResult, ActionPayload, ActionRegistration } from './types.js';

const MAX_ACTIONS = 512;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(value);
const failure = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});
const sameRef = (left: VersionRef, right: VersionRef): boolean =>
  left.id === right.id && left.revision === right.revision;

function validRef(value: unknown): value is VersionRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && validId(record.id) && validId(record.revision);
}

function validDescriptor(value: unknown): value is ActionDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ['ref', 'input', 'output', 'sideEffect', 'confirmation', 'idempotency', 'entityRevision'];
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key)) &&
    validRef(record.ref) &&
    validRef(record.input) &&
    validRef(record.output) &&
    ['none', 'domain-write', 'irreversible'].includes(String(record.sideEffect)) &&
    ['none', 'required'].includes(String(record.confirmation)) &&
    ['optional', 'required'].includes(String(record.idempotency)) &&
    ['none', 'required'].includes(String(record.entityRevision))
  );
}

function cloneRef(value: VersionRef): VersionRef {
  return Object.freeze({ id: value.id, revision: value.revision });
}
function cloneDescriptor(value: ActionDescriptor): ActionDescriptor {
  return Object.freeze({
    ...value,
    ref: cloneRef(value.ref),
    input: cloneRef(value.input),
    output: cloneRef(value.output),
  });
}

function hasRegistrationShape<TInput extends ActionPayload, TOutput extends ActionPayload>(
  registration: ActionRegistration<TInput, TOutput>,
): boolean {
  return (
    registration !== null &&
    typeof registration === 'object' &&
    validDescriptor(registration.descriptor) &&
    typeof registration.inputSchema?.parse === 'function' &&
    typeof registration.outputSchema?.parse === 'function' &&
    typeof registration.dispatch === 'function'
  );
}

function hasMatchingSchemas<TInput extends ActionPayload, TOutput extends ActionPayload>(
  registration: ActionRegistration<TInput, TOutput>,
): boolean {
  return (
    validRef(registration.inputSchema.ref) &&
    validRef(registration.outputSchema.ref) &&
    sameRef(registration.inputSchema.ref, registration.descriptor.input) &&
    sameRef(registration.outputSchema.ref, registration.descriptor.output)
  );
}

interface StoredActionSchema {
  readonly ref: VersionRef;
  readonly parse: (input: unknown) => Outcome<unknown>;
}

interface StoredActionRegistration {
  readonly descriptor: ActionDescriptor;
  readonly inputSchema: StoredActionSchema;
  readonly outputSchema: StoredActionSchema;
  readonly dispatch: (input: never) => ActionDispatchResult | Promise<ActionDispatchResult>;
}

function registryEntry<TInput extends ActionPayload, TOutput extends ActionPayload>(
  registration: ActionRegistration<TInput, TOutput>,
): StoredActionRegistration {
  return Object.freeze({
    descriptor: cloneDescriptor(registration.descriptor),
    inputSchema: Object.freeze({ ...registration.inputSchema, ref: cloneRef(registration.inputSchema.ref) }),
    outputSchema: Object.freeze({ ...registration.outputSchema, ref: cloneRef(registration.outputSchema.ref) }),
    dispatch: registration.dispatch,
  });
}

function alreadyRegistered<TInput extends ActionPayload, TOutput extends ActionPayload>(
  current: StoredActionRegistration | undefined,
  next: ActionRegistration<TInput, TOutput>,
): boolean {
  return current !== undefined && sameRef(current.descriptor.ref, next.descriptor.ref);
}

/** Public registration surface. Dispatch remains reachable only through the ActionPort boundary. */
export class ActionRegistry {
  // Keep the dispatch map out of the public object and out of enumerable state.
  // The registry is intentionally the only module capability that can resolve it.
  constructor(maxActions = MAX_ACTIONS) {
    if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > MAX_ACTIONS)
      throw new TypeError('maxActions must be a bounded positive safe integer.');
    registryState.set(this, { entries: new Map(), maxActions });
  }

  private state(): RegistryState | undefined {
    return registryState.get(this);
  }

  register<TInput extends ActionPayload, TOutput extends ActionPayload>(
    registration: ActionRegistration<TInput, TOutput>,
  ): Outcome<void> {
    const state = this.state();
    if (state === undefined) return failure('action.invalid', 'The action registry is not trusted.');
    if (!hasRegistrationShape(registration))
      return failure('action.invalid', 'The action registration is not a valid trusted descriptor.');
    if (!hasMatchingSchemas(registration))
      return failure('action.invalid', 'The registered input/output schemas do not match the action descriptor.');
    const key = registration.descriptor.ref.id;
    const current = state.entries.get(key);
    if (alreadyRegistered(current, registration))
      return failure('action.invalid', 'An action with this version is already registered.');
    if (current === undefined && state.entries.size >= state.maxActions)
      return failure('action.budget', 'The action registry is full.');
    const entry = registryEntry(registration);
    // A newer revision replaces the active revision for this stable action identity.
    state.entries.set(key, entry);
    return { ok: true, value: undefined };
  }

  unregister(actionId: string): boolean {
    if (!validId(actionId)) return false;
    return this.state()?.entries.delete(actionId) ?? false;
  }

  describe(action: VersionRef): ActionDescriptor | undefined {
    if (!validRef(action)) return undefined;
    const entry = this.state()?.entries.get(action.id);
    return entry !== undefined && sameRef(entry.descriptor.ref, action) ? entry.descriptor : undefined;
  }

  get size(): number {
    return this.state()?.entries.size ?? 0;
  }
}

interface RegistryState {
  readonly entries: Map<string, StoredActionRegistration>;
  readonly maxActions: number;
}

const registryState = new WeakMap<ActionRegistry, RegistryState>();

export function createActionRegistry(options: { readonly maxActions?: number } = {}): ActionRegistry {
  return new ActionRegistry(options.maxActions);
}

/** @internal ActionPort-only lookup; deliberately omitted from the public actions index. */
export function resolveRegisteredAction(registry: ActionRegistry, action: VersionRef): ActionRegistration | undefined {
  if (registry === null || (typeof registry !== 'object' && typeof registry !== 'function') || !validRef(action))
    return undefined;
  const entry = registryState.get(registry)?.entries.get(action.id);
  if (entry === undefined || !sameRef(entry.descriptor.ref, action)) return undefined;
  // Runtime schema parsing is the boundary that validates the erased generic payload types.
  return entry as unknown as ActionRegistration;
}
