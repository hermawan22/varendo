import { readFileSync } from 'node:fs';
import { createQueryFunctionRegistry } from '../../../packages/core/src/expressions/registry.js';
import { createQueryPlanner } from '../../../packages/core/src/query/index.js';
import type { Catalog, Expression, FieldDefinition, SemanticType } from '../../../packages/core/src/contracts/types.js';
import type { QueryResult, QuerySource, RelationalQuery } from '../../../packages/core/src/query/types.js';

export type Employee = { readonly id: string; readonly name: string; readonly department: string };
export type Schedule = { readonly employee_id: string; readonly date: string };
export type Observation = {
  readonly id: string;
  readonly employee_id: string;
  readonly date: string;
  readonly status: 'present' | 'absent';
};
export type Leave = { readonly employee_id: string; readonly date: string; readonly approved: boolean };
export type HrRaw = {
  readonly synthetic: boolean;
  readonly policy: {
    readonly period: {
      readonly from: string;
      readonly toExclusive: string;
      readonly timezone: string;
      readonly calendar: string;
    };
  };
  readonly employees: readonly Employee[];
  readonly schedules: readonly Schedule[];
  readonly observations: readonly Observation[];
  readonly leave: readonly Leave[];
};
export type HrExpectedEmployee = {
  readonly employee_id: string;
  readonly department: string;
  readonly absent: number;
  readonly expected: number;
  readonly unknown: number;
  readonly rate: string | null;
};
export type HrExpectedDepartment = {
  readonly department: string;
  readonly absent: number;
  readonly expected: number;
  readonly unknown: number;
  readonly rate: string | null;
};
export type HrExpected = {
  readonly synthetic: boolean;
  readonly employees: readonly HrExpectedEmployee[];
  readonly topFive: readonly string[];
  readonly weekly: readonly unknown[];
  readonly departments: readonly HrExpectedDepartment[];
};
export type HrMutation = {
  readonly id: string;
  readonly removeObservation: { readonly employee_id: string; readonly date: string };
  readonly expected: {
    readonly sameAsBaseline?: boolean;
    readonly employee: HrExpectedEmployee;
    readonly topFive: readonly string[];
  };
};
export type HrBinding = {
  readonly source: string;
  readonly policy: {
    readonly calendar: string;
    readonly timezone: string;
    readonly from: string;
    readonly toExclusive: string;
  };
  readonly mutations: readonly HrMutation[];
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
export const raw = readJson<HrRaw>('../../../fixtures/hr/raw.json');
export const expected = readJson<HrExpected>('../../../fixtures/hr/expected.json');
export const binding = readJson<HrBinding>('../oracle/hr-binding.json');

const registryOutcome = createQueryFunctionRegistry({ version: '2' });
if (!registryOutcome.ok) throw new Error(JSON.stringify(registryOutcome.diagnostics));
export const registry = registryOutcome.value;

export const text = (nullable = false): SemanticType => ({ value: 'text', nullable });
export const bool = (nullable = false): SemanticType => ({ value: 'boolean', nullable });
export const integer = (nullable = false): SemanticType => ({ value: 'integer', nullable });
export const float = (nullable = false): SemanticType => ({ value: 'float', nullable });
export const date = (nullable = false): SemanticType => ({ value: 'date', nullable });
export const field = (entity: string, ref: string): Expression => ({ kind: 'field', entity, ref });
export const plainField = (ref: string): Expression => ({ kind: 'field', ref });
export const literal = (value: string | number | boolean | null, type: SemanticType): Expression => ({
  kind: 'literal',
  value,
  type,
});
export const version = (id: string) => ({ id, revision: '1' }) as const;
export const coreCall = (id: string, args: readonly Expression[]): Expression => ({
  kind: 'call',
  function: version(id),
  arguments: args,
});
export const aggregateCall = (id: string, args: readonly Expression[]): Expression => coreCall(id, args);
export const queryPins = { catalogRevision: 'hr-production-oracle-v2', functionRegistryDigest: registry.digest };

function entity(
  id: string,
  identity: readonly string[],
  fields: readonly { id: string; type: SemanticType; role: FieldDefinition['role'] }[],
): Catalog['entities'][number] {
  const first = identity[0];
  if (first === undefined) throw new Error(`Entity ${id} needs an identity.`);
  return {
    id,
    label: id,
    identity: [first, ...identity.slice(1)],
    rowGrain: [first, ...identity.slice(1)],
    fields: fields.map((item) => ({ ...item, label: item.id })),
  };
}

const relationship = (
  id: string,
  targetEntity: string,
  keys: readonly { sourceField: string; targetField: string }[],
  cardinality: 'many-to-one' = 'many-to-one',
) => {
  const first = keys[0];
  if (first === undefined) throw new Error(`Relationship ${id} needs a key.`);
  return {
    id,
    revision: '1',
    sourceEntity: 'schedules',
    targetEntity,
    keys: [first, ...keys.slice(1)] as [
      { sourceField: string; targetField: string },
      ...{ sourceField: string; targetField: string }[],
    ],
    cardinality,
    optional: true,
    joinPolicy: 'validated' as const,
  };
};

export const catalog: Catalog = {
  version: '1',
  revision: queryPins.catalogRevision,
  functionRegistryDigest: registry.digest,
  entities: [
    entity(
      'schedules',
      ['employee_id', 'date'],
      [
        { id: 'employee_id', type: text(), role: 'identity' },
        { id: 'date', type: date(), role: 'time' },
      ],
    ),
    entity(
      'observations',
      ['id'],
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'employee_id', type: text(), role: 'attribute' },
        { id: 'date', type: date(), role: 'time' },
        { id: 'status', type: text(), role: 'attribute' },
      ],
    ),
    entity(
      'leave',
      ['employee_id', 'date'],
      [
        { id: 'employee_id', type: text(), role: 'identity' },
        { id: 'date', type: date(), role: 'time' },
        { id: 'approved', type: bool(), role: 'attribute' },
      ],
    ),
    entity(
      'employees',
      ['id'],
      [
        { id: 'id', type: text(), role: 'identity' },
        { id: 'name', type: text(), role: 'attribute' },
        { id: 'department', type: text(), role: 'dimension' },
      ],
    ),
  ],
  relationships: [
    relationship('schedule-observation', 'observations', [
      { sourceField: 'employee_id', targetField: 'employee_id' },
      { sourceField: 'date', targetField: 'date' },
    ]),
    relationship('schedule-leave', 'leave', [
      { sourceField: 'employee_id', targetField: 'employee_id' },
      { sourceField: 'date', targetField: 'date' },
    ]),
    relationship('schedule-employee', 'employees', [{ sourceField: 'employee_id', targetField: 'id' }]),
  ],
  meanings: [],
  capabilities: [],
};

