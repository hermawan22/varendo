import * as z from 'zod/mini';
import {
  catalogSchema,
  diagnosticSchema,
  idSchema,
  querySchema,
  resultEventSchema,
  revisionSchema,
} from '@varendo/core/schema';
import {
  parseCatalog,
  parseQuery,
  parseResultEvent as parseCoreResultEvent,
  parseWireValue,
  WIRE_LIMITS,
} from '@varendo/core';
import type {
  CatalogRequest,
  CatalogPage,
  DataErrorPayload,
  PlanAcceptance,
  PlanRequest,
  AcceptedQuery,
  QueryBudget,
} from './types.js';
import type { Catalog, Diagnostic, Outcome, QuerySpec } from '@varendo/core';
import type { ResultEvent } from './types.js';

const strictObject = z.strictObject;
const text = z.string().check(z.maxLength(16_384));
const positive = z.int().check(z.minimum(1), z.maximum(Number.MAX_SAFE_INTEGER));
const budgetSchema = strictObject({
  maxRows: positive,
  maxBytes: positive,
  maxMessages: positive,
  maxMilliseconds: positive,
  maxColumns: positive,
});
const catalogTargetSchema = z.discriminatedUnion('kind', [
  strictObject({ kind: z.literal('catalog') }),
  strictObject({ kind: z.literal('entity'), entity: idSchema }),
]);
const planTargetSchema = strictObject({ taskId: idSchema, outputId: idSchema });
const catalogRequestSchema = strictObject({
  version: z.literal('1'),
  requestId: idSchema,
  catalogRevision: z.union([revisionSchema, z.null()]),
  target: catalogTargetSchema,
  budget: budgetSchema,
  pageSize: z.optional(positive),
  cursor: z.optional(text),
});
const catalogPageSchema = strictObject({
  version: z.literal('1'),
  requestId: idSchema,
  catalog: catalogSchema,
  catalogRevision: revisionSchema,
  sourceRevision: revisionSchema,
  scopeDigest: idSchema,
  target: catalogTargetSchema,
  effectiveBudget: budgetSchema,
  nextCursor: z.optional(text),
});
const planRequestSchema = strictObject({
  version: z.literal('1'),
  requestId: idSchema,
  catalogRevision: revisionSchema,
  target: planTargetSchema,
  query: querySchema,
  budget: budgetSchema,
});
const acceptedQuerySchema = strictObject({
  version: z.literal('1'),
  requestId: idSchema,
  target: planTargetSchema,
  catalogRevision: revisionSchema,
  sourceRevision: revisionSchema,
  /** Stable identity for one source lineage; revisions may advance within it. */
  sourceLineage: idSchema,
  scopeDigest: idSchema,
  queryDigest: idSchema,
  planDigest: idSchema,
  populationDigest: idSchema,
  lineageDigest: idSchema,
  resultShape: z.enum(['rows', 'global-aggregate']),
  expiresAt: positive,
  functionRegistryDigest: idSchema,
  policyRevision: z.optional(revisionSchema),
  query: querySchema,
  effectiveBudget: budgetSchema,
});
const planAcceptanceSchema = strictObject({
  kind: z.literal('accepted'),
  ...acceptedQuerySchema.shape,
  supported: z.array(text).check(z.maxLength(WIRE_LIMITS.array)),
});
const acceptedEnvelopeSchema = z.union([acceptedQuerySchema, planAcceptanceSchema]);
const dataErrorSchema = strictObject({
  version: z.literal('1'),
  requestId: idSchema,
  diagnostics: z.tuple([diagnosticSchema], diagnosticSchema).check(z.maxLength(WIRE_LIMITS.diagnostics)),
});

export type CatalogTargetWire = z.infer<typeof catalogTargetSchema>;
export type PlanTargetWire = z.infer<typeof planTargetSchema>;
export type QueryBudgetWire = z.infer<typeof budgetSchema>;
export type CatalogRequestWire = z.infer<typeof catalogRequestSchema>;
export type CatalogPageWire = z.infer<typeof catalogPageSchema>;
export type PlanRequestWire = z.infer<typeof planRequestSchema>;
export type AcceptedQueryWire = z.infer<typeof acceptedQuerySchema>;
export type PlanAcceptanceWire = z.infer<typeof planAcceptanceSchema>;
export type DataErrorPayloadWire = z.infer<typeof dataErrorSchema>;

