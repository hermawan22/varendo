import type { RuntimeResourceContext } from '@varendo/runtime/app';
import type { AgentJsonValue } from '../capabilities/types.js';
import { record } from './values.js';

type JsonObject = Record<string, AgentJsonValue>;

/**
 * Recommended system instructions for a model that drives Varendo tools. Hosts may append
 * product-specific guidance; the tool boundary enforces the rules either way.
 */
export const AELIQO_AGENT_INSTRUCTIONS = [
  'Call aeliqo_context first, then choose the resource whose label, fields, meanings, and views match the request.',
  'Start from the context examples and change only what the request needs: filter values, fields, measures, dimensions, or time grain.',
  'Use browse to list records, detail for one record, compare for two or more records, and analyze for totals, trends, and breakdowns.',
  'For analyze, use only measure ids from the resource meanings; add time for a trend or dimensions for a per-category breakdown.',
  'If the request needs a field, measure, or resource that the context does not list, say that it is not available instead of substituting other data.',
  'Never invent HTML, code, permissions, endpoints, or data. A renderer-ready result confirms the host showed the view; plan-committed confirms only that the plan committed, so do not claim that it is visible.',
].join(' ');

/** What each standard view is for, so an agent can explain or hint a view. */
const VIEW_PURPOSES: Readonly<Record<string, string>> = {
  table: 'Rows and columns; the fallback for any result.',
  cards: 'Records as cards on narrow containers.',
  list: 'A compact record list.',
  detail: 'One record with all its fields.',
  trend: 'A measure over time (analyze with time).',
  bar: 'A measure per category (analyze with dimensions).',
};

export const TIME_GRAINS = Object.freeze(['day', 'week', 'month', 'quarter', 'year']);

function field(context: RuntimeResourceContext, role: string) {
  return context.fields.find((item) => item.role === role);
}

/** Ready-to-send intents derived from the resource metadata; agents adapt them instead of guessing the shape. */
export function exampleIntents(context: RuntimeResourceContext): JsonObject[] {
  const resource = context.resource.id;
  const examples: JsonObject[] = [{ kind: 'browse', resource }];
  const dimension = field(context, 'dimension');
  const value = dimension?.values?.[0];
  if (dimension !== undefined && value !== undefined)
    examples.push({
      kind: 'browse',
      resource,
      filter: { op: 'compare', field: dimension.id, comparison: 'eq', value },
    });
  const measure = context.meanings[0];
  if (measure === undefined || !context.intents.includes('analyze')) return examples;
  const time = field(context, 'time');
  if (time !== undefined)
    examples.push({
      kind: 'analyze',
      resource,
      measures: [{ id: measure.id }],
      time: { field: time.id, grain: 'month' },
    });
  if (dimension !== undefined)
    examples.push({ kind: 'analyze', resource, measures: [{ id: measure.id }], dimensions: [dimension.id] });
  return examples;
}

export function viewGuide(views: readonly string[]): JsonObject {
  return Object.fromEntries(
    views.flatMap((view) => (VIEW_PURPOSES[view] === undefined ? [] : [[view, VIEW_PURPOSES[view]]])),
  );
}

function uniqueRevision(contexts: readonly RuntimeResourceContext[], resource: unknown, id: unknown) {
  const revisions = contexts
    .filter((context) => context.resource.id === resource)
    .flatMap((context) => context.meanings.filter((meaning) => meaning.id === id).map((meaning) => meaning.revision));
  return new Set(revisions).size === 1 ? revisions[0] : undefined;
}

function withRevision(measure: unknown, contexts: readonly RuntimeResourceContext[], resource: unknown): unknown {
  if (!record(measure) || measure.revision !== undefined) return measure;
  const revision = uniqueRevision(contexts, resource, measure.id);
  return revision === undefined ? measure : { ...measure, revision };
}

/** Fill the fields an agent may omit; everything else is left for the strict intent parser to judge. */
export function normalizeAgentIntent(
  input: unknown,
  contexts: readonly RuntimeResourceContext[],
  nextId: () => string,
): unknown {
  if (!record(input)) return input;
  const measures = Array.isArray(input.measures)
    ? input.measures.map((measure) => withRevision(measure, contexts, input.resource))
    : input.measures;
  return {
    ...input,
    version: input.version ?? '1',
    id: input.id ?? nextId(),
    ...(measures === undefined ? {} : { measures }),
  };
}

/** Distinguishes a malformed measure reference from an unknown declared meaning. */
export function measureShapeProblem(input: unknown): string | undefined {
  if (!record(input) || !Array.isArray(input.measures)) return undefined;
  const malformed = input.measures.find(
    (measure) =>
      !record(measure) ||
      typeof measure.id !== 'string' ||
      (measure.revision !== undefined && typeof measure.revision !== 'string'),
  );
  return malformed === undefined
    ? undefined
    : 'Each measures entry must be an object with an id, for example {"id":"hires"}; a string such as "hires" is not accepted.';
}

/** Names the first measure the resource does not declare, so the agent can correct it. */
export function unknownMeasure(input: unknown, contexts: readonly RuntimeResourceContext[]): string | undefined {
  if (!record(input) || !Array.isArray(input.measures)) return undefined;
  const matching = contexts.filter((context) => context.resource.id === input.resource);
  if (matching.length === 0) return undefined;
  const meanings = matching.flatMap((context) => context.meanings);
  const missing = input.measures.find(
    (measure) =>
      !record(measure) ||
      !meanings.some(
        (meaning) =>
          meaning.id === measure.id && (measure.revision === undefined || meaning.revision === measure.revision),
      ),
  );
  if (missing === undefined) return undefined;
  return record(missing)
    ? `${String(missing.id)}${missing.revision === undefined ? '' : `@${String(missing.revision)}`}`
    : JSON.stringify(missing);
}

/** Shows valid meanings when a requested measure cannot be resolved in this context. */
export function meaningHint(resource: unknown, contexts: readonly RuntimeResourceContext[]): string {
  const meanings = contexts
    .filter((context) => context.resource.id === resource)
    .flatMap((context) => context.meanings.map((meaning) => `${meaning.id}@${meaning.revision}`));
  return meanings.length === 0
    ? 'No meaning ids are available for this resource.'
    : `Valid meaning references: ${meanings.join(', ')}.`;
}
