import type { Outcome } from '@varendo/core';
import type { AgentCapabilityReceipt } from '../capabilities/types.js';
import type { AgentToolDefinition, AgentToolEndpoint } from '../protocol/types.js';
import { normalizeDefinitions, nativeAnnotations } from './definitions.js';
import { detectWebMcp } from './detection.js';
import { isRecord } from '../guards.js';
import type {
  WebMcpAdapter,
  WebMcpAdapterOptions,
  WebMcpDetection,
  WebMcpExecutionOptions,
  WebMcpModelContext,
  WebMcpRegisterOptions,
  WebMcpRegistration,
  WebMcpTool,
} from './types.js';

interface Registered {
  readonly definition: AgentToolDefinition;
  readonly controller: AbortController;
  active: boolean;
}

interface AdapterState {
  readonly endpoint: AgentToolEndpoint;
  readonly detection: WebMcpDetection;
  readonly registrations: Map<string, Registered>;
  readonly pendingControllers: Set<AbortController>;
  closed: boolean;
  callCounter: number;
  registrationPromise: Promise<Outcome<readonly WebMcpRegistration[]>> | undefined;
}

function failure<T>(code: string, message: string): Outcome<T> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

function cancellationFailure<T>(closed: boolean): Outcome<T> {
  return failure(
    closed ? 'agent.webmcp.closed' : 'agent.webmcp.cancelled',
    closed ? 'The WebMCP adapter has been closed.' : 'The WebMCP operation was cancelled.',
  );
}

function safeEndpoint(options: WebMcpAdapterOptions): AgentToolEndpoint {
  if (
    options === null ||
    typeof options !== 'object' ||
    !isRecord(options.endpoint) ||
    typeof options.endpoint.discover !== 'function' ||
    typeof options.endpoint.invoke !== 'function' ||
    typeof options.endpoint.close !== 'function' ||
    typeof options.endpoint.transport !== 'string'
  )
    throw new TypeError('A WebMCP adapter requires a host-owned tool endpoint.');
  return options.endpoint as unknown as AgentToolEndpoint;
}

function safeContext(options: WebMcpAdapterOptions): WebMcpDetection {
  const evidence = options.evidence ?? 'simulated';
  if (evidence !== 'native' && evidence !== 'simulated')
    throw new TypeError('The supplied WebMCP evidence is invalid.');
  if (options.modelContext !== undefined) {
    if (!validModelContext(options.modelContext)) throw new TypeError('The supplied WebMCP modelContext is invalid.');
    return Object.freeze({ evidence, supported: true, modelContext: options.modelContext });
  }
  if (Object.hasOwn(options, 'document')) return detectWebMcp({ document: options.document, evidence });
  return detectWebMcp();
}

function validModelContext(value: unknown): value is WebMcpModelContext {
  return (
    isRecord(value) &&
    typeof value.registerTool === 'function' &&
    (value.getTools === undefined || typeof value.getTools === 'function')
  );
}

function disposeRegistrations(state: AdapterState): void {
  for (const controller of state.pendingControllers) controller.abort();
  state.pendingControllers.clear();
  for (const registration of state.registrations.values()) {
    registration.active = false;
    registration.controller.abort();
  }
  state.registrations.clear();
}

function discoveryStop(state: AdapterState, signal?: AbortSignal): Outcome<never> | undefined {
  if (state.closed) return cancellationFailure(true);
  if (!state.detection.supported || state.detection.modelContext === undefined)
    return failure('agent.webmcp.unavailable', state.detection.reason ?? 'The native WebMCP host is unavailable.');
  if (signal?.aborted) return cancellationFailure(false);
  if (state.endpoint.transport !== 'webmcp')
    return failure('agent.webmcp.transport', 'The endpoint is not bound to the WebMCP transport.');
  return undefined;
}

