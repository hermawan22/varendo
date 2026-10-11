import type { CommitPreconditions, PresentationPlan } from '@varendo/core';
import type {
  PresentationComposition,
  PresentationContext,
  PresentationEnvironment,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import { canonicalJson as canonical } from '../canonical.js';
import type { RegionFailure, RegionOutcome, RegionReadSet, RegionSnapshot } from '../regions/types.js';
import type {
  PresentationAdaptationContext,
  PresentationAdaptationContextSource,
  PresentationAdaptationOptions,
  PresentationAdaptationReadInput,
} from './adaptation-types.js';

export const adaptationFailure = <T>(code: string, message: string): RegionOutcome<T> => ({
  ok: false,
  diagnostics: [{ code, message, retryable: false }],
});

interface ContextInput {
  readonly source: PresentationAdaptationContextSource;
  readonly input: PresentationAdaptationReadInput;
}

export function samePlan(left: PresentationPlan | undefined, right: PresentationPlan | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  return (
    canonical({ rootId: left.rootId, nodes: left.nodes, links: left.links, coverage: left.coverage }) ===
    canonical({ rootId: right.rootId, nodes: right.nodes, links: right.links, coverage: right.coverage })
  );
}

function validNonnegativeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

export function validatePresentationAdaptationOptions(options: PresentationAdaptationOptions): void {
  if (!hasRequiredOptions(options))
    throw new TypeError('A region, presentation registry, context and renderer are required.');
  const dwellMs = options.dwellMs ?? 120;
  const hysteresisPx = options.hysteresisPx ?? 8;
  const maxPending = options.maxPendingRequests ?? 64;
  if (
    !validNonnegativeInteger(dwellMs) ||
    !validNonnegativeInteger(hysteresisPx) ||
    !validNonnegativeInteger(maxPending) ||
    maxPending < 1
  )
    throw new TypeError('Adaptation budgets must be nonnegative safe integers.');
}

function hasRequiredOptions(options: PresentationAdaptationOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    options.region !== undefined &&
    options.registry !== undefined &&
    options.baseContext !== undefined &&
    options.renderer !== undefined
  );
}

function readMeasurement(
  environment: PresentationEnvironment,
  key: 'inlineSize' | 'blockSize' | 'textScale',
): number | undefined {
  const measurement = environment[key];
  return measurement.state === 'known' && typeof measurement.value === 'number' && Number.isFinite(measurement.value)
    ? measurement.value
    : undefined;
}

function environmentFlagsChanged(previous: PresentationEnvironment, next: PresentationEnvironment): boolean {
  return (
    previous.locale !== next.locale ||
    previous.direction !== next.direction ||
    previous.pointer !== next.pointer ||
    previous.hover !== next.hover ||
    previous.keyboard !== next.keyboard ||
    previous.reducedMotion !== next.reducedMotion ||
    previous.forcedColors !== next.forcedColors
  );
}

function measurementsChanged(
  previous: PresentationEnvironment,
  next: PresentationEnvironment,
  threshold: number,
): boolean {
  for (const key of ['inlineSize', 'blockSize', 'textScale'] as const) {
    const before = readMeasurement(previous, key);
    const after = readMeasurement(next, key);
    if (before === undefined || after === undefined) return true;
    if (key === 'textScale' && before !== after) return true;
    if (Math.abs(after - before) >= threshold) return true;
  }
  return false;
}

export function environmentRequiresRefresh(
  previous: PresentationEnvironment | undefined,
  next: PresentationEnvironment,
  threshold: number,
): boolean {
  if (previous === undefined) return true;
  if (environmentFlagsChanged(previous, next)) return true;
  return measurementsChanged(previous, next, threshold);
}

export function snapshotReadSet(snapshot: RegionSnapshot): RegionOutcome<RegionReadSet> {
  if (snapshot.status !== 'active' || snapshot.state === undefined || snapshot.readSet === undefined)
    return adaptationFailure('runtime.presentation-disposed', 'The region has no active task and read set.');
  return { ok: true, value: snapshot.readSet };
}

export function semanticReadSet(readSet: RegionReadSet): CommitPreconditions {
  const { dataRevision: _dataRevision, ...pins } = readSet;
  return pins;
}

