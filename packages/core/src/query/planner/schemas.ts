import type { Expression, FieldDefinition, SemanticType } from '../../contracts/types.js';
import type { FunctionRegistry } from '../../expressions/types.js';
import type {
  AggregateSpec,
  GroupKeySpec,
  JoinSpec,
  ProjectionSpec,
  QueryOutcome,
  QueryField,
  QuerySchema,
  TimeBucketSpec,
  WindowSpec,
} from '../types.js';
import { isAggregateOperation } from '../../expressions/standard-signatures.js';
import {
  BUCKET_GRAINS,
  failure,
  findField,
  relationKey,
  roleForType,
  safeId,
  safePositive,
  unsupported,
} from './shared.js';
import { resolveExpression, type ResolvedExpression } from './expressions.js';
import type { CatalogRelationship } from './shared.js';

function outputField(
  id: string,
  expression: ResolvedExpression,
  label: string | undefined,
  role: FieldDefinition['role'] | undefined,
): QueryField {
  return {
    id,
    label: label ?? expression.field?.label ?? id,
    type: expression.typed.type,
    role: role ?? expression.field?.role ?? roleForType(expression.typed.type),
    ...(expression.field?.source === undefined ? {} : { source: expression.field.source }),
  };
}

function projectedFieldId(input: QuerySchema, item: ProjectionSpec, fieldId: string): string | undefined {
  const field = item.expression.kind === 'field' ? findField(input, item.expression) : undefined;
  return field?.id === fieldId ? item.id : undefined;
}

function projectedIds(input: QuerySchema, items: readonly ProjectionSpec[], fieldIds: readonly string[]): string[] {
  return fieldIds
    .map((fieldId) => items.find((item) => projectedFieldId(input, item, fieldId))?.id)
    .filter((id): id is string => id !== undefined);
}

export function projectSchema(
  input: QuerySchema,
  items: readonly ProjectionSpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields: QueryField[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (!safeId(item.id) || ids.has(item.id))
      return failure('query.projection', 'Projection identifiers must be unique bounded identifiers.', ['select']);
    ids.add(item.id);
    const expression = resolveExpression(item.expression, input, registry);
    if (!expression.ok) return expression;
    fields.push(outputField(item.id, expression.value, item.label, item.role));
  }
  const identity = projectedIds(input, items, input.identity);
  const grain = projectedIds(input, items, input.grain);
  if (identity.length !== input.identity.length)
    return unsupported(
      'identity-projection',
      'Every input identity field must remain projected for stable result lineage.',
      ['Project all identity fields.'],
      ['select'],
    );
  return { ok: true, value: { fields, identity, grain } };
}

export function appendSchema(
  input: QuerySchema,
  items: readonly ProjectionSpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields = [...input.fields];
  const ids = new Set(fields.map((field) => field.id));
  for (const item of items) {
    if (!safeId(item.id) || ids.has(item.id))
      return failure('query.derive', 'Derived identifiers must be unique and must not shadow an input field.', [
        'derives',
      ]);
    ids.add(item.id);
    const expression = resolveExpression(item.expression, input, registry);
    if (!expression.ok) return expression;
    fields.push(outputField(item.id, expression.value, item.label, item.role));
  }
  return { ok: true, value: { fields, identity: input.identity, grain: input.grain } };
}

function validateTimeZone(timezone: string): QueryOutcome<void> {
  if (!safeId(timezone))
    return failure('query.temporal-policy', 'A bounded timezone identifier is required.', ['timeBuckets']);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return { ok: true, value: undefined };
  } catch {
    return unsupported(
      'temporal-policy',
      'The timezone identifier is not supported by this environment.',
      ['Use a supported timezone identifier.'],
      ['timeBuckets'],
    );
  }
}

function validateWeekStartRange(item: TimeBucketSpec): QueryOutcome<void> {
  if (
    item.weekStartsOn !== undefined &&
    (!Number.isInteger(item.weekStartsOn) || item.weekStartsOn < 0 || item.weekStartsOn > 6)
  )
    return failure('query.temporal-week-start', 'Week start must be an integer from zero through six.', [
      'timeBuckets',
    ]);
  return { ok: true, value: undefined };
}

function validateIsoWeekStart(item: TimeBucketSpec): QueryOutcome<void> {
  if (item.calendar === 'iso8601' && item.grain === 'week' && item.weekStartsOn !== 1)
    return unsupported(
      'temporal-week-start',
      'ISO8601 weeks start on Monday.',
      ['Set weekStartsOn to 1.'],
      ['timeBuckets'],
    );
  return { ok: true, value: undefined };
}