export function sourceFor(removeObservation?: { readonly employee_id: string; readonly date: string }): QuerySource {
  const observations =
    removeObservation === undefined
      ? raw.observations
      : raw.observations.filter(
          (observation) =>
            observation.employee_id !== removeObservation.employee_id || observation.date !== removeObservation.date,
        );
  return {
    revision:
      removeObservation === undefined
        ? 'hr-baseline'
        : `hr-mutation-${removeObservation.employee_id}-${removeObservation.date}`,
    catalogRevision: catalog.revision,
    relations: {
      schedules: { entity: 'schedules', complete: true, rows: raw.schedules },
      observations: { entity: 'observations', complete: true, rows: observations },
      leave: { entity: 'leave', complete: true, rows: raw.leave },
      employees: { entity: 'employees', complete: true, rows: raw.employees },
    },
  };
}

export type Predicate = NonNullable<RelationalQuery['filter']>;
export const leaveEligible: Predicate = {
  op: 'or',
  predicates: [
    { op: 'is-null', expression: field('leave', 'approved'), negate: false },
    { op: 'compare', left: field('leave', 'approved'), comparison: 'eq', right: literal(false, bool()) },
  ],
};
export const periodFilter: Predicate = {
  op: 'and',
  predicates: [
    leaveEligible,
    { op: 'compare', left: field('schedules', 'date'), comparison: 'gte', right: literal(binding.policy.from, date()) },
    {
      op: 'compare',
      left: field('schedules', 'date'),
      comparison: 'lt',
      right: literal(binding.policy.toExclusive, date()),
    },
  ],
};

export function baseJoins(): NonNullable<RelationalQuery['joins']> {
  return [
    {
      id: 'schedule-observation',
      rightEntity: 'observations',
      relationship: version('schedule-observation'),
      kind: 'left',
    },
    { id: 'schedule-leave', rightEntity: 'leave', relationship: version('schedule-leave'), kind: 'left' },
    { id: 'schedule-employee', rightEntity: 'employees', relationship: version('schedule-employee'), kind: 'left' },
  ];
}

export function execute(query: RelationalQuery, source: QuerySource = sourceFor()): QueryResult {
  const plannerOutcome = createQueryPlanner({
    catalog,
    registry,
    limits: {
      maxRows: 1_000,
      maxBytes: 2_000_000,
      maxJoinRows: 10_000,
      maxOperations: 100_000,
    },
  });
  if (!plannerOutcome.ok) throw new Error(JSON.stringify(plannerOutcome.diagnostics));
  const planned = plannerOutcome.value.plan(query);
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
  const evaluated = plannerOutcome.value.evaluate(planned.value, source);
  if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
  return evaluated.value;
}

export function plan(query: RelationalQuery) {
  const plannerOutcome = createQueryPlanner({
    catalog,
    registry,
    limits: {
      maxRows: 1_000,
      maxBytes: 2_000_000,
      maxJoinRows: 10_000,
      maxOperations: 100_000,
    },
  });
  if (!plannerOutcome.ok) throw new Error(JSON.stringify(plannerOutcome.diagnostics));
  return plannerOutcome.value.plan(query);
}