export function sameSnapshot(left: RegionSnapshot, right: RegionSnapshot): boolean {
  return (
    left.status === right.status &&
    left.taskRevision === right.taskRevision &&
    left.regionRevision === right.regionRevision &&
    left.dataRevision === right.dataRevision
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOutcome(value: Record<string, unknown>): RegionOutcome<PresentationAdaptationContext> {
  if (value.ok === true) return normalizeContextOutcome(value.value);
  if (value.ok === false && Array.isArray(value.diagnostics) && value.diagnostics.length > 0)
    return { ok: false, diagnostics: value.diagnostics as unknown as readonly [RegionFailure, ...RegionFailure[]] };
  return adaptationFailure('runtime.presentation-context', 'The host context callback returned an invalid outcome.');
}

function normalizeContext(value: Record<string, unknown>): RegionOutcome<PresentationAdaptationContext> {
  if (value.experience === undefined || value.results === undefined)
    return adaptationFailure(
      'runtime.presentation-context',
      'Adaptation context requires an Experience and authorized result descriptors.',
    );
  if (!Array.isArray(value.results) || !Array.isArray(value.rendererCapabilities))
    return adaptationFailure(
      'runtime.presentation-context',
      'Adaptation context requires result descriptors and renderer capabilities.',
    );
  const { task: _task, current: _current, incumbent: _incumbent, ...host } = value;
  return { ok: true, value: host as unknown as PresentationAdaptationContext };
}

function normalizeContextOutcome(value: unknown): RegionOutcome<PresentationAdaptationContext> {
  if (isRecord(value) && Object.hasOwn(value, 'ok')) return normalizeOutcome(value);
  if (!isRecord(value))
    return adaptationFailure('runtime.presentation-context', 'The host context is not a bounded object.');
  return normalizeContext(value);
}

export async function readSource(input: ContextInput): Promise<RegionOutcome<PresentationAdaptationContext>> {
  try {
    const raw = typeof input.source === 'function' ? input.source(input.input) : input.source;
    if (!isPromiseLike(raw)) return normalizeContextOutcome(raw);
    return await waitForContext(input, raw);
  } catch {
    return adaptationFailure('runtime.presentation-context', 'The host context callback failed.');
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as PromiseLike<unknown>).then === 'function';
}

function waitForContext(
  input: ContextInput,
  raw: PromiseLike<unknown>,
): Promise<RegionOutcome<PresentationAdaptationContext>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: RegionOutcome<PresentationAdaptationContext>): void => {
      if (settled) return;
      settled = true;
      input.input.signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void =>
      finish(adaptationFailure('runtime.presentation-cancelled', 'The adaptation context refresh was cancelled.'));
    input.input.signal.addEventListener('abort', onAbort, { once: true });
    if (input.input.signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(raw).then(
      (value) => finish(normalizeContextOutcome(value)),
      () => finish(adaptationFailure('runtime.presentation-context', 'The host context callback failed.')),
    );
  });
}

export function failureFromCore<T>(outcome: {
  readonly ok: false;
  readonly diagnostics: readonly unknown[];
}): RegionOutcome<T> {
  return { ok: false, diagnostics: outcome.diagnostics as readonly [RegionFailure, ...RegionFailure[]] };
}

export function contextFor(
  snapshot: RegionSnapshot,
  base: PresentationAdaptationContext,
  environment: PresentationEnvironment,
  explicit: boolean,
): RegionOutcome<PresentationContext> {
  const readSet = snapshotReadSet(snapshot);
  if (!readSet.ok) return readSet;
  if (snapshot.state === undefined)
    return adaptationFailure('runtime.presentation-disposed', 'The region has no current task.');
  return {
    ok: true,
    value: {
      ...base,
      task: snapshot.state.task,
      current: semanticReadSet(readSet.value),
      environment,
      ...(snapshot.state.presentation === undefined ? {} : { incumbent: snapshot.state.presentation }),
      explicitTransition: explicit,
    },
  };
}

export function resultForPlan(validated: ValidatedPresentation, plan: PresentationPlan): ValidatedPresentation {
  return Object.freeze({ ...validated, plan });
}

export function readTransitionBlocked(callback: (() => boolean) | undefined): boolean {
  if (callback === undefined) return false;
  try {
    return callback() === true;
  } catch {
    return true;
  }
}

export function makeRequestId(counter: number): { readonly id: string; readonly revision: string } {
  return { id: `adapt.${counter.toString(36)}`, revision: '1' };
}

export function compositionForCommit(
  composition: PresentationComposition,
  candidate: ValidatedPresentation,
  committedPlan: PresentationPlan | undefined,
): PresentationComposition {
  return Object.freeze({
    ...composition,
    presentation: committedPlan === undefined ? candidate : resultForPlan(candidate, committedPlan),
  });
}
