import { parseIntent, parseTask } from '../contracts/parse.js';
import type { Diagnostic, Intent, Outcome, QuerySpec, Task } from '../contracts/types.js';
import type {
  CompileIntentOptions,
  CustomIntentDefinition,
  IntentCompilerContext,
  IntentIdentity,
  ResourceDefinition,
} from './types.js';

type Path = readonly (string | number)[];
function failure<T>(code: string, message: string, path: Path = [], remedies?: readonly string[]): Outcome<T> {
  const diagnostic: Diagnostic = {
    code,
    message,
    path,
    retryable: false,
    ...(remedies === undefined ? {} : { remedies }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}
function ref(id: string) {
  return { id, revision: '1' } as const;
}

function fieldSet(resource: ResourceDefinition): ReadonlySet<string> {
  return new Set(resource.entity.fields.map((field) => field.id));
}

function validateFields(
  resource: ResourceDefinition,
  fields: readonly string[] | undefined,
  path: Path,
  includeIdentity = true,
): Outcome<readonly string[]> {
  const available = fieldSet(resource);
  const requested =
    fields ??
    resource.entity.fields
      .filter((field) => resource.fieldMetadata[field.id]?.hidden !== true)
      .map((field) => field.id);
  const selected = includeIdentity ? [...resource.entity.identity, ...requested] : requested;
  if (selected.length === 0) return failure('intent.empty-fields', 'At least one visible field is required.', path);
  for (let index = 0; index < selected.length; index += 1) {
    if (!available.has(selected[index]!))
      return failure('intent.unknown-field', `Field ${selected[index]} is not available on ${resource.id}.`, [
        ...path,
        index,
      ]);
  }
  return { ok: true, value: [...new Set(selected)] };
}

function identityPredicate(
  resource: ResourceDefinition,
  identity: IntentIdentity,
  path: Path,
): Outcome<NonNullable<QuerySpec['where']>> {
  const expected = resource.entity.identity;
  const keys = Object.keys(identity);
  if (
    keys.length !== expected.length ||
    expected.some((field) => !Object.hasOwn(identity, field)) ||
    keys.some((field) => !expected.includes(field))
  )
    return failure(
      'intent.identity',
      `Identity for ${resource.id} must provide exactly: ${expected.join(', ')}.`,
      path,
    );
  const predicates: NonNullable<QuerySpec['where']>[] = [];
  for (const field of expected) {
    const value = identity[field];
    if (value === undefined) return failure('intent.identity', `Identity field ${field} is missing.`, [...path, field]);
    predicates.push({ op: 'compare', field, comparison: 'eq', value });
  }
  return predicates.length === 1 ? { ok: true, value: predicates[0]! } : { ok: true, value: { op: 'and', predicates } };
}

function mergeFilter(left: QuerySpec['where'], right: QuerySpec['where']): QuerySpec['where'] {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return { op: 'and', predicates: [left, right] };
}

function validateFilter(
  resource: ResourceDefinition,
  predicate: NonNullable<QuerySpec['where']>,
  path: Path,
): Outcome<undefined> {
  if ('predicates' in predicate) {
    for (let index = 0; index < predicate.predicates.length; index += 1) {
      const checked = validateFilter(resource, predicate.predicates[index]!, [...path, 'predicates', index]);
      if (!checked.ok) return checked;
    }
    return { ok: true, value: undefined };
  }
  if ('predicate' in predicate) return validateFilter(resource, predicate.predicate, [...path, 'predicate']);
  return validateFilterLeaf(resource, predicate, path);
}

function validateFilterLeaf(
  resource: ResourceDefinition,
  predicate: Extract<NonNullable<QuerySpec['where']>, { readonly field: string }>,
  path: Path,
): Outcome<undefined> {
  const field = resource.entity.fields.find((candidate) => candidate.id === predicate.field);
  if (field === undefined)
    return failure(
      'intent.unknown-filter-field',
      `Filter field ${predicate.field} is not available on ${resource.id}.`,
      [...path, 'field'],
    );
  if (predicate.op === 'is-null') return { ok: true, value: undefined };
  const allowed = resource.fieldMetadata[predicate.field]?.values;
  if (allowed === undefined) return { ok: true, value: undefined };
  const values = predicate.op === 'in' ? predicate.values : [predicate.value];
  return validateFilterValues(predicate, values, allowed, path);
}

function validateFilterValues(
  predicate: Extract<NonNullable<QuerySpec['where']>, { readonly field: string }>,
  values: readonly unknown[],
  allowed: readonly unknown[],
  path: Path,
): Outcome<undefined> {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!allowed.some((candidate) => Object.is(candidate, value))) {
      const target = predicate.op === 'in' ? [...path, 'values', index] : [...path, 'value'];
      return failure(
        'intent.unknown-filter-value',
        `Filter value for ${predicate.field} is not in its registered closed domain.`,
        target,
        ['Use the exact registered value returned by aeliqo_context.'],
      );
    }
  }
  return { ok: true, value: undefined };
}

