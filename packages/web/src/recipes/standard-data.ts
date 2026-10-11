import type { Result } from '@varendo/core';
import type { PresentationValues } from '@varendo/core/presentation';
import type { RecipeContext } from './types.js';

type BarConfig = { readonly kind: 'available'; readonly values: PresentationValues } | { readonly kind: 'unavailable' };
type DataColumn = { readonly key: string; readonly label: string; readonly type?: string };

type ResultField = Result['fields'][number];

export function requestedFields(context: RecipeContext): ReadonlySet<string> {
  return new Set(context.task.needs.flatMap((need) => need.fields));
}

export function temporalField(field: ResultField): boolean {
  return field.type.value === 'date' || field.type.value === 'instant';
}

export function measureField(field: ResultField): boolean {
  return field.role === 'measure' && ['integer', 'float', 'decimal'].includes(field.type.value);
}

export function barConfig(context: RecipeContext): BarConfig {
  const result = context.result;
  if (result === undefined) return { kind: 'unavailable' };
  const requested = requestedFields(context);
  const fields = result.fields.filter((field) => requested.has(field.id));
  const authoredDimensions = new Set(context.intent.kind === 'analyze' ? (context.intent.dimensions ?? []) : []);
  const timeField = context.intent.kind === 'analyze' ? context.intent.time?.field : undefined;
  const dimensions = fields.filter(
    (field) =>
      field.role === 'dimension' &&
      field.id !== timeField &&
      (authoredDimensions.size === 0 || authoredDimensions.has(field.id)),
  );
  const measures = fields.filter(measureField);
  if (dimensions.length !== 1 || measures.length !== 1) return { kind: 'unavailable' };
  const dimension = dimensions[0]!;
  const measure = measures[0]!;
  return {
    kind: 'available',
    values: {
      visualization: {
        version: '1',
        view: 'bar',
        plot: {
          version: '1',
          root: {
            kind: 'unit',
            mark: 'bar',
            result: result.ref,
            missing: 'gap',
            encoding: {
              x: { field: dimension.id, scale: 'ordinal' },
              y: { field: measure.id, scale: 'linear', zero: true },
            },
          },
        },
      },
    },
  };
}

export function dataColumns(context: RecipeContext, typed: boolean): readonly DataColumn[] {
  if (context.result === undefined) return [];
  const requested = requestedFields(context);
  return context.result.fields
    .filter((field) => requested.has(field.id))
    .map((field) => ({ key: field.id, label: field.label, ...(typed ? { type: field.type.value } : {}) }));
}
