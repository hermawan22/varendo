import * as z from 'zod/mini';
import { WIRE_LIMITS as L } from './limits.js';
import { array, count, label, nonEmpty, object, optional, positiveCount } from './schema-kit.js';
import { canonicalRecord as record, canonicalVersion as version } from './schema-primitives.js';
import {
  idSchema,
  meaningSchema,
  periodSchema,
  predicateSchema,
  resultRefSchema,
  semanticTypeSchema,
  taskSchema,
  valueSchema,
  versionRefSchema,
} from './schemas-base.js';
import { commitPreconditionsSchema, diagnosticSchema } from './schemas-outcomes.js';

export const taskProposalSchema = object({
  requestId: idSchema,
  targetRegionId: idSchema,
  effect: z.enum(['read', 'meaning-draft', 'meaning-activate', 'present', 'business-write']),
  preconditions: commitPreconditionsSchema,
  value: taskSchema,
});
export const meaningDraftSchema = z.extend(z.omit(meaningSchema, { authority: true, lifecycle: true }), {
  lifecycle: z.literal('draft'),
});
export const bindingOutcomeSchema = z.discriminatedUnion('state', [
  object({ state: z.literal('bound'), value: taskSchema, interpretation: label, assumptions: array(label) }),
  object({ state: z.literal('needs-choice'), choices: nonEmpty(object({ id: idSchema, label, consequence: label })) }),
  object({
    state: z.literal('needs-meaning'),
    concept: label,
    authoringRoutes: array(z.enum(['ai-assisted', 'manual'])),
  }),
  object({
    state: z.enum(['unsupported', 'denied', 'invalid', 'stale']),
    diagnostics: nonEmpty(diagnosticSchema, L.diagnostics),
  }),
]);
export const modelEvaluationSchema = z.discriminatedUnion('state', [
  object({ state: z.literal('untested'), reason: label }),
  object({
    state: z.literal('evaluated'),
    modelSnapshot: idSchema,
    recipeDigest: idSchema,
    corpusDigest: idSchema,
    trials: positiveCount,
    evidenceId: idSchema,
    scope: label,
    permittedGrantsChanged: z.literal(false),
  }),
]);
/** Independent host grants; no model label or preset implies another grant. */
export const operationGrantSchema = z.enum([
  'catalog.read',
  'result.inspect',
  'task.propose',
  'task.evaluate',
  'experience.propose',
  'experience.commit',
  'meaning.propose',
  'meaning.activate',
  'action.propose',
  'action.execute',
  'model.egress',
]);
/** Limits for proposal repair only. Query/egress/commit budgets belong to their effect authorities. */
export const agentLoopBudgetSchema = object({
  maxTurns: positiveCount.check(z.maximum(64)),
  maxRepairs: count.check(z.maximum(16)),
  maxMilliseconds: positiveCount.check(z.maximum(300_000)),
  maxProposalBytes: positiveCount.check(z.maximum(L.bytes)),
});
export const agentStopReasonSchema = z.enum([
  'complete',
  'cancelled',
  'turn-budget',
  'repair-budget',
  'time-budget',
  'cost-budget',
  'query-budget',
  'byte-budget',
  'commit-budget',
  'no-progress',
  'denied',
  'unavailable',
  'stale',
  'needs-choice',
  'needs-meaning',
  'unsupported',
  'invalid',
]);
/** An exact cell, not prose entailment. The runtime resolves its authorized rows independently. */
export const narrativeCellSchema = object({
  result: resultRefSchema,
  field: idSchema,
  identity: record(valueSchema),
  type: semanticTypeSchema,
  definition: optional(versionRefSchema),
  populationDigest: idSchema,
  filters: array(predicateSchema),
  period: optional(periodSchema),
});
export const narrativeClaimSchema = z.discriminatedUnion('kind', [
  object({ version, id: idSchema, kind: z.literal('value'), cell: narrativeCellSchema, value: valueSchema }),
  object({
    version,
    id: idSchema,
    kind: z.literal('comparison'),
    left: narrativeCellSchema,
    right: narrativeCellSchema,
    relation: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']),
  }),
  // References permit inspection only. They never make this text a computed fact.
  object({
    version,
    id: idSchema,
    kind: z.enum(['inference', 'hypothesis']),
    text: label,
    references: array(resultRefSchema),
  }),
]);
