import { readFileSync } from 'node:fs';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';

const registered = createQueryFunctionRegistry({ version: '2' });
if (!registered.ok) throw new Error('Reference function registry is unavailable.');
export const registry = registered.value;
const ref = (id) => ({ id, revision: '1' });
const field = (entity, name) => ({ kind: 'field', entity, ref: name });
const literal = (value, type) => ({ kind: 'literal', value, type: { value: type, nullable: value === null } });
const call = (id, ...args) => ({ kind: 'call', function: ref(id), arguments: args });
const choose = (condition, yes, no) => call('core.if', condition, yes, no);
const sum = (expression) => call('core.aggregate.sum', expression);
const zero = literal(0, 'integer');
const one = literal(1, 'integer');
const isNull = (expression) => call('core.is-null', expression);
const equal = (left, right) => call('core.equal', left, right);
const entity = (id, identity, fields) => ({
  id,
  label: `Synthetic ${id}`,
  identity,
  rowGrain: identity,
  fields: fields.map(([id, value, role]) => ({ id, label: id, role, type: { value, nullable: false } })),
});
const meaning = (id, expression, value, { aggregation = 'additive', dimensions = [], nullable = true } = {}) => ({
  id,
  revision: '1',
  label: id,
  explanation: 'Reviewed synthetic reference policy; not a universal business definition.',
  output: { value, nullable, grain: [] },
  implementation: { kind: 'expression', expression },
  dependencies: [],
  functionRegistryDigest: registry.digest,
  origin: 'system',
  lifecycle: 'active',
  scope: 'organization',
  authority: 'approved',
  aggregation,
  aggregationDimensions: dimensions,
  missingPolicy: 'propagate',
});
export const budget = { maxRows: 100, maxBytes: 1_000_000, maxMessages: 16, maxMilliseconds: 10_000, maxColumns: 32 };

export function commerceFixture() {
  const total = meaning('sales.total', sum(field('orders', 'amount')), 'decimal', {
    dimensions: ['customer', 'placedAt'],
  });
  const catalog = {
    version: '1',
    revision: 'commerce-reference-1',
    functionRegistryDigest: registry.digest,
    entities: [
      entity(
        'orders',
        ['id'],
        [
          ['id', 'text', 'identity'],
          ['customer', 'text', 'dimension'],
          ['amount', 'decimal', 'measure'],
          ['placedAt', 'instant', 'time'],
        ],
      ),
    ],
    relationships: [],
    meanings: [total],
    capabilities: [],
  };
  const records = {
    orders: [
      { id: 'o1', customer: 'alpha', amount: { decimal: '10.01' }, placedAt: '2026-01-05T10:00:00Z' },
      { id: 'o2', customer: 'alpha', amount: { decimal: '10.02' }, placedAt: '2026-01-06T10:00:00Z' },
      { id: 'o3', customer: 'beta', amount: { decimal: '30.00' }, placedAt: '2026-01-06T11:00:00Z' },
    ],
  };
  const query = {
    entity: 'orders',
    fields: ['customer'],
    measures: [ref(total.id)],
    relations: [],
    groupBy: ['customer'],
    population: { kind: 'all-authorized' },
    order: [{ field: total.id, direction: 'desc', nulls: 'last' }],
  };
  return { snapshot: { catalog, records, sourceRevision: 'synthetic-commerce-1' }, query };
}

/** Copies raw source records only. All policy arithmetic executes in the SDK. */
function hrMeanings() {
  const status = field('observations', 'status');
  const absent = choose(isNull(status), zero, choose(equal(status, literal('absent', 'text')), one, zero));
  const unknown = choose(isNull(status), one, zero);
  const requiredCount = call('core.aggregate.count', field('schedules', 'date'));
  const absentCount = sum(absent);
  const unknownCount = sum(unknown);
  const rate = choose(
    equal(unknownCount, zero),
    call('core.divide.null', absentCount, requiredCount),
    literal(null, 'float'),
  );
  return [
    meaning('absence.absent', absentCount, 'integer', { dimensions: ['employee_id', 'date'] }),
    meaning('absence.expected', requiredCount, 'integer', { dimensions: ['employee_id', 'date'], nullable: false }),
    meaning('absence.unknown', unknownCount, 'integer', { dimensions: ['employee_id', 'date'] }),
    meaning('absence.rate', rate, 'float', { aggregation: 'non-additive' }),
  ];
}

function hrRelationships() {
  const keys = [
    { sourceField: 'employee_id', targetField: 'employee_id' },
    { sourceField: 'date', targetField: 'date' },
  ];
  const relation = (id, targetEntity) => ({
    id,
    revision: '1',
    sourceEntity: 'schedules',
    targetEntity,
    keys,
    cardinality: 'one-to-one',
    optional: true,
    joinPolicy: 'validated',
  });
  return [relation('schedule-observation', 'observations'), relation('schedule-leave', 'leave')];
}

function hrCatalog(meanings, relationships) {
  return {
    version: '1',
    revision: 'hr-reference-1',
    functionRegistryDigest: registry.digest,
    entities: [
      entity(
        'schedules',
        ['employee_id', 'date'],
        [
          ['employee_id', 'text', 'identity'],
          ['date', 'date', 'time'],
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
    ],
    relationships,
    meanings,
    capabilities: [],
  };
}

function hrRecords(raw, removeObservation) {
  return {
    schedules: raw.schedules,
    leave: raw.leave,
    observations:
      removeObservation === undefined
        ? raw.observations
        : raw.observations.filter(
            (row) => row.employee_id !== removeObservation.employee_id || row.date !== removeObservation.date,
          ),
  };
}

function hrQuery(raw, meanings, relationships) {
  return {
    entity: 'schedules',
    fields: ['employee_id'],
    measures: meanings.map((item) => ref(item.id)),
    relations: relationships.map((item) => ref(item.id)),
    relationUsage: relationships.map((item) => ({ relation: ref(item.id), kind: 'left' })),
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
  };
}

function hrSourceRevision(removeObservation) {
  if (removeObservation === undefined) return 'synthetic-hr-1';
  return `synthetic-hr-${removeObservation.employee_id}-${removeObservation.date}`;
}

export function hrFixture(removeObservation) {
  const raw = JSON.parse(readFileSync(new URL('../../fixtures/hr/raw.json', import.meta.url), 'utf8'));
  const meanings = hrMeanings();
  const relationships = hrRelationships();
  return {
    snapshot: {
      catalog: hrCatalog(meanings, relationships),
      records: hrRecords(raw, removeObservation),
      sourceRevision: hrSourceRevision(removeObservation),
    },
    query: hrQuery(raw, meanings, relationships),
  };
}