function queryTask(
  intent: Intent,
  resource: ResourceDefinition,
  regionId: string,
  revision: string,
  query: QuerySpec,
  operation: string,
  needFields: readonly string[],
): Task {
  const preferredView =
    intent.preferredView ?? resource.presentation.preferred?.[intent.kind === 'custom' ? 'browse' : intent.kind];
  return {
    version: '1',
    id: intent.id,
    revision,
    catalogRevision: resource.catalog.revision,
    functionRegistryDigest: resource.catalog.functionRegistryDigest,
    regionId,
    kind: 'data',
    goal: `${intent.kind} ${resource.label}`,
    assumptions: [],
    outputs: [{ id: 'primary', kind: 'query', query, dependsOn: [], delivery: 'eager' }],
    needs: [{ id: intent.kind, operation: ref(operation), outputId: 'primary', fields: needFields, required: true }],
    ...(preferredView === undefined
      ? {}
      : { viewPreference: { representation: preferredView, strength: 'preferred' } }),
  };
}

function baseQuery(resource: ResourceDefinition, fields: readonly string[]): QuerySpec {
  return {
    entity: resource.entity.id,
    fields,
    measures: [],
    relations: [],
    groupBy: [],
    population: { kind: 'all-authorized' },
    order: [],
  };
}

type FormIntent = Extract<Intent, { readonly kind: 'create' | 'edit' }>;
type AnalysisIntent = Extract<Intent, { readonly kind: 'analyze' }>;
type ReadIntent = Extract<Intent, { readonly kind: 'browse' | 'detail' | 'compare' }>;

function compileForm(intent: FormIntent, context: IntentCompilerContext): Outcome<Task> {
  const { resource } = context;
  const binding = resource.forms?.[intent.kind];
  if (binding === undefined)
    return failure('intent.unsupported', intent.kind + ' needs a registered form and action.', ['kind']);
  if (intent.kind === 'edit') {
    const identity = identityPredicate(resource, intent.identity, ['identity']);
    if (!identity.ok) return identity;
  }
  const task: Task = {
    version: '1',
    id: intent.id,
    revision: context.taskRevision,
    catalogRevision: resource.catalog.revision,
    functionRegistryDigest: resource.catalog.functionRegistryDigest,
    regionId: context.regionId,
    kind: 'form',
    goal: intent.kind + ' ' + resource.label,
    assumptions: [],
    needs: [],
    schema: binding.schema,
    action: binding.action,
    ...(intent.kind === 'edit' ? { entityKey: JSON.stringify(intent.identity) } : {}),
    ...(intent.preferredView === undefined
      ? {}
      : { viewPreference: { representation: intent.preferredView, strength: 'preferred' } }),
  };
  return parseTask(task);
}

function analysisDimensions(intent: AnalysisIntent, resource: ResourceDefinition): Outcome<readonly string[]> {
  const fields = Object.freeze([
    ...new Set([...(intent.dimensions ?? []), ...(intent.time === undefined ? [] : [intent.time.field])]),
  ]);
  if (fields.length === 0) return { ok: true, value: [] };
  return validateFields(resource, fields, ['dimensions'], false);
}

function validateAnalysisMeasures(intent: AnalysisIntent, resource: ResourceDefinition): Outcome<void> {
  for (let index = 0; index < intent.measures.length; index += 1) {
    const measure = intent.measures[index]!;
    const meaning = resource.catalog.meanings.find(
      (candidate) => candidate.id === measure.id && candidate.revision === measure.revision,
    );
    if (meaning === undefined)
      return failure(
        'intent.unknown-meaning',
        'Meaning ' + measure.id + '@' + measure.revision + ' is not registered for ' + resource.id + '.',
        ['measures', index],
      );
  }
  return { ok: true, value: undefined };
}

/** Calendar and timezone default to the time field's declared temporal policy; the week start never does. */
function timeBucket(intent: AnalysisIntent, resource: ResourceDefinition): QuerySpec['timeBucket'] {
  if (intent.time === undefined) return undefined;
  const temporal = resource.entity.fields.find((field) => field.id === intent.time?.field)?.type.temporal;
  const calendar = intent.time.calendar ?? temporal?.calendar;
  const timezone = intent.time.timezone ?? temporal?.timezone;
  return {
    field: intent.time.field,
    grain: intent.time.grain,
    ...(calendar === undefined ? {} : { calendar }),
    ...(timezone === undefined ? {} : { timezone }),
    ...(intent.time.weekStartsOn === undefined ? {} : { weekStartsOn: intent.time.weekStartsOn }),
  };
}

