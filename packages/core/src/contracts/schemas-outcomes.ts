import * as z from 'zod/mini';
import { WIRE_LIMITS as L } from './limits.js';
import { array, count, label, nonEmpty, nonnegative, object, optional, positiveCount, text } from './schema-kit.js';
import {
  canonicalIds as ids,
  canonicalRecord as record,
  canonicalRefs as refs,
  canonicalVersion as version,
} from './schema-primitives.js';
import {
  fieldSchema,
  idSchema,
  jsonSchema,
  periodSchema,
  predicateSchema,
  resultRefSchema,
  revisionSchema,
  valueSchema,
  versionRefSchema,
} from './schemas-base.js';

export const uncertaintySchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('quantified'), lower: z.number(), upper: z.number(), interpretation: label }),
  object({ kind: z.literal('unquantified'), reason: label }),
]);
export const populationCountSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('unknown') }),
  object({ kind: z.literal('exact'), value: count, populationDigest: idSchema }),
  object({
    kind: z.literal('estimated'),
    value: nonnegative,
    populationDigest: idSchema,
    method: label,
    uncertainty: uncertaintySchema,
  }),
]);
export const precisionSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('exact') }),
  object({ kind: z.literal('approximate'), method: label, uncertainty: uncertaintySchema }),
]);
export const coverageSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('complete'), populationDigest: idSchema }),
  object({ kind: z.literal('partial'), populationDigest: idSchema, reason: label }),
  object({ kind: z.literal('sample'), populationDigest: idSchema, method: label }),
  object({ kind: z.literal('unknown'), reason: label }),
]);
export const consistencySchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('snapshot'), snapshotId: idSchema, sourceRevisions: record(revisionSchema) }),
  object({ kind: z.literal('mixed'), sourceLineage: idSchema, sourceRevisions: record(revisionSchema), reason: label }),
  object({ kind: z.literal('unknown'), reason: label }),
]);
export const evidenceSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('observed'), source: versionRefSchema }),
  object({ kind: z.literal('computed'), queryDigest: idSchema, definitions: refs }),
  object({ kind: z.literal('inferred'), recipe: versionRefSchema, method: label, uncertainty: uncertaintySchema }),
]);
export const diagnosticSchema = object({
  code: idSchema,
  message: label,
  path: optional(array(z.union([text, count]), L.depth)),
  remedies: optional(array(label, L.diagnostics)),
  retryable: z.boolean(),
});
export const resultSchema = object({
  version,
  ref: resultRefSchema,
  taskId: idSchema,
  fields: array(fieldSchema),
  identity: ids,
  rowGrain: ids,
  counts: object({ loaded: count, population: populationCountSchema }),
  precision: precisionSchema,
  coverage: coverageSchema,
  consistency: consistencySchema,
  evidence: evidenceSchema,
  filters: array(predicateSchema),
  period: optional(periodSchema),
  warnings: array(diagnosticSchema, L.diagnostics),
  /** Trusted plan lineage proof when the descriptor has result inputs. */
  lineageDigest: optional(idSchema),
  lineage: array(object({ output: idSchema, inputs: array(resultRefSchema) })),
});
export const resultEventSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('descriptor'), descriptor: resultSchema }),
  object({ kind: z.literal('batch'), result: resultRefSchema, sequence: count, rows: array(record(valueSchema)) }),
  object({
    kind: z.literal('progress'),
    result: resultRefSchema,
    completed: count,
    total: optional(count),
    unit: z.enum(['rows', 'bytes', 'batches']),
  }),
  object({
    kind: z.literal('complete'),
    result: resultRefSchema,
    finalCoverage: coverageSchema,
    cursor: optional(text),
  }),
  object({ kind: z.literal('error'), requestId: idSchema, error: diagnosticSchema }),
]);
export const measurementSchema = z.discriminatedUnion('state', [
  object({ state: z.literal('unknown') }),
  object({ state: z.literal('known'), value: nonnegative }),
]);
export const environmentSchema = object({
  inlineSize: measurementSchema,
  blockSize: measurementSchema,
  textScale: measurementSchema,
  pointer: z.enum(['fine', 'coarse', 'mixed', 'unknown']),
  hover: z.enum(['available', 'unavailable', 'unknown']),
  keyboard: z.enum(['available', 'unknown']),
  locale: idSchema,
  direction: z.enum(['ltr', 'rtl']),
  reducedMotion: z.boolean(),
  forcedColors: z.boolean(),
});
export const experienceSchema = object({
  version,
  id: idSchema,
  revision: revisionSchema,
  mode: z.enum(['fixed', 'adaptive', 'composable']),
  agentAllowed: z.boolean(),
  allowedRepresentations: ids,
  allowedPatterns: ids,
  composition: object({
    allowWithoutPreset: z.boolean(),
    maxNodes: positiveCount.check(z.maximum(L.presentationNodes)),
    maxExpansions: positiveCount,
  }),
  requiredOperations: ids,
  tokenProfile: versionRefSchema,
  extensionAllowlist: refs,
  transitionPolicy: z.enum(['stable', 'explicit-only']),
});
export const commitPreconditionsSchema = object({
  scopeDigest: idSchema,
  policyRevision: revisionSchema,
  taskRevision: revisionSchema,
  regionRevision: revisionSchema,
  catalogRevision: revisionSchema,
  experienceRevision: revisionSchema,
  functionRegistryDigest: idSchema,
  results: array(resultRefSchema),
});
export const presentationNodeSchema = object({
  id: idSchema,
  role: idSchema,
  representation: versionRefSchema,
  result: optional(resultRefSchema),
  config: object({ schema: versionRefSchema, values: record(jsonSchema) }),
  children: ids,
});
export const interactionLinkSchema = object({
  id: idSchema,
  source: object({ node: idSchema, port: idSchema }),
  target: object({ node: idSchema, port: idSchema }),
  mapping: versionRefSchema,
  propagation: z.enum(['directed', 'identity-equivalence']),
});
export const presentationCoverageSchema = object({
  needId: idSchema,
  nodeIds: nonEmpty(idSchema),
  operations: nonEmpty(versionRefSchema),
});
export const presentationStateTransferSchema = object({
  fromNode: idSchema,
  toNode: idSchema,
  mapping: versionRefSchema,
});
export const presentationPlanSchema = object({
  id: idSchema,
  revision: revisionSchema,
  rootId: idSchema,
  preconditions: commitPreconditionsSchema,
  nodes: array(presentationNodeSchema, L.presentationNodes),
  links: array(interactionLinkSchema, L.links),
  coverage: array(presentationCoverageSchema),
  stateTransfer: array(presentationStateTransferSchema),
  diagnostics: array(diagnosticSchema, L.diagnostics),
});
export const selectionSchema = z.discriminatedUnion('mode', [
  object({ mode: z.literal('clear') }),
  object({ mode: z.literal('ids'), entity: idSchema, keys: nonEmpty(text), result: resultRefSchema }),
  object({
    mode: z.literal('predicate'),
    entity: idSchema,
    predicate: predicateSchema,
    queryDigest: idSchema,
    populationDigest: idSchema,
  }),
]);
const retainedInteractionPayloads = [
  object({ kind: z.literal('selection'), selection: selectionSchema }),
  object({ kind: z.literal('filter'), predicates: array(predicateSchema), outputId: idSchema }),
  object({ kind: z.literal('range'), field: idSchema, range: z.nullable(periodSchema), outputId: idSchema }),
  object({ kind: z.literal('group'), field: idSchema, value: valueSchema, outputId: idSchema }),
  object({ kind: z.literal('page'), outputId: idSchema, cursor: text, queryDigest: idSchema }),
] as const;
export const retainedInteractionPayloadSchema = z.discriminatedUnion('kind', retainedInteractionPayloads);
export const interactionPayloadSchema = z.discriminatedUnion('kind', [
  ...retainedInteractionPayloads,
  object({ kind: z.literal('navigate'), route: versionRefSchema, params: record(valueSchema) }),
  object({
    kind: z.literal('draft'),
    entity: idSchema,
    key: text,
    field: idSchema,
    value: valueSchema,
    entityRevision: revisionSchema,
  }),
  object({ kind: z.literal('action-request'), action: versionRefSchema, input: record(jsonSchema) }),
  object({ kind: z.literal('extension'), schema: versionRefSchema, value: jsonSchema }),
]);
export const interactionStateSchema = object({
  version,
  values: array(object({ nodeId: idSchema, portId: idSchema, payload: retainedInteractionPayloadSchema }), L.links),
  drafts: array(
    object({
      domain: idSchema,
      entity: idSchema,
      key: text,
      field: idSchema,
      value: valueSchema,
      entityRevision: revisionSchema,
      conflict: optional(object({ kind: z.literal('entity-stale'), entityRevision: revisionSchema })),
    }),
    L.presentationNodes,
  ),
});
export const interactionSchema = object({
  eventId: idSchema,
  causationId: idSchema,
  regionId: idSchema,
  regionRevision: revisionSchema,
  originNodeId: idSchema,
  payload: interactionPayloadSchema,
});
