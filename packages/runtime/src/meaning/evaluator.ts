import { parseWireValue, type MeaningDefinition, type Outcome, type QuerySpec, type VersionRef } from '@varendo/core';
import { createQueryPlanner } from '@varendo/core/query';
import type { QueryLimits, QueryResult, QuerySource } from '@varendo/core/query';
import { validateMeaning } from '@varendo/core/semantics';
import type { MeaningEvaluationInput, MeaningEvaluator, MeaningEvaluatorOptions } from './types.js';
import { freezeMeaningValue, snapshotMeaningAuthoringOptions } from './authoring.js';

function failure<T>(code: string, message: string, path?: readonly (string | number)[]): Outcome<T> {
  return {
    ok: false,
    diagnostics: [{ code, message, retryable: false, ...(path === undefined ? {} : { path: [...path] }) }],
  };
}

function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function validRef(value: unknown): value is VersionRef {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).revision === 'string'
  );
}

function isMeaningDefinition(value: VersionRef | MeaningDefinition): value is MeaningDefinition {
  return typeof value === 'object' && value !== null && 'implementation' in value;
}

function meaningDefinitions(options: MeaningEvaluatorOptions): readonly MeaningDefinition[] {
  const output = new Map<string, MeaningDefinition>();
  for (const meaning of options.catalog.meanings) output.set(JSON.stringify([meaning.id, meaning.revision]), meaning);
  for (const meaning of options.definitions ?? []) output.set(JSON.stringify([meaning.id, meaning.revision]), meaning);
  return [...output.values()];
}

