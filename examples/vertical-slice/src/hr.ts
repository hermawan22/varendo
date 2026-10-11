import rawText from '../../../fixtures/hr/raw.json?raw';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import type {
  Catalog,
  Expression,
  FieldDefinition,
  MeaningDefinition,
  QuerySpec,
  SemanticType,
  Task,
} from '@varendo/core';
import type { DataRecord, LocalSnapshot } from '@varendo/runtime/data';

interface RawHr {
  readonly synthetic: boolean;
  readonly policy: {
    readonly period: {
      readonly from: string;
      readonly toExclusive: string;
      readonly timezone: string;
      readonly calendar: string;
    };
  };
  readonly employees: readonly { readonly id: string; readonly name: string; readonly department: string }[];
  readonly schedules: readonly DataRecord[];
  readonly observations: readonly DataRecord[];
  readonly leave: readonly DataRecord[];
}
/** Bundled synthetic raw source. Local ADC validates every record against its catalog. */
export const raw: RawHr = JSON.parse(rawText) as RawHr;
const installed = createQueryFunctionRegistry({ version: '2' });
if (!installed.ok) throw new Error('The query function registry is unavailable.');
export const functionRegistry = installed.value;
/** This bundled source contains fewer than 1,000 records in total; keep evaluation bounded accordingly. */
export const sourceLimits = { rows: 1_000, bytes: 500_000 };
const ref = (id: string) => ({ id, revision: '1' });
const field = (entity: string, name: string): Expression => ({ kind: 'field', entity, ref: name });
const literal = (value: string | number | boolean | null, type: SemanticType['value']): Expression => ({
  kind: 'literal',
  value,
  type: { value: type, nullable: value === null },
});
const call = (id: string, ...args: readonly Expression[]): Expression => ({
  kind: 'call',
  function: ref(id),
  arguments: args,
});
const choose = (condition: Expression, yes: Expression, no: Expression) => call('core.if', condition, yes, no);
const sum = (expression: Expression) => call('core.aggregate.sum', expression);
const zero = literal(0, 'integer');
const one = literal(1, 'integer');
const equal = (left: Expression, right: Expression) => call('core.equal', left, right);
const labels: Readonly<Record<string, string>> = {
  employee_id: 'Employee',
  date: 'Date',
  id: 'Record',
  name: 'Name',
  department: 'Department',
  status: 'Observation',
  approved: 'Approved leave',
};
const entity = (
  id: string,
  identity: readonly [string, ...string[]],
  fields: readonly [string, SemanticType['value'], FieldDefinition['role'], boolean?][],
): Catalog['entities'][number] => ({
  id,
  label: id,
  identity,
  rowGrain: identity,
  fields: fields.map(([id, value, role, nullable = false]) => ({
    id,
    label: labels[id] ?? id,
    role,
    type: {
      value,
      nullable,
      ...(value === 'date'
        ? { temporal: { calendar: raw.policy.period.calendar, timezone: raw.policy.period.timezone, grain: 'day' } }
        : {}),
    },
  })),
});
function meaning(
  id: string,
  label: string,
  expression: Expression,
  value: SemanticType['value'],
  additive: boolean,
  nullable = true,
): MeaningDefinition {
  return {
    id,
    revision: '1',
    label,
    explanation:
      'Synthetic fixture policy: approved leave is excluded; any missing observation makes the rate unknown.',
    output: { value, nullable, grain: [] },
    implementation: { kind: 'expression', expression },
    dependencies: [],
    functionRegistryDigest: functionRegistry.digest,
    origin: 'system',
    lifecycle: 'active',
    scope: 'organization',
    authority: 'approved',
    aggregation: additive ? 'additive' : 'non-additive',
    aggregationDimensions: [],
    missingPolicy: 'propagate',
  };
}
const status = field('schedules', 'status');
const isUnknown = call('core.is-null', status);
const absent = sum(choose(isUnknown, zero, choose(equal(status, literal('absent', 'text')), one, zero)));
const unknown = sum(choose(isUnknown, one, zero));
const expected = call('core.aggregate.count', field('schedules', 'date'));
const rate = choose(equal(unknown, zero), call('core.divide.null', absent, expected), literal(null, 'float'));
const meanings = [
  meaning('absence.absent', 'Absent days', absent, 'integer', true),
  meaning('absence.expected', 'Expected days', expected, 'integer', true),
  meaning('absence.unknown', 'Unknown days', unknown, 'integer', true),
  meaning('absence.rate', 'Absence rate', rate, 'float', false),
];
const dateKeys = [
  { sourceField: 'employee_id', targetField: 'employee_id' },
  { sourceField: 'date', targetField: 'date' },
] as const;
const relationship = (id: string, targetEntity: string): Catalog['relationships'][number] => ({
  id,
  revision: '1',
  sourceEntity: 'schedules',
  targetEntity,
  keys: dateKeys,
  cardinality: 'one-to-one',
  optional: true,
  joinPolicy: 'validated',
});
const relationships: Catalog['relationships'] = [
  relationship('schedule-observation', 'observations'),
  relationship('schedule-leave', 'leave'),
  {
    id: 'schedule-employee',
    revision: '1',
    sourceEntity: 'schedules',
    targetEntity: 'employees',
    keys: [{ sourceField: 'employee_id', targetField: 'employee_id' }],
    cardinality: 'many-to-one',
    optional: false,
    joinPolicy: 'validated',
  },
];
export const catalog: Catalog = {
  version: '1',
  revision: 'hr-vertical-1',
  functionRegistryDigest: functionRegistry.digest,
  entities: [
    entity(
      'schedules',
      ['employee_id', 'date'],
      [
        ['employee_id', 'text', 'identity'],
        ['date', 'date', 'time'],
        ['status', 'text', 'attribute', true],
      ],
    ),
    entity(
      'observations',
      ['id'],
      [
        ['id', 'text', 'identity'],
        ['employee_id', 'text', 'attribute'],
        ['date', 'date', 'time'],
        ['status', 'text', 'attribute'],
      ],
    ),
    entity(
      'leave',
      ['employee_id', 'date'],
      [
        ['employee_id', 'text', 'identity'],
        ['date', 'date', 'time'],
        ['approved', 'boolean', 'attribute'],
      ],
    ),
    entity(
      'employees',
      ['employee_id'],
      [
        ['employee_id', 'text', 'identity'],
        ['name', 'text', 'attribute'],
        ['department', 'text', 'dimension'],
      ],
    ),
  ],
  relationships,
  meanings,
  capabilities: [],
};
export function snapshot(revision = 'hr-source-1', observations = raw.observations): LocalSnapshot {
  const statusByDate = new Map(
    observations.map((observation) => [`${observation.employee_id}:${observation.date}`, observation.status]),
  );
  return {
    catalog,
    sourceRevision: revision,
    records: {
      schedules: raw.schedules.map((schedule) => ({
        ...schedule,
        status: statusByDate.get(`${schedule.employee_id}:${schedule.date}`) ?? null,
      })),
      observations,
      leave: raw.leave,
      employees: raw.employees.map((employee) => ({
        employee_id: employee.id,
        name: employee.name,
        department: employee.department,
      })),
    },
  };
}
export const metricQuery = (): QuerySpec => ({
  entity: 'schedules',
  fields: ['employee_id'],
  measures: meanings.map((m) => ref(m.id)),
  relations: relationships.map((r) => ref(r.id)),
  relationUsage: relationships.map((r) => ({
    relation: ref(r.id),
    kind: r.id === 'schedule-employee' ? 'inner' : 'left',
  })),
  groupBy: ['employee_id'],
  population: { kind: 'all-authorized' },
  where: {
    op: 'and',
    predicates: [
      {
        op: 'or',
        predicates: [
          { op: 'is-null', entity: 'leave', field: 'approved', negate: false },
          { op: 'compare', entity: 'leave', field: 'approved', comparison: 'eq', value: false },
        ],
      },
      { op: 'compare', field: 'date', comparison: 'gte', value: raw.policy.period.from },
      { op: 'compare', field: 'date', comparison: 'lt', value: raw.policy.period.toExclusive },
    ],
  },
  order: [{ field: 'employee_id', direction: 'asc', nulls: 'last' }],
});
export const rankingQuery = (): QuerySpec => ({
  ...metricQuery(),
  topK: 5,
  order: [
    { field: 'absence.rate', direction: 'desc', nulls: 'last' },
    { field: 'employee_id', direction: 'asc', nulls: 'last' },
  ],
});
export const trendQuery = (): QuerySpec => ({
  ...metricQuery(),
  fields: ['employee_id', 'date'],
  groupBy: ['employee_id', 'date'],
  timeBucket: {
    field: 'date',
    grain: 'week',
    calendar: raw.policy.period.calendar,
    timezone: raw.policy.period.timezone,
    weekStartsOn: 1,
  },
  population: { kind: 'live-output', outputId: 'ranking', identityKeys: ['employee_id'] },
  order: [
    { field: 'date', direction: 'asc', nulls: 'last' },
    { field: 'employee_id', direction: 'asc', nulls: 'last' },
  ],
});
const detailQuery = (): QuerySpec => ({
  entity: 'observations',
  fields: ['id', 'employee_id', 'date', 'status'],
  measures: [],
  relations: [],
  groupBy: [],
  population: { kind: 'live-output', outputId: 'ranking', identityKeys: ['employee_id'] },
  where: {
    op: 'and',
    predicates: [
      { op: 'compare', field: 'date', comparison: 'gte', value: raw.policy.period.from },
      { op: 'compare', field: 'date', comparison: 'lt', value: raw.policy.period.toExclusive },
    ],
  },
  order: [
    { field: 'date', direction: 'asc', nulls: 'last' },
    { field: 'id', direction: 'asc', nulls: 'last' },
  ],
  page: { size: 25 },
});
export const initialTask = (): Extract<Task, { kind: 'data' }> => ({
  version: '1',
  id: 'hr-exploration',
  revision: '1',
  catalogRevision: catalog.revision,
  functionRegistryDigest: functionRegistry.digest,
  regionId: 'hr-region',
  goal: 'Rank the five highest absence rates and compare their weekly trends.',
  kind: 'data',
  assumptions: ['Synthetic records. Approved leave excluded. Unknown observations remain unknown.'],
  outputs: [
    { id: 'ranking', kind: 'query', query: rankingQuery(), dependsOn: [], delivery: 'eager' },
    { id: 'trend', kind: 'query', query: trendQuery(), dependsOn: ['ranking'], delivery: 'eager' },
    { id: 'detail', kind: 'query', query: detailQuery(), dependsOn: ['ranking'], delivery: 'on-demand' },
  ],
  viewPreference: { representation: 'data.trend', strength: 'preferred' },
  needs: [
    {
      id: 'ranking',
      outputId: 'ranking',
      operation: ref('interaction.selection'),
      fields: ['employee_id', 'absence.rate'],
      required: true,
      simultaneousGroup: 'ranking-trend',
    },
    {
      id: 'trend',
      outputId: 'trend',
      operation: ref('data.compare'),
      fields: ['employee_id', 'date', 'absence.rate'],
      required: true,
      simultaneousGroup: 'ranking-trend',
    },
  ],
});