function failure(code: string, message: string, path?: readonly (string | number)[]): Outcome<never> {
  const diagnostic: Diagnostic = {
    code,
    message,
    retryable: false,
    ...(path === undefined ? {} : { path: [...path] }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

function issuePath(issue: { readonly path: readonly PropertyKey[] }): (string | number)[] {
  return issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number');
}

function parseSchema<S extends z.ZodMiniType>(schema: S, input: unknown, name: string): Outcome<z.infer<S>> {
  const inspected = parseWireValue(input);
  if (!inspected.ok) return inspected;
  const parsed = z.safeParse(schema, inspected.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failure(
      `data.${name}.shape`,
      `The ${name} envelope is invalid.`,
      issue === undefined ? undefined : issuePath(issue),
    );
  }
  return { ok: true, value: parsed.data };
}

function parseNestedQuery(input: unknown, path: readonly (string | number)[]): Outcome<QuerySpec> {
  const parsed = parseQuery(input);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return failure(first?.code ?? 'data.query.shape', 'The query does not match the bounded query contract.', [
      ...path,
      ...(first?.path ?? []),
    ]);
  }
  return { ok: true, value: parsed.value };
}

function parseNestedCatalog(input: unknown, path: readonly (string | number)[]): Outcome<Catalog> {
  const parsed = parseCatalog(input);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return failure(first?.code ?? 'data.catalog.shape', 'The catalog does not match the bounded catalog contract.', [
      ...path,
      ...(first?.path ?? []),
    ]);
  }
  return { ok: true, value: parsed.value };
}

export function parseCatalogRequest(input: unknown): Outcome<CatalogRequest> {
  const parsed = parseSchema(catalogRequestSchema, input, 'catalog-request');
  if (!parsed.ok) return parsed;
  const { pageSize, cursor, ...required } = parsed.value;
  return {
    ok: true,
    value: {
      ...required,
      ...(pageSize === undefined ? {} : { pageSize }),
      ...(cursor === undefined ? {} : { cursor }),
    },
  };
}

export function parseCatalogPage(input: unknown): Outcome<CatalogPage> {
  const parsed = parseSchema(catalogPageSchema, input, 'catalog-page');
  if (!parsed.ok) return parsed;
  const catalog = parseNestedCatalog(parsed.value.catalog, ['catalog']);
  if (!catalog.ok) return catalog;
  const { nextCursor, ...required } = parsed.value;
  return {
    ok: true,
    value: { ...required, catalog: catalog.value, ...(nextCursor === undefined ? {} : { nextCursor }) },
  };
}

export function parsePlanRequest(input: unknown): Outcome<PlanRequest> {
  const parsed = parseSchema(planRequestSchema, input, 'plan-request');
  if (!parsed.ok) return parsed;
  const query = parseNestedQuery(parsed.value.query, ['query']);
  return query.ok ? { ok: true, value: { ...parsed.value, query: query.value } } : query;
}

export function parseAcceptedQuery(input: unknown): Outcome<AcceptedQuery> {
  const parsed = parseSchema(acceptedEnvelopeSchema, input, 'accepted-query');
  if (!parsed.ok) return parsed;
  const query = parseNestedQuery(parsed.value.query, ['query']);
  if (!query.ok) return query;
  const candidate =
    'kind' in parsed.value
      ? (() => {
          const { kind: _kind, supported: _supported, ...rest } = parsed.value;
          return rest;
        })()
      : parsed.value;
  const { policyRevision, ...required } = candidate;
  return {
    ok: true,
    value: {
      ...required,
      query: query.value,
      ...(policyRevision === undefined ? {} : { policyRevision }),
    },
  };
}

export function parsePlanAcceptance(input: unknown): Outcome<PlanAcceptance> {
  const parsed = parseSchema(planAcceptanceSchema, input, 'plan-acceptance');
  if (!parsed.ok) return parsed;
  const query = parseNestedQuery(parsed.value.query, ['query']);
  if (!query.ok) return query;
  const { policyRevision, ...required } = parsed.value;
  return {
    ok: true,
    value: {
      ...required,
      query: query.value,
      ...(policyRevision === undefined ? {} : { policyRevision }),
    },
  };
}

export function parseDataError(input: unknown): Outcome<DataErrorPayload> {
  const parsed = parseSchema(dataErrorSchema, input, 'error');
  if (!parsed.ok) return parsed;
  const diagnostics: Diagnostic[] = parsed.value.diagnostics.map((value) => {
    const { path, remedies, ...required } = value;
    return { ...required, ...(path === undefined ? {} : { path }), ...(remedies === undefined ? {} : { remedies }) };
  });
  return {
    ok: true,
    value: {
      version: parsed.value.version,
      requestId: parsed.value.requestId,
      diagnostics: diagnostics as [Diagnostic, ...Diagnostic[]],
    },
  };
}

export function parseResultEvent(input: unknown): Outcome<ResultEvent> {
  const parsed = parseCoreResultEvent(input);
  return parsed.ok
    ? parsed
    : failure('data.result-event.shape', 'The result event does not match the bounded result-event contract.');
}

export function parseJSON(input: string, _name: string): Outcome<unknown> {
  const parsed = parseWireValue(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

export function parseBudget(input: unknown): Outcome<QueryBudget> {
  return parseSchema(budgetSchema, input, 'budget');
}

export const ADC_SCHEMAS = Object.freeze({
  catalogRequestSchema,
  catalogPageSchema,
  planRequestSchema,
  acceptedQuerySchema,
  planAcceptanceSchema,
  dataErrorSchema,
  resultEventSchema,
});
