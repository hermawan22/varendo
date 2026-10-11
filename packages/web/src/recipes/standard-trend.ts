import type { Diagnostic } from '@varendo/core';
import type { PresentationValues } from '@varendo/core/presentation';
import { measureField, requestedFields, temporalField } from './standard-data.js';
import type { RecipeContext } from './types.js';

export type TrendConfig =
  | { readonly kind: 'available'; readonly values: PresentationValues }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'needs-input'; readonly diagnostic: Diagnostic };

function needsInput(code: string, message: string): TrendConfig {
  return { kind: 'needs-input', diagnostic: { code, message, retryable: false } };
}

export function trendConfig(context: RecipeContext): TrendConfig {
  const result = context.result;
  if (result === undefined) return { kind: 'unavailable' };
  const requested = requestedFields(context);
  const fields = result.fields.filter((field) => requested.has(field.id));
  const temporal = fields.filter(temporalField);
  const semanticTime = temporal.filter((field) => field.role === 'time');
  const timeCandidates = semanticTime.length > 0 ? semanticTime : temporal;
  if (timeCandidates.length === 0)
    return needsInput(
      'web.recipe.needs-input.time',
      'Choose one requested date or time field before rendering a trend.',
    );
  if (timeCandidates.length > 1)
    return needsInput('web.recipe.needs-input.time', 'Choose one requested time field before rendering a trend.');
  const measures = fields.filter(measureField);
  if (measures.length === 0)
    return needsInput(
      'web.recipe.needs-input.measure',
      'Choose one requested numeric measure before rendering a trend.',
    );
  if (measures.length > 1)
    return needsInput(
      'web.recipe.needs-input.measure',
      `Choose one requested measure before rendering a trend: ${measures.map((field) => field.label).join(', ')}.`,
    );
  const timeField = timeCandidates[0]!;
  const measure = measures[0]!;
  const seriesBy = fields
    .filter((field) => field.role === 'dimension' && field.id !== timeField.id && field.id !== measure.id)
    .map((field) => field.id);
  return { kind: 'available', values: { labelField: timeField.id, series: [{ field: measure.id }], seriesBy } };
}
