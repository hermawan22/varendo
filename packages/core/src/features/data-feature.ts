import type * as z from 'zod';
import { defineResource, ResourceDefinitionError } from '../app/index.js';
import { parseIntent } from '../contracts/parse.js';
import { DATA_FEATURE_VIEW_ALIASES, FeatureDefinitionError } from './types.js';
import type { DataFeatureDefinition, DataFeatureInput } from './types.js';
import { failure, freezeOwned, validFeatureId } from './validation.js';

function dataIntentParser<Schema extends z.ZodObject>(
  featureId: string,
  supported: DataFeatureDefinition<Schema>['resource']['intents'],
): DataFeatureDefinition<Schema>['parseIntent'] {
  return (input) => {
    const parsed = parseIntent(input);
    if (!parsed.ok) return parsed;
    if (parsed.value.resource !== featureId)
      return failure('feature.intent-resource', 'The intent targets a different feature.', ['resource']);
    if (parsed.value.kind !== 'custom' && !supported.includes(parsed.value.kind))
      return failure('feature.intent-unsupported', 'The data feature does not declare this intent.', ['kind']);
    return parsed;
  };
}

/** Defines reusable data metadata and lowers it through the existing ResourceDefinition path. */
export function defineDataFeature<Schema extends z.ZodObject>(
  input: DataFeatureInput<Schema>,
): DataFeatureDefinition<Schema> {
  if (!validFeatureId(input.id))
    throw new FeatureDefinitionError([
      {
        code: 'feature.id',
        message: 'Feature ID must be a bounded identifier without whitespace.',
        path: ['id'],
        retryable: false,
      },
    ]);
  const label = input.label ?? input.id;
  const revision = input.revision ?? '1';
  const presentation =
    input.presentation ?? Object.freeze({ allowedViews: Object.freeze([...DATA_FEATURE_VIEW_ALIASES]) });
  let resource;
  try {
    resource = defineResource({
      id: input.id,
      label,
      revision,
      identity: input.identity,
      schema: input.schema,
      ...(input.fields === undefined ? {} : { fields: input.fields }),
      ...(input.meanings === undefined ? {} : { meanings: input.meanings }),
      presentation,
    });
  } catch (error) {
    if (error instanceof ResourceDefinitionError) throw new FeatureDefinitionError(error.diagnostics);
    throw error;
  }
  freezeOwned(resource.catalog);
  freezeOwned(resource.entity);
  const identity = Object.freeze([...input.identity]) as readonly [string, ...string[]];
  return Object.freeze({
    kind: 'data' as const,
    id: resource.id,
    label: resource.label,
    definitionRevision: revision,
    schema: input.schema,
    identity,
    presentation: resource.presentation,
    resource,
    catalog: resource.catalog,
    entity: resource.entity,
    parseRecord: resource.parseRecord,
    parseIntent: dataIntentParser(resource.id, resource.intents),
  });
}
