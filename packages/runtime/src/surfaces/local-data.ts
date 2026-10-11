import type { DataFeatureDefinition } from '@varendo/core/features';
import { inferLocalDataShape } from '@varendo/core/features';
import type { Outcome } from '@varendo/core';
import type { ActionPort } from '../actions/types.js';
import { createFeatureLocalDataService } from '../data/local.js';
import type { LocalDataService, LocalDataServiceOptions, LocalSnapshot, ResultEvent } from '../data/types.js';
import {
  isSourceCapacityError,
  normalizeSnapshot,
  normalizeSourceLimits,
  sourceDiagnosticCode,
} from '../data/local/source.js';
import { canonical } from '../data/local/shared.js';
import type { DataServiceCoverage, DataSurfaceBindings, SurfaceReadContext } from './types.js';

export interface LocalDataSurfaceBinding<S> extends DataSurfaceBindings<S> {
  readonly service: LocalDataService;
}

export interface CreateLocalDataBindingInput<S> {
  readonly feature: DataFeatureDefinition;
  readonly snapshot: LocalSnapshot;
  readonly initialState: S;
  readonly coverage: DataServiceCoverage;
  readonly normalize: (events: AsyncIterable<ResultEvent>, context: SurfaceReadContext) => Promise<S>;
  readonly serviceOptions?: Omit<LocalDataServiceOptions, 'snapshot'>;
  readonly actions?: ActionPort;
}

function immutableCoverage(coverage: DataServiceCoverage): DataServiceCoverage {
  const stableOrder = coverage.stableOrder.map((order) =>
    typeof order === 'string' ? order : Object.freeze({ ...order }),
  );
  return Object.freeze({
    ...coverage,
    fields: Object.freeze([...coverage.fields]),
    ...(coverage.relations === undefined
      ? {}
      : { relations: Object.freeze(coverage.relations.map((relation) => Object.freeze({ ...relation }))) }),
    ...(coverage.metrics === undefined
      ? {}
      : { metrics: Object.freeze(coverage.metrics.map((metric) => Object.freeze({ ...metric }))) }),
    operators: Object.freeze([...coverage.operators]),
    stableOrder: Object.freeze(stableOrder),
    ...(coverage.stableOrderIdentity === undefined
      ? {}
      : { stableOrderIdentity: Object.freeze([...coverage.stableOrderIdentity]) }),
    unsupported: Object.freeze([...coverage.unsupported]),
  });
}

function validateFeatureSnapshot(input: CreateLocalDataBindingInput<unknown>): LocalSnapshot {
  if (input.feature.kind !== 'data') throw new TypeError('Local data bindings require a data feature definition.');
  const limits = normalizeSourceLimits(input.serviceOptions?.sourceLimits);
  let snapshot: LocalSnapshot;
  try {
    snapshot = normalizeSnapshot(input.snapshot, limits, { rejectExecutableToJSON: true });
  } catch (error) {
    const code = isSourceCapacityError(error)
      ? 'data.shape-capacity'
      : (sourceDiagnosticCode(error) ?? 'data.shape-inconsistent');
    throw new TypeError(`${code}: The local binding snapshot could not be captured safely.`);
  }
  if (canonical(input.feature.catalog) !== canonical(snapshot.catalog))
    throw new TypeError('data.feature-catalog: The local source catalog must match the mounted data feature catalog.');
  const shape = validateFeatureShape(input, snapshot);
  if (!shape.ok) throw new TypeError(`${shape.diagnostics[0].code}: ${shape.diagnostics[0].message}`);
  return snapshot;
}

function validateFeatureShape(input: CreateLocalDataBindingInput<unknown>, snapshot: LocalSnapshot): Outcome<void> {
  const rows = snapshot.records[input.feature.entity.id] ?? [];
  const shape = inferLocalDataShape({
    id: input.feature.id,
    rows,
    schema: input.feature.schema,
    identity: input.feature.identity,
    ...(input.serviceOptions?.sourceLimits === undefined ? {} : { limits: input.serviceOptions.sourceLimits }),
  });
  if (!shape.ok) return { ok: false, diagnostics: shape.diagnostics };
  return { ok: true, value: undefined };
}

/** Creates the single local DataService lowering used by scoped surfaces. */
export function createLocalDataBinding<S>(input: CreateLocalDataBindingInput<S>): LocalDataSurfaceBinding<S> {
  const snapshot = validateFeatureSnapshot(input as CreateLocalDataBindingInput<unknown>);
  const service = createFeatureLocalDataService(
    {
      ...(input.serviceOptions ?? {}),
      snapshot,
    },
    input.feature.catalog,
    (next) => validateFeatureShape(input as CreateLocalDataBindingInput<unknown>, next),
  );
  const source = Object.freeze({
    kind: 'data-service' as const,
    service,
    coverage: immutableCoverage(input.coverage),
    normalize: input.normalize,
  });
  return Object.freeze({
    initialState: input.initialState,
    source,
    service,
    ...(input.actions === undefined ? {} : { actions: input.actions }),
  });
}