function queryOrder(
  sorts:
    | readonly { readonly field: string; readonly direction: 'asc' | 'desc'; readonly nulls?: 'first' | 'last' }[]
    | undefined,
): QuerySpec['order'] {
  return (sorts ?? []).map((sort) => ({
    field: sort.field,
    direction: sort.direction,
    nulls: sort.nulls ?? 'last',
  }));
}

function compileAnalyze(intent: AnalysisIntent, context: IntentCompilerContext): Outcome<Task> {
  const { resource } = context;
  if (intent.filter !== undefined) {
    const filter = validateFilter(resource, intent.filter, ['filter']);
    if (!filter.ok) return filter;
  }
  const dimensions = analysisDimensions(intent, resource);
  if (!dimensions.ok) return dimensions;
  const measures = validateAnalysisMeasures(intent, resource);
  if (!measures.ok) return measures;
  const bucket = timeBucket(intent, resource);
  const query: QuerySpec = {
    entity: resource.entity.id,
    fields: dimensions.value,
    measures: intent.measures,
    relations: [],
    groupBy: dimensions.value,
    population: { kind: 'all-authorized' },
    ...(intent.filter === undefined ? {} : { where: intent.filter }),
    ...(intent.period === undefined ? {} : { period: intent.period }),
    ...(bucket === undefined ? {} : { timeBucket: bucket }),
    order: queryOrder(intent.sort),
    ...(intent.limit === undefined ? {} : { topK: intent.limit }),
  };
  return {
    ok: true,
    value: queryTask(intent, resource, context.regionId, context.taskRevision, query, 'data.analyze', [
      ...dimensions.value,
      ...intent.measures.map((measure) => measure.id),
    ]),
  };
}

function compileBrowse(
  intent: Extract<ReadIntent, { readonly kind: 'browse' }>,
  context: IntentCompilerContext,
  requested: readonly string[],
  selected: readonly string[],
): Outcome<Task> {
  const { resource } = context;
  if (intent.filter !== undefined) {
    const filter = validateFilter(resource, intent.filter, ['filter']);
    if (!filter.ok) return filter;
  }
  const searchFields =
    intent.search?.fields ??
    resource.entity.fields.filter((field) => field.type.value === 'text').map((field) => field.id);
  const search =
    intent.search === undefined ? undefined : validateFields(resource, searchFields, ['search', 'fields'], false);
  if (search !== undefined && !search.ok) return search;
  const query: QuerySpec = {
    ...baseQuery(resource, selected),
    ...(intent.filter === undefined ? {} : { where: intent.filter }),
    ...(intent.search === undefined || search === undefined
      ? {}
      : { search: { text: intent.search.text, fields: [search.value[0]!, ...search.value.slice(1)] } }),
    order: queryOrder(intent.sort),
    ...(intent.page === undefined ? {} : { page: intent.page }),
  };
  return {
    ok: true,
    value: queryTask(intent, resource, context.regionId, context.taskRevision, query, 'data.read', requested),
  };
}

function compileDetail(
  intent: Extract<ReadIntent, { readonly kind: 'detail' }>,
  context: IntentCompilerContext,
  requested: readonly string[],
  selected: readonly string[],
): Outcome<Task> {
  const identity = identityPredicate(context.resource, intent.identity, ['identity']);
  if (!identity.ok) return identity;
  const query = { ...baseQuery(context.resource, selected), where: identity.value, page: { size: 1 } };
  return {
    ok: true,
    value: queryTask(intent, context.resource, context.regionId, context.taskRevision, query, 'data.read', requested),
  };
}

function compareWhere(
  resource: ResourceDefinition,
  intent: Extract<ReadIntent, { readonly kind: 'compare' }>,
): Outcome<NonNullable<QuerySpec['where']>> {
  const predicates: NonNullable<QuerySpec['where']>[] = [];
  for (let index = 0; index < intent.identities.length; index += 1) {
    const predicate = identityPredicate(resource, intent.identities[index]!, ['identities', index]);
    if (!predicate.ok) return predicate;
    predicates.push(predicate.value);
  }
  const where: NonNullable<QuerySpec['where']> = predicates.length === 1 ? predicates[0]! : { op: 'or', predicates };
  return { ok: true, value: where };
}

function compileCompare(
  intent: Extract<ReadIntent, { readonly kind: 'compare' }>,
  context: IntentCompilerContext,
  requested: readonly string[],
  selected: readonly string[],
): Outcome<Task> {
  const where = compareWhere(context.resource, intent);
  if (!where.ok) return where;
  const query = { ...baseQuery(context.resource, selected), where: where.value };
  return {
    ok: true,
    value: queryTask(
      intent,
      context.resource,
      context.regionId,
      context.taskRevision,
      query,
      'data.compare',
      requested,
    ),
  };
}