function supportedTimeGrain(item: TimeBucketSpec): QueryOutcome<void> {
  if (!BUCKET_GRAINS.has(item.grain))
    return unsupported(
      'temporal-grain',
      'The requested temporal grain is not in the bounded evaluator subset.',
      ['Use day, week, month, quarter or year.'],
      ['timeBuckets'],
    );
  return { ok: true, value: undefined };
}

function requiredWeekStart(item: TimeBucketSpec): QueryOutcome<void> {
  if (item.grain === 'week' && item.weekStartsOn === undefined)
    return unsupported(
      'temporal-week-start',
      'Weekly buckets require an explicit week start.',
      ['Set weekStartsOn to an ISO or locale-approved weekday.'],
      ['timeBuckets'],
    );
  return { ok: true, value: undefined };
}

function validateBucketPolicy(item: TimeBucketSpec): QueryOutcome<void> {
  if (item.calendar !== 'gregorian' && item.calendar !== 'iso8601')
    return unsupported(
      'temporal-policy',
      'The requested civil calendar is not supported.',
      ['Use Gregorian or ISO8601 civil dates.'],
      ['timeBuckets'],
    );
  const timezone = validateTimeZone(item.timezone);
  if (!timezone.ok) return timezone;
  const weekStart = validateWeekStartRange(item);
  if (!weekStart.ok) return weekStart;
  const isoStart = validateIsoWeekStart(item);
  if (!isoStart.ok) return isoStart;
  const grain = supportedTimeGrain(item);
  if (!grain.ok) return grain;
  return requiredWeekStart(item);
}

function validateBucketExpression(
  item: TimeBucketSpec,
  input: QuerySchema,
  registry: FunctionRegistry,
): QueryOutcome<ResolvedExpression> {
  const expression = resolveExpression(item.expression, input, registry);
  if (!expression.ok) return expression;
  const sourceType = expression.value.typed.type;
  if (sourceType.value !== 'date' && sourceType.value !== 'instant')
    return failure('query.temporal-type', 'Time buckets require a date or instant expression.', ['timeBuckets']);
  if (sourceType.value === 'instant' && (item.timezone !== 'UTC' || item.calendar !== 'gregorian'))
    return unsupported(
      'temporal-policy',
      'Instant conversion currently supports Gregorian UTC buckets only.',
      ['Use a host temporal adapter for other instant timezones.'],
      ['timeBuckets'],
    );
  if (
    sourceType.temporal !== undefined &&
    (sourceType.temporal.calendar !== item.calendar || sourceType.temporal.timezone !== item.timezone)
  )
    return failure('query.temporal-policy', 'The bucket policy conflicts with its source temporal semantics.', [
      'timeBuckets',
    ]);
  return expression;
}

function timeBucketField(item: TimeBucketSpec, input: QuerySchema, sourceType: SemanticType): QueryField {
  const type: SemanticType = {
    value: 'date',
    nullable: sourceType.nullable,
    grain: [...input.grain],
    temporal: { calendar: item.calendar, timezone: item.timezone, grain: item.grain },
  };
  return { id: item.id, label: item.label ?? item.id, type, role: 'dimension' };
}

export function timeBucketSchema(
  input: QuerySchema,
  items: readonly TimeBucketSpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields = [...input.fields];
  const ids = new Set(fields.map((field) => field.id));
  for (const item of items) {
    if (!safeId(item.id) || ids.has(item.id))
      return failure(
        'query.time-bucket',
        'Time bucket identifiers must be unique and must not shadow an input field.',
        ['timeBuckets'],
      );
    const policy = validateBucketPolicy(item);
    if (!policy.ok) return policy;
    const expression = validateBucketExpression(item, input, registry);
    if (!expression.ok) return expression;
    fields.push(timeBucketField(item, input, expression.value.typed.type));
    ids.add(item.id);
  }
  return { ok: true, value: { fields, identity: input.identity, grain: input.grain } };
}

function validateWindowFrame(item: WindowSpec, index: number): QueryOutcome<void> {
  if (!safePositive(item.frame.preceding) && item.frame.preceding !== 0)
    return failure('query.window-frame', 'Window preceding bound must be a nonnegative safe integer.', [
      'windows',
      index,
      'frame',
      'preceding',
    ]);
  if (!safePositive(item.frame.following) && item.frame.following !== 0)
    return failure('query.window-frame', 'Window following bound must be a nonnegative safe integer.', [
      'windows',
      index,
      'frame',
      'following',
    ]);
  if (item.function.id === 'core.window.lag' && item.frame.preceding < 1)
    return failure('query.window-frame', 'lag requires at least one preceding row.', [
      'windows',
      index,
      'frame',
      'preceding',
    ]);
  return { ok: true, value: undefined };
}

