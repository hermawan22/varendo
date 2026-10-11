import { contractJsonSchema } from '@varendo/core';

type JsonObject = Record<string, unknown>;

/** Tool-facing help for each intent property; the wire contract itself stays unchanged. */
const PROPERTY_HELP: Readonly<Record<string, string>> = {
  version: 'Optional. The intent contract version; "1" is filled in when omitted.',
  id: 'Optional request ID; one is generated when omitted.',
  resource: 'A resource id from aeliqo_context.',
  kind: 'What to show. browse: records; detail: one record; compare: two or more records; analyze: numbers such as totals, trends, and breakdowns; create/edit: a registered form.',
  preferredView:
    'Optional hint from the resource views in aeliqo_context. Varendo still picks an eligible view that fits the answer and the space.',
  fields: 'Field ids to show, from aeliqo_context.',
  filter:
    'Optional structured filter on declared fields, e.g. {"op":"compare","field":"team","comparison":"eq","value":"Engineering"}.',
  search: 'Optional free-text search over the resource.',
  sort: 'Optional order, e.g. [{"field":"name","direction":"asc"}].',
  page: 'Optional page request for large results.',
  identity: 'Identity field values of one record, e.g. {"id":"ada"}.',
  identities: 'Two or more identity objects to compare side by side.',
  measures:
    'Measure ids from the resource meanings in aeliqo_context, e.g. [{"id":"hires"}]. revision is optional when the id has one revision.',
  dimensions: 'Fields with role "dimension" to group by, e.g. ["team"] for a per-team bar chart.',
  time: 'Group a measure by a time field for a trend, e.g. {"field":"joined","grain":"month"}. calendar and timezone default to the field policy; a week grain also needs weekStartsOn (0 Sunday to 6 Saturday).',
  period: 'Optional closed time window for the analysis.',
  limit: 'Optional maximum number of groups.',
};

const TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'year'];

export const RENDER_TOOL_DESCRIPTION = [
  'Show data in the paired Region by sending one intent. Varendo validates it against the registered resources and picks an allowed view: records become a table or cards, a measure over time becomes a trend, a measure per category becomes a bar chart.',
  'Call aeliqo_context first and use only the resource, field, meaning (measure), and view ids it returns; its examples are ready-to-send intents.',
  'Examples: list everyone {"kind":"browse","resource":"people"}; filter {"kind":"browse","resource":"people","filter":{"op":"compare","field":"team","comparison":"eq","value":"Design"}}; trend {"kind":"analyze","resource":"people","measures":[{"id":"hires"}],"time":{"field":"joined","grain":"month"}}; breakdown {"kind":"analyze","resource":"people","measures":[{"id":"hires"}],"dimensions":["team"]}.',
  '"renderer-ready" confirms the host showed the view. "plan-committed" confirms only that the plan committed; do not claim that it is visible. Other results are not success; follow their diagnostics and retry only when they identify a correctable input and authorization remains valid.',
].join(' ');

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutRequired(schema: unknown, names: readonly string[]): void {
  if (!isObject(schema) || !Array.isArray(schema.required)) return;
  schema.required = schema.required.filter((name) => !names.includes(String(name)));
}

function relaxMeasures(measures: unknown): void {
  if (!isObject(measures)) return;
  for (const item of Array.isArray(measures.prefixItems) ? measures.prefixItems : [])
    withoutRequired(item, ['revision']);
  withoutRequired(measures.items, ['revision']);
}

function describeBranch(branch: unknown): void {
  if (!isObject(branch) || !isObject(branch.properties)) return;
  withoutRequired(branch, ['version', 'id']);
  for (const [name, property] of Object.entries(branch.properties)) {
    const help = PROPERTY_HELP[name];
    if (help !== undefined && isObject(property)) property.description = help;
  }
  relaxMeasures(branch.properties.measures);
  const time = branch.properties.time;
  if (isObject(time) && isObject(time.properties)) {
    withoutRequired(time, ['calendar', 'timezone']);
    if (isObject(time.properties.grain)) time.properties.grain = { type: 'string', enum: TIME_GRAINS };
  }
}

/** The intent contract as an agent-friendly tool schema: documented, with generated defaults made optional. */
export function agentIntentSchema(): JsonObject {
  const schema = structuredClone(contractJsonSchema('intent')) as JsonObject;
  for (const branch of Array.isArray(schema.oneOf) ? schema.oneOf : []) describeBranch(branch);
  delete schema.$comment;
  return {
    ...schema,
    type: 'object',
    description: 'One Varendo intent. See the aeliqo_render description and aeliqo_context examples.',
  };
}
