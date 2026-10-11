import * as z from 'zod/mini';
import { WIRE_LIMITS as L } from './limits.js';
import { array, count, label, nonEmpty, object, optional, positiveCount, text } from './schema-kit.js';
import {
  canonicalIdSchema as idSchema,
  canonicalIds as ids,
  canonicalRecord as record,
  canonicalRefs as refs,
  canonicalRevisionSchema as revisionSchema,
  canonicalVersion as version,
  canonicalVersionRefSchema as versionRefSchema,
} from './schema-primitives.js';

export {
  canonicalIdSchema as idSchema,
  canonicalRevisionSchema as revisionSchema,
  canonicalVersionRefSchema as versionRefSchema,
} from './schema-primitives.js';
const decimal = object({ decimal: z.string().check(z.maxLength(512), z.regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)) });
export const valueSchema = z.union([z.null(), z.boolean(), z.number(), text, decimal]);
export const jsonSchema = z.json();
export const semanticTypeSchema = object({
  value: z.enum(['text', 'boolean', 'integer', 'float', 'decimal', 'date', 'instant']),
  nullable: z.boolean(),
  unit: optional(object({ dimension: idSchema, symbol: label, currency: optional(idSchema) })),
  grain: optional(ids),
  temporal: optional(object({ calendar: idSchema, timezone: optional(idSchema), grain: optional(idSchema) })),
});
export const fieldSchema = object({
  id: idSchema,
  label,
  type: semanticTypeSchema,
  role: z.enum(['identity', 'attribute', 'dimension', 'measure', 'time']),
  derivation: optional(versionRefSchema),
});
export const relationshipSchema = object({
  id: idSchema,
  sourceEntity: idSchema,
  targetEntity: idSchema,
  keys: nonEmpty(object({ sourceField: idSchema, targetField: idSchema })),
  cardinality: z.enum(['one-to-one', 'many-to-one', 'one-to-many', 'many-to-many']),
  optional: z.boolean(),
  joinPolicy: z.enum(['validated', 'explicit-bridge-required', 'not-queryable']),
  revision: revisionSchema,
});
export const expressionSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('literal'), value: valueSchema, type: semanticTypeSchema }),
  object({ kind: z.literal('field'), ref: idSchema, entity: optional(idSchema) }),
  object({ kind: z.literal('definition'), ref: versionRefSchema }),
  object({
    kind: z.literal('call'),
    function: versionRefSchema,
    get arguments() {
      return array(expressionSchema, L.arguments);
    },
  }),
]);
export const meaningSchema = object({
  id: idSchema,
  revision: revisionSchema,
  label,
  explanation: text,
  output: semanticTypeSchema,
  implementation: z.discriminatedUnion('kind', [
    object({ kind: z.literal('expression'), expression: expressionSchema }),
    object({ kind: z.literal('host-capability'), capability: versionRefSchema }),
  ]),
  dependencies: refs,
  functionRegistryDigest: idSchema,
  origin: z.enum(['system', 'manual', 'ai-assisted']),
  lifecycle: z.enum(['draft', 'active', 'deprecated']),
  scope: z.enum(['session', 'personal', 'workspace', 'organization']),
  authority: z.enum(['hypothesis', 'reviewed', 'approved']),
  aggregation: z.enum(['additive', 'semi-additive', 'non-additive', 'ratio-of-sums', 'none']),
  aggregationDimensions: ids,
  missingPolicy: z.enum(['propagate', 'exclude-pair', 'reject']),
  goal: optional(z.enum(['minimize', 'maximize'])),
});
export const catalogSchema = object({
  version,
  revision: revisionSchema,
  functionRegistryDigest: idSchema,
  entities: array(
    object({
      id: idSchema,
      label,
      identity: nonEmpty(idSchema),
      rowGrain: nonEmpty(idSchema),
      fields: array(fieldSchema),
    }),
  ),
  relationships: array(relationshipSchema),
  meanings: array(meaningSchema),
  capabilities: array(
    object({
      ref: versionRefSchema,
      entity: idSchema,
      operators: refs,
      fields: ids,
      relations: refs,
      metrics: optional(refs),
      pagination: optional(
        object({
          mode: z.enum(['snapshot', 'keyset']),
          stableOrder: array(
            object({
              field: idSchema,
              direction: z.enum(['asc', 'desc']),
              nulls: z.enum(['first', 'last']),
            }),
          ),
          identity: ids,
        }),
      ),
      maxOutputRows: positiveCount,
    }),
  ),
  nextCursor: optional(text),
});
export const periodSchema = object({
  from: z.iso.datetime({ offset: true }),
  toExclusive: z.iso.datetime({ offset: true }),
  calendar: idSchema,
  timezone: idSchema,
  interpretation: label,
});
export const predicateSchema = z.discriminatedUnion('op', [
  object({
    op: z.literal('compare'),
    field: idSchema,
    entity: optional(idSchema),
    comparison: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']),
    value: valueSchema,
  }),
  object({ op: z.literal('is-null'), field: idSchema, entity: optional(idSchema), negate: z.boolean() }),
  object({ op: z.literal('in'), field: idSchema, entity: optional(idSchema), values: array(valueSchema) }),
  object({
    op: z.enum(['and', 'or']),
    get predicates() {
      return array(predicateSchema);
    },
  }),
  object({
    op: z.literal('not'),
    get predicate() {
      return predicateSchema;
    },
  }),
]);
export const resultRefSchema = object({
  id: idSchema,
  revision: revisionSchema,
  /** Immutable source stream identity when the producer has one. */
  sourceLineage: optional(idSchema),
  outputId: idSchema,
  queryDigest: idSchema,
  scopeDigest: idSchema,
});
export const populationSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('all-authorized') }),
  object({
    kind: z.literal('fixed'),
    source: resultRefSchema,
    identityKeys: nonEmpty(idSchema),
    cohortDigest: idSchema,
  }),
  object({ kind: z.literal('live-output'), outputId: idSchema, identityKeys: nonEmpty(idSchema) }),
]);
export const querySchema = object({
  entity: idSchema,
  fields: ids,
  measures: refs,
  relations: refs,
  groupBy: ids,
  search: optional(object({ text: label, fields: nonEmpty(idSchema, 128) })),
  relationUsage: optional(
    array(
      object({ relation: versionRefSchema, kind: z.enum(['inner', 'left', 'semi']), where: optional(predicateSchema) }),
    ),
  ),
  windows: optional(
    array(
      object({
        id: idSchema,
        function: versionRefSchema,
        arguments: array(expressionSchema, L.arguments),
        partitionBy: array(expressionSchema),
        orderBy: array(
          object({
            expression: expressionSchema,
            direction: z.enum(['asc', 'desc']),
            nulls: z.enum(['first', 'last']),
          }),
        ),
        frame: object({ preceding: count.check(z.maximum(L.array)), following: count.check(z.maximum(L.array)) }),
      }),
    ),
  ),
  where: optional(predicateSchema),
  period: optional(periodSchema),
  timeBucket: optional(
    object({
      field: idSchema,
      grain: idSchema,
      calendar: optional(idSchema),
      timezone: optional(idSchema),
      weekStartsOn: optional(z.literal([0, 1, 2, 3, 4, 5, 6])),
    }),
  ),
  population: populationSchema,
  order: array(object({ field: idSchema, direction: z.enum(['asc', 'desc']), nulls: z.enum(['first', 'last']) })),
  topK: optional(positiveCount.check(z.maximum(L.array))),
  page: optional(object({ size: positiveCount.check(z.maximum(L.array)), cursor: optional(text) })),
});
const intentBase = {
  version,
  id: idSchema,
  resource: idSchema,
  preferredView: optional(idSchema),
};
const intentFields = optional(array(idSchema, 128));
const intentFilter = optional(predicateSchema);
const intentSort = optional(
  array(
    object({ field: idSchema, direction: z.enum(['asc', 'desc']), nulls: optional(z.enum(['first', 'last'])) }),
    128,
  ),
);
const intentIdentity = record(valueSchema);
export const intentSchema = z.discriminatedUnion('kind', [
  object({
    ...intentBase,
    kind: z.literal('browse'),
    fields: intentFields,
    filter: intentFilter,
    search: optional(object({ text: label, fields: optional(nonEmpty(idSchema, 128)) })),
    sort: intentSort,
    page: optional(object({ size: positiveCount.check(z.maximum(L.array)), cursor: optional(text) })),
  }),
  object({ ...intentBase, kind: z.literal('detail'), identity: intentIdentity, fields: intentFields }),
  object({ ...intentBase, kind: z.literal('create') }),
  object({ ...intentBase, kind: z.literal('edit'), identity: intentIdentity }),
  object({
    ...intentBase,
    kind: z.literal('compare'),
    identities: nonEmpty(intentIdentity, 128),
    fields: intentFields,
  }),
  object({
    ...intentBase,
    kind: z.literal('analyze'),
    dimensions: optional(array(idSchema, 128)),
    measures: nonEmpty(versionRefSchema, 128),
    filter: intentFilter,
    period: optional(periodSchema),
    time: optional(
      object({
        field: idSchema,
        grain: idSchema,
        calendar: optional(idSchema),
        timezone: optional(idSchema),
        weekStartsOn: optional(z.literal([0, 1, 2, 3, 4, 5, 6])),
      }),
    ),
    sort: intentSort,
    limit: optional(positiveCount.check(z.maximum(L.array))),
  }),
  object({ ...intentBase, kind: z.literal('custom'), intent: versionRefSchema, input: jsonSchema }),
]);
export const taskOutputSchema = z.discriminatedUnion('kind', [
  object({
    id: idSchema,
    kind: z.literal('query'),
    query: querySchema,
    dependsOn: ids,
    delivery: z.enum(['eager', 'on-demand']),
  }),
  object({ id: idSchema, kind: z.literal('reuse'), result: resultRefSchema, dependsOn: z.tuple([]) }),
]);
const taskBase = {
  version,
  id: idSchema,
  revision: revisionSchema,
  catalogRevision: revisionSchema,
  functionRegistryDigest: idSchema,
  regionId: idSchema,
  goal: label,
  needs: array(
    object({
      id: idSchema,
      operation: versionRefSchema,
      outputId: optional(idSchema),
      fields: ids,
      required: z.boolean(),
      simultaneousGroup: optional(idSchema),
    }),
  ),
  assumptions: array(label),
  viewPreference: optional(object({ representation: idSchema, strength: z.enum(['explicit', 'preferred']) })),
};
export const taskSchema = z.discriminatedUnion('kind', [
  object({ ...taskBase, kind: z.literal('data'), outputs: nonEmpty(taskOutputSchema, L.outputs) }),
  object({ ...taskBase, kind: z.literal('presentation'), inputs: array(resultRefSchema) }),
  object({
    ...taskBase,
    kind: z.literal('form'),
    schema: versionRefSchema,
    action: versionRefSchema,
    entityKey: optional(text),
  }),
]);