function validateWindowExpressions(
  item: WindowSpec,
  input: QuerySchema,
  registry: FunctionRegistry,
): QueryOutcome<void> {
  const expressions = [...item.partitionBy, ...item.orderBy.map((spec) => spec.expression), ...item.arguments];
  for (const expression of expressions) {
    const checked = resolveExpression(expression, input, registry, 'row');
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateWindowItem(
  item: WindowSpec,
  index: number,
  input: QuerySchema,
  registry: FunctionRegistry,
): QueryOutcome<ResolvedExpression> {
  const frame = validateWindowFrame(item, index);
  if (!frame.ok) return frame;
  const signature = registry.resolve(item.function);
  if (signature === undefined)
    return failure('query.function', `Window function ${relationKey(item.function)} is not registered.`, [
      'windows',
      index,
      'function',
    ]);
  if (!signature.contexts.includes('window'))
    return failure(
      'query.window-context',
      `Function ${relationKey(item.function)} is not registered for window evaluation.`,
      ['windows', index, 'function'],
    );
  const expressions = validateWindowExpressions(item, input, registry);
  if (!expressions.ok) return expressions;
  const call: Expression = { kind: 'call', function: item.function, arguments: item.arguments };
  return resolveExpression(call, input, registry, 'window');
}

export function windowSchema(
  input: QuerySchema,
  items: readonly WindowSpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields = [...input.fields];
  const ids = new Set(fields.map((field) => field.id));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!safeId(item.id) || ids.has(item.id))
      return failure('query.window', 'Window identifiers must be unique and must not shadow an input field.', [
        'windows',
        index,
      ]);
    const checked = validateWindowItem(item, index, input, registry);
    if (!checked.ok) return checked;
    fields.push(outputField(item.id, checked.value, item.label, roleForType(checked.value.typed.type)));
    ids.add(item.id);
  }
  return { ok: true, value: { fields, identity: input.identity, grain: input.grain } };
}

export function joinSchema(
  left: QuerySchema,
  right: QuerySchema,
  relationship: CatalogRelationship,
  kind: JoinSpec['kind'],
): QuerySchema {
  const rightFields =
    kind === 'left'
      ? right.fields.map((field) => ({ ...field, type: { ...field.type, nullable: true } }))
      : right.fields;
  const grain = relationship.cardinality === 'many-to-one' ? left.grain : [...left.grain, ...right.grain];
  return { fields: [...left.fields, ...rightFields], identity: [...left.identity, ...right.identity], grain };
}

export function groupSchema(
  input: QuerySchema,
  keys: readonly GroupKeySpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields: QueryField[] = [];
  const ids = new Set<string>();
  for (const key of keys) {
    if (!safeId(key.id) || ids.has(key.id))
      return failure('query.group', 'Group identifiers must be unique bounded identifiers.', ['groupBy']);
    ids.add(key.id);
    const expression = resolveExpression(key.expression, input, registry);
    if (!expression.ok) return expression;
    fields.push(outputField(key.id, expression.value, key.label, 'dimension'));
  }
  const grain = fields.map((field) => field.id);
  const output = fields.map((field) => ({ ...field, type: { ...field.type, grain } }));
  return { ok: true, value: { fields: output, identity: grain, grain } };
}

function containsAggregate(expression: Expression, registry: FunctionRegistry): boolean {
  if (expression.kind !== 'call') return false;
  const signature = registry.resolve(expression.function);
  if (signature === undefined) return false;
  if (isAggregateOperation(signature.operation)) return true;
  return expression.arguments.some((argument) => containsAggregate(argument, registry));
}

export function aggregateSchema(
  input: QuerySchema,
  groupOutput: QuerySchema,
  items: readonly AggregateSpec[],
  registry: FunctionRegistry,
): QueryOutcome<QuerySchema> {
  const fields = [...groupOutput.fields];
  const ids = new Set(fields.map((field) => field.id));
  for (const item of items) {
    if (!safeId(item.id) || ids.has(item.id))
      return failure('query.aggregate', 'Aggregate identifiers must be unique and must not shadow group keys.', [
        'aggregates',
      ]);
    const call: Expression = { kind: 'call', function: item.function, arguments: item.arguments };
    const checked = resolveExpression(call, input, registry, 'group');
    if (!checked.ok) return checked;
    const operation = checked.value.typed.operation;
    if (!isAggregateOperation(operation) && !containsAggregate(call, registry))
      return unsupported(
        'aggregate-function',
        `Function ${item.function.id}@${item.function.revision} is not an aggregate operation.`,
        ['Use an approved aggregate function.'],
        ['aggregates'],
      );
    const field = outputField(item.id, checked.value, item.label, 'measure');
    const meaningType = item.semantics?.output ?? field.type;
    fields.push({ ...field, type: { ...meaningType, grain: groupOutput.grain } });
    ids.add(item.id);
  }
  return { ok: true, value: { fields, identity: groupOutput.identity, grain: groupOutput.grain } };
}
