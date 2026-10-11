import type { Catalog, Diagnostic, MeaningDefinition, Outcome, SemanticType } from '../contracts/types.js';
import type { ResourceMeasure } from './types.js';

type CatalogField = Catalog['entities'][number]['fields'][number];

const NUMERIC_TYPES: ReadonlySet<SemanticType['value']> = new Set(['integer', 'float', 'decimal']);

const AGGREGATION: Readonly<Record<ResourceMeasure['aggregate'], MeaningDefinition['aggregation']>> = {
  count: 'additive',
  'count-distinct': 'non-additive',
  sum: 'additive',
};

interface MeasureContext {
  readonly fields: readonly CatalogField[];
  readonly identity: string;
  readonly functionRegistryDigest: string;
  readonly reserved: ReadonlySet<string>;
}

function invalid(message: string, path: readonly (string | number)[]): Outcome<never> {
  const diagnostic: Diagnostic = { code: 'resource.measure', message, retryable: false, path: ['measures', ...path] };
  return { ok: false, diagnostics: [diagnostic] };
}

function measureField(id: string, measure: ResourceMeasure, context: MeasureContext): Outcome<CatalogField> {
  const fieldId = measure.field ?? (measure.aggregate === 'sum' ? undefined : context.identity);
  if (fieldId === undefined) return invalid(`Measure ${id} needs a numeric field to sum.`, [id, 'field']);
  const field = context.fields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return invalid(`Measure ${id} references unknown field ${fieldId}.`, [id, 'field']);
  if (measure.aggregate === 'sum' && !NUMERIC_TYPES.has(field.type.value))
    return invalid(`Measure ${id} can only sum a numeric field; ${fieldId} is ${field.type.value}.`, [id, 'field']);
  return { ok: true, value: field };
}

function semiAdditiveDimensions(id: string, measure: ResourceMeasure, context: MeasureContext): Outcome<string[]> {
  const dimensions = measure.semiAdditiveOver ?? [];
  if (dimensions.length === 0) return { ok: true, value: [] };
  if (measure.aggregate !== 'sum')
    return invalid(`Only a sum measure can be semi-additive; ${id} is ${measure.aggregate}.`, [id, 'semiAdditiveOver']);
  const index = dimensions.findIndex((dimension) => !context.fields.some((field) => field.id === dimension));
  if (index >= 0)
    return invalid(`Measure ${id} references unknown field ${dimensions[index]}.`, [id, 'semiAdditiveOver', index]);
  return { ok: true, value: [...dimensions] };
}

function outputType(measure: ResourceMeasure, field: CatalogField): SemanticType {
  if (measure.aggregate !== 'sum') return { value: 'integer', nullable: false };
  return { value: field.type.value, nullable: field.type.nullable };
}

function expandMeasure(id: string, measure: ResourceMeasure, context: MeasureContext): Outcome<MeaningDefinition> {
  if (id.length === 0 || id.length > 160 || /[\s\u0000-\u001f\u007f]/u.test(id))
    return invalid(`Measure ID ${id} must be a bounded identifier.`, [id]);
  if (context.reserved.has(id)) return invalid(`Measure ${id} duplicates a declared meaning.`, [id]);
  const field = measureField(id, measure, context);
  if (!field.ok) return field;
  const dimensions = semiAdditiveDimensions(id, measure, context);
  if (!dimensions.ok) return dimensions;
  return {
    ok: true,
    value: {
      id,
      revision: measure.revision ?? '1',
      label: measure.label,
      explanation: measure.explanation ?? measure.label,
      output: outputType(measure, field.value),
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: `core.aggregate.${measure.aggregate}`, revision: '1' },
          arguments: [{ kind: 'field', ref: field.value.id }],
        },
      },
      dependencies: [],
      functionRegistryDigest: context.functionRegistryDigest,
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: dimensions.value.length > 0 ? 'semi-additive' : AGGREGATION[measure.aggregate],
      aggregationDimensions: dimensions.value,
      missingPolicy: 'reject',
      ...(measure.goal === undefined ? {} : { goal: measure.goal }),
    },
  };
}

/** Expands application-authored measures into reviewed meanings; the host code is their review boundary. */
export function expandMeasures(
  measures: Readonly<Record<string, ResourceMeasure>> | undefined,
  context: MeasureContext,
): Outcome<MeaningDefinition[]> {
  const meanings: MeaningDefinition[] = [];
  for (const [id, measure] of Object.entries(measures ?? {})) {
    const meaning = expandMeasure(id, measure, context);
    if (!meaning.ok) return meaning;
    meanings.push(meaning.value);
  }
  return { ok: true, value: meanings };
}