function compileReadIntent(intent: ReadIntent, context: IntentCompilerContext): Outcome<Task> {
  const requested = validateFields(context.resource, intent.fields, ['fields'], false);
  if (!requested.ok) return requested;
  const selected = Object.freeze([...new Set([...context.resource.entity.identity, ...requested.value])]);
  switch (intent.kind) {
    case 'browse':
      return compileBrowse(intent, context, requested.value, selected);
    case 'detail':
      return compileDetail(intent, context, requested.value, selected);
    case 'compare':
      return compileCompare(intent, context, requested.value, selected);
  }
}

function compileStandard(intent: Exclude<Intent, { kind: 'custom' }>, context: IntentCompilerContext): Outcome<Task> {
  const resource = context.resource;
  if (!resource.intents.includes(intent.kind))
    return failure('intent.unsupported', intent.kind + ' is not enabled for ' + resource.id + '.', ['kind']);
  if (intent.preferredView !== undefined && !resource.presentation.allowedViews.includes(intent.preferredView))
    return failure('intent.unknown-view', 'View ' + intent.preferredView + ' is not allowed for ' + resource.id + '.', [
      'preferredView',
    ]);
  switch (intent.kind) {
    case 'create':
    case 'edit':
      return compileForm(intent, context);
    case 'analyze':
      return compileAnalyze(intent, context);
    default:
      return compileReadIntent(intent, context);
  }
}

function validatePreferredView(preferredView: string | undefined, resource: ResourceDefinition): Outcome<void> {
  if (preferredView === undefined || resource.presentation.allowedViews.includes(preferredView))
    return { ok: true, value: undefined };
  return failure('intent.unknown-view', `View ${preferredView} is not allowed for ${resource.id}.`, ['preferredView']);
}

function parseCustomInput(definition: CustomIntentDefinition, input: unknown): Outcome<unknown> {
  const parsed = definition.schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const diagnostics = parsed.error.issues.slice(0, 16).map(
    (issue) =>
      ({
        code: `intent.input.${issue.code}`,
        message: issue.message,
        path: ['input', ...issue.path.filter((part): part is string | number => typeof part !== 'symbol')],
        retryable: false,
      }) satisfies Diagnostic,
  );
  const first = diagnostics[0];
  if (first === undefined) return failure('intent.input.invalid', 'The custom intent input is invalid.', ['input']);
  return { ok: false, diagnostics: [first, ...diagnostics.slice(1)] };
}

function runCustomCompiler(
  definition: CustomIntentDefinition,
  input: unknown,
  context: IntentCompilerContext,
  options: CompileIntentOptions,
): Outcome<Task> {
  let outcome: Outcome<Task>;
  try {
    outcome = definition.compile(input, context);
  } catch {
    return failure('intent.compiler-failed', 'The registered custom intent compiler failed safely.', ['intent']);
  }
  if (!outcome.ok) return outcome;
  const task = parseTask(outcome.value);
  if (!task.ok) return task;
  const resource = options.resource;
  if (
    task.value.regionId !== options.regionId ||
    task.value.catalogRevision !== resource.catalog.revision ||
    task.value.functionRegistryDigest !== resource.catalog.functionRegistryDigest
  )
    return failure(
      'intent.compiler-stale',
      'The custom intent compiler returned a Task pinned to another runtime context.',
      ['intent'],
    );
  return task;
}

function compileCustomIntent(
  intent: Extract<Intent, { readonly kind: 'custom' }>,
  options: CompileIntentOptions,
  context: IntentCompilerContext,
): Outcome<Task> {
  const view = validatePreferredView(intent.preferredView, options.resource);
  if (!view.ok) return view;
  const definition = options.customIntents?.resolve(intent.intent);
  if (definition === undefined)
    return failure(
      'intent.unknown-custom',
      `Custom intent ${intent.intent.id}@${intent.intent.revision} is not registered.`,
      ['intent'],
    );
  const input = parseCustomInput(definition, intent.input);
  if (!input.ok) return input;
  return runCustomCompiler(definition, input.value, context, options);
}

export function compileIntent(input: unknown, options: CompileIntentOptions): Outcome<Task> {
  const parsed = parseIntent(input);
  if (!parsed.ok) return parsed;
  const intent = parsed.value;
  if (intent.resource !== options.resource.id)
    return failure('intent.unknown-resource', `Intent targets ${intent.resource}, not ${options.resource.id}.`, [
      'resource',
    ]);
  const context: IntentCompilerContext = {
    resource: options.resource,
    regionId: options.regionId,
    taskRevision: options.taskRevision ?? '1',
  };
  if (intent.kind === 'custom') return compileCustomIntent(intent, options, context);
  return compileStandard(intent, context);
}

export function combineIntentFilter(left: QuerySpec['where'], right: QuerySpec['where']): QuerySpec['where'] {
  return mergeFilter(left, right);
}