async function discover(
  state: AdapterState,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Outcome<readonly AgentToolDefinition[]>> {
  const stop = discoveryStop(state, options.signal);
  if (stop !== undefined) return stop;
  try {
    const result =
      options.signal === undefined ? await state.endpoint.discover() : await state.endpoint.discover(options);
    const after = discoveryStop(state, options.signal);
    if (after !== undefined) return after;
    if (!result.ok) return failure('agent.webmcp.discovery', 'Authorized tool discovery was unavailable.');
    return normalizeDefinitions(result.value);
  } catch {
    return failure('agent.webmcp.discovery', 'Authorized tool discovery failed safely.');
  }
}

function linkSignal(
  primary: AbortSignal | undefined,
  secondary: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (primary?.aborted || secondary.aborted) controller.abort();
  else {
    primary?.addEventListener('abort', abort, { once: true });
    secondary.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: (): void => {
      primary?.removeEventListener('abort', abort);
      secondary.removeEventListener('abort', abort);
    },
  };
}

function executionStop(
  state: AdapterState,
  registration: Registered,
  signal?: AbortSignal,
): Outcome<never> | undefined {
  if (state.closed) return cancellationFailure(true);
  if (!registration.active || registration.controller.signal.aborted || signal?.aborted)
    return cancellationFailure(false);
  return undefined;
}

async function executeRegisteredTool(
  state: AdapterState,
  registration: Registered,
  input: unknown,
  options?: WebMcpExecutionOptions,
): Promise<Outcome<AgentCapabilityReceipt>> {
  const stop = executionStop(state, registration, options?.signal);
  if (stop !== undefined) return stop;
  const linked = linkSignal(options?.signal, registration.controller.signal);
  try {
    if (linked.signal.aborted) return cancellationFailure(state.closed);
    const result = await state.endpoint.invoke(registration.definition.name, input, {
      requestId: `webmcp-${++state.callCounter}`,
      signal: linked.signal,
    });
    const after = executionStop(state, registration, linked.signal);
    return after ?? result;
  } catch {
    const after = executionStop(state, registration, linked.signal);
    if (after !== undefined) return after;
    return failure('agent.webmcp.invoke', 'WebMCP capability execution failed safely.');
  } finally {
    linked.dispose();
  }
}

function webMcpTool(state: AdapterState, registration: Registered): WebMcpTool {
  const definition = registration.definition;
  return Object.freeze({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: nativeAnnotations(definition.operation),
    execute: (input: unknown, options?: WebMcpExecutionOptions) =>
      executeRegisteredTool(state, registration, input, options),
  });
}

function registrationRecord(state: AdapterState, definition: AgentToolDefinition): WebMcpRegistration {
  return Object.freeze({
    name: definition.name,
    capability: Object.freeze({ ...definition.capability }),
    operation: definition.operation,
    evidence: state.detection.evidence,
  });
}

async function registerDefinition(
  state: AdapterState,
  definition: AgentToolDefinition,
  options: WebMcpRegisterOptions,
): Promise<Outcome<WebMcpRegistration>> {
  if (state.closed || options.signal?.aborted) return cancellationFailure(state.closed);
  const controller = new AbortController();
  state.pendingControllers.add(controller);
  const abortRegistration = (): void => controller.abort();
  options.signal?.addEventListener('abort', abortRegistration, { once: true });
  const registration: Registered = { definition, controller, active: true };
  controller.signal.addEventListener('abort', () => (registration.active = false), { once: true });
  try {
    const context = state.detection.modelContext;
    if (context === undefined) return cancellationFailure(false);
    const result = await registerNativeTool(context, webMcpTool(state, registration), controller);
    if (result === 'cancelled') {
      disposeRegistrations(state);
      return cancellationFailure(state.closed);
    }
  } finally {
    state.pendingControllers.delete(controller);
    options.signal?.removeEventListener('abort', abortRegistration);
  }
  if (state.closed || options.signal?.aborted || controller.signal.aborted) {
    registration.active = false;
    controller.abort();
    disposeRegistrations(state);
    return cancellationFailure(state.closed);
  }
  state.registrations.set(definition.name, registration);
  return { ok: true, value: registrationRecord(state, definition) };
}

async function registerAll(
  state: AdapterState,
  options: WebMcpRegisterOptions,
): Promise<Outcome<readonly WebMcpRegistration[]>> {
  if (state.closed) return cancellationFailure(true);
  if (!state.detection.supported || state.detection.modelContext === undefined)
    return failure('agent.webmcp.unavailable', state.detection.reason ?? 'The native WebMCP host is unavailable.');
  if (options.signal?.aborted) return cancellationFailure(false);
  const discovered = await discover(state, options);
  if (!discovered.ok) return discovered;
  disposeRegistrations(state);
  const created: WebMcpRegistration[] = [];
  try {
    for (const definition of discovered.value) {
      const registered = await registerDefinition(state, definition, options);
      if (!registered.ok) {
        disposeRegistrations(state);
        return registered;
      }
      created.push(registered.value);
    }
    return { ok: true, value: Object.freeze(created) };
  } catch {
    disposeRegistrations(state);
    return failure('agent.webmcp.registration', 'WebMCP tool registration failed safely.');
  }
}

async function register(
  state: AdapterState,
  options: WebMcpRegisterOptions = {},
): Promise<Outcome<readonly WebMcpRegistration[]>> {
  if (state.registrationPromise !== undefined) return state.registrationPromise;
  const work = registerAll(state, options);
  state.registrationPromise = work.finally(() => {
    state.registrationPromise = undefined;
  });
  return state.registrationPromise;
}

async function registerNativeTool(
  context: WebMcpModelContext,
  tool: WebMcpTool,
  controller: AbortController,
): Promise<'registered' | 'cancelled'> {
  if (controller.signal.aborted) return 'cancelled';
  let resolveAbort!: () => void;
  const aborted = new Promise<'cancelled'>((resolve) => {
    resolveAbort = () => resolve('cancelled');
    controller.signal.addEventListener('abort', resolveAbort, { once: true });
  });
  const registration = Promise.resolve().then(async () => {
    if (controller.signal.aborted) return 'cancelled' as const;
    await context.registerTool(tool, { signal: controller.signal });
    return controller.signal.aborted ? ('cancelled' as const) : ('registered' as const);
  });
  try {
    const result = await Promise.race([registration, aborted]);
    if (result === 'cancelled') void registration.catch(() => undefined);
    return result;
  } finally {
    controller.signal.removeEventListener('abort', resolveAbort);
  }
}

function close(state: AdapterState): void {
  if (state.closed) return;
  state.closed = true;
  disposeRegistrations(state);
  try {
    state.endpoint.close();
  } catch {
    /* disposal remains closed even if the host cleanup throws */
  }
}

/** Projects one endpoint into the native WebMCP registration API. */
export function createWebMcpAdapter(options: WebMcpAdapterOptions): WebMcpAdapter {
  const endpoint = safeEndpoint(options);
  const detection = safeContext(options);
  const state: AdapterState = {
    endpoint,
    detection,
    registrations: new Map(),
    pendingControllers: new Set(),
    closed: false,
    callCounter: 0,
    registrationPromise: undefined,
  };
  return Object.freeze({
    evidence: detection.evidence,
    supported: detection.supported,
    discover: (discoverOptions = {}) => discover(state, discoverOptions),
    register: (registerOptions = {}) => register(state, registerOptions),
    close: () => close(state),
  });
}