function resolveMeaning(
  input: VersionRef | MeaningDefinition,
  options: MeaningEvaluatorOptions,
): Outcome<MeaningDefinition> {
  if (!validRef(input))
    return failure(
      'runtime.meaning-input',
      'Meaning evaluation requires a canonical meaning reference or definition.',
      ['meaning'],
    );
  const definitions = meaningDefinitions(options);
  const candidate = isMeaningDefinition(input) ? input : definitions.find((meaning) => sameRef(meaning, input));
  if (candidate === undefined)
    return failure('runtime.meaning-unknown', 'The meaning definition is not available in the evaluator scope.', [
      'meaning',
    ]);
  // Validation is repeated at the evaluator boundary. A draft or hypothesis
  // can be previewed locally, but it still receives exactly the same semantic
  // checks as a reviewed definition and never gains activation authority here.
  return validateMeaning(candidate, {
    catalog: options.catalog,
    registry: options.registry,
    ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
}

function queryForMeaning(input: MeaningEvaluationInput, meaning: MeaningDefinition): QuerySpec {
  const groupBy = input.groupBy === undefined ? [] : [...input.groupBy];
  const fields = input.fields === undefined ? groupBy : [...input.fields];
  return {
    entity: input.entity,
    fields,
    measures: [{ id: meaning.id, revision: meaning.revision }],
    relations: [],
    groupBy,
    population: { kind: 'all-authorized' },
    order: [],
  };
}

function normalizeLimits(value: unknown): Outcome<Partial<QueryLimits> | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const inspected = parseWireValue(value);
  if (!inspected.ok) return inspected;
  if (!isRecord(inspected.value))
    return failure('runtime.meaning-evaluator', 'Meaning evaluator limits must be a bounded object.', ['limits']);
  return { ok: true, value: freezeMeaningValue(inspected.value) as Partial<QueryLimits> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createPlanner(
  options: MeaningEvaluatorOptions,
  limits: Partial<QueryLimits> | undefined,
): ReturnType<typeof createQueryPlanner> {
  return createQueryPlanner({
    catalog: options.catalog,
    registry: options.registry,
    ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
    ...(limits === undefined ? {} : { limits }),
  });
}

function sourceIsBounded(source: QuerySource): boolean {
  return (
    source !== null &&
    typeof source === 'object' &&
    source.relations !== undefined &&
    typeof source.relations === 'object'
  );
}

function evaluateQuery(
  input: MeaningEvaluationInput,
  query: QuerySpec,
  meaning: MeaningDefinition,
  snapshot: MeaningEvaluatorOptions,
  limits: Partial<QueryLimits> | undefined,
  source: QuerySource,
): Outcome<QueryResult> {
  const definitions = [...(snapshot.definitions ?? [])];
  if (!definitions.some((candidate) => sameRef(candidate, meaning))) definitions.push(meaning);
  const planner = createQueryPlanner({
    catalog: snapshot.catalog,
    registry: snapshot.registry,
    definitions,
    ...(limits === undefined ? {} : { limits }),
  });
  if (!planner.ok) return planner;
  const plan = planner.value.plan(query);
  if (!plan.ok) return plan;
  return planner.value.evaluate(plan.value, source, {
    cancellation: { aborted: input.signal?.aborted === true },
    ...(input.scopeDigest === undefined ? {} : { scopeDigest: input.scopeDigest }),
    ...(input.policyRevision === undefined ? {} : { policyRevision: input.policyRevision }),
  });
}

function sourceContext(
  input: MeaningEvaluationInput,
  source: QuerySource,
): Outcome<{ readonly scopeDigest?: string; readonly policyRevision?: string }> {
  if (input.scopeDigest !== undefined && source.scopeDigest !== input.scopeDigest)
    return failure('runtime.meaning-scope', 'The query source is outside the requested meaning scope.', [
      'scopeDigest',
    ]);
  if (input.policyRevision !== undefined && source.policyRevision !== input.policyRevision)
    return failure('runtime.meaning-stale', 'The query source policy revision is stale.', ['policyRevision']);
  return {
    ok: true,
    value: {
      ...(input.scopeDigest === undefined ? {} : { scopeDigest: input.scopeDigest }),
      ...(input.policyRevision === undefined ? {} : { policyRevision: input.policyRevision }),
    },
  };
}

/**
 * Evaluate a canonical meaning with the same pure planner/evaluator used by
 * data tasks. This helper owns no source, network or authorization effect;
 * callers supply an already-authorized bounded QuerySource and may use it for
 * manual, Studio or AI-assisted previews alike.
 */
export function createMeaningEvaluator(options: MeaningEvaluatorOptions): Outcome<MeaningEvaluator> {
  if (!isRecord(options)) return failure('runtime.meaning-evaluator', 'Meaning evaluator options are required.');
  const context = snapshotMeaningAuthoringOptions(options);
  if (!context.ok) return context;
  const parsedLimits = normalizeLimits(options.limits);
  if (!parsedLimits.ok) return parsedLimits;
  const limits = parsedLimits.value;
  const snapshot: MeaningEvaluatorOptions = {
    catalog: context.value.catalog,
    registry: context.value.registry,
    ...(context.value.definitions === undefined ? {} : { definitions: context.value.definitions }),
    ...(context.value.policy === undefined ? {} : { policy: context.value.policy }),
    ...(limits === undefined ? {} : { limits }),
  };
  const planner = createPlanner(snapshot, limits);
  if (!planner.ok) return planner;

  const evaluate = (input: MeaningEvaluationInput): Outcome<QueryResult> => {
    if (!isRecord(input)) return failure('runtime.meaning-evaluation', 'Meaning evaluation input is required.');
    const meaning = resolveMeaning(input.meaning, snapshot);
    if (!meaning.ok) return meaning;
    const source = input.source;
    if (!sourceIsBounded(source))
      return failure('runtime.meaning-source', 'Meaning evaluation requires a bounded query source.', ['source']);
    const context = sourceContext(input, source);
    if (!context.ok) return context;
    const query = queryForMeaning(input, meaning.value);
    // Core accepts plain data for cancellation; no asynchronous effect is hidden in this adapter.
    return evaluateQuery(input, query, meaning.value, snapshot, limits, source);
  };
  return { ok: true, value: Object.freeze({ evaluate }) };
}
