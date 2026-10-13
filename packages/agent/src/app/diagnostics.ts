import type { Diagnostic, Intent } from '@varendo/core';
import type { RuntimeResourceContext } from '@varendo/runtime/app';
import type { AgentJsonValue } from '../capabilities/types.js';
import { record } from './values.js';

const MAX_HINT_VALUES = 24;

function atPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const part of path) {
    if (typeof part === 'string' && record(current)) current = current[part];
    else if (typeof part === 'number' && Array.isArray(current)) current = current[part];
    else return undefined;
  }
  return current;
}

function optionText(values: readonly unknown[]): string {
  const shown = values.slice(0, MAX_HINT_VALUES).map((value) => JSON.stringify(value) ?? String(value));
  const suffix =
    values.length > shown.length ? `, and ${values.length - shown.length} more; inspect varendo_context` : '';
  return shown.length === 0 ? 'none declared' : `${shown.join(', ')}${suffix}`;
}

function resourceContext(
  intent: Intent,
  contexts: readonly RuntimeResourceContext[],
): RuntimeResourceContext | undefined {
  return contexts.find((context) => context.resource.id === intent.resource);
}

function fieldOptions(
  context: RuntimeResourceContext,
  path: readonly (string | number)[],
  intent: Intent,
): readonly string[] {
  const first = path[0];
  const fields = context.fields;
  if (first === 'dimensions')
    return fields
      .filter(
        (field) =>
          field.role === 'dimension' ||
          (intent.kind === 'analyze' && intent.time !== undefined && field.role === 'time'),
      )
      .map((field) => field.id);
  if (first === 'time' || first === 'timeBucket')
    return fields
      .filter((field) => field.role === 'time' || field.type.value === 'date' || field.type.value === 'instant')
      .map((field) => field.id);
  if (first === 'search') return fields.filter((field) => field.type.value === 'text').map((field) => field.id);
  return fields.map((field) => field.id);
}

function filterField(intent: Intent, path: readonly (string | number)[]): string | undefined {
  for (let size = path.length; size > 0; size -= 1) {
    const candidate = atPath(intent, path.slice(0, size));
    if (record(candidate) && typeof candidate.field === 'string') return candidate.field;
  }
  return undefined;
}

function withMessage(diagnostic: Diagnostic, hint: string): Diagnostic {
  return { ...diagnostic, message: `${diagnostic.message} ${hint}` };
}

function fieldHint(diagnostic: Diagnostic, intent: Intent, context: RuntimeResourceContext): string | undefined {
  if (!['intent.unknown-field', 'intent.unknown-filter-field', 'query.field'].includes(diagnostic.code))
    return undefined;
  const path = diagnostic.path ?? [];
  return `Available fields here: ${optionText(fieldOptions(context, path, intent))}.`;
}

function filterValueHint(diagnostic: Diagnostic, intent: Intent, context: RuntimeResourceContext): string | undefined {
  if (diagnostic.code !== 'intent.unknown-filter-value') return undefined;
  const field = filterField(intent, diagnostic.path ?? []);
  const values = context.fields.find((candidate) => candidate.id === field)?.values;
  if (values === undefined) return undefined;
  return `Allowed values for ${field}: ${optionText(values)}.`;
}

function meaningHint(diagnostic: Diagnostic, context: RuntimeResourceContext): string | undefined {
  if (diagnostic.code !== 'intent.unknown-meaning') return undefined;
  const references = context.meanings.map((meaning) => `${meaning.id}@${meaning.revision}`);
  return `Valid meaning references: ${optionText(references)}.`;
}

function diagnosticHint(
  diagnostic: Diagnostic,
  intent: Intent,
  contexts: readonly RuntimeResourceContext[],
): string | undefined {
  const context = resourceContext(intent, contexts);
  if (context === undefined) {
    if (diagnostic.code !== 'intent.unknown-resource') return undefined;
    return `Available resources: ${optionText(contexts.map((item) => item.resource.id))}.`;
  }
  if (diagnostic.code === 'intent.unknown-view') return `Allowed views: ${optionText(context.views)}.`;
  if (diagnostic.code === 'intent.unsupported') return `Enabled intents: ${optionText(context.intents)}.`;
  if (
    diagnostic.message.includes('temporal-grain') ||
    (intent.kind === 'analyze' && intent.time !== undefined && diagnostic.path?.at(-1) === 'grain')
  )
    return 'Supported time grains: day, week, month, quarter, year.';
  return (
    fieldHint(diagnostic, intent, context) ??
    filterValueHint(diagnostic, intent, context) ??
    meaningHint(diagnostic, context)
  );
}

export function guideDiagnostic(
  diagnostic: Diagnostic,
  intent: Intent,
  contexts: readonly RuntimeResourceContext[],
): Diagnostic {
  const hint = diagnosticHint(diagnostic, intent, contexts);
  return hint === undefined ? diagnostic : withMessage(diagnostic, hint);
}

export function agentDiagnosticValue(diagnostic: Diagnostic): AgentJsonValue {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
    ...(diagnostic.path === undefined
      ? {}
      : { path: diagnostic.path.map((part) => (part === 'timeBucket' ? 'time' : part)) }),
    ...(diagnostic.remedies === undefined ? {} : { remedies: diagnostic.remedies }),
  };
}
