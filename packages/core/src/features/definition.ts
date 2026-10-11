import type * as z from 'zod';
import type { Outcome, VersionRef } from '../contracts/types.js';
import type {
  FeatureCapabilityDefinition,
  FeatureIntentDefinition,
  FeatureIntentValue,
  FeatureViewDefinition,
  NonDataFeatureDefinition,
  NonDataFeatureInput,
} from './types.js';
import {
  assertCapabilityKind,
  assertDefinitionCount,
  assertReference,
  assertReferenceCount,
  failure,
  freezeOwned,
  frozenRef,
  referenceKey,
  throwFeature,
  validFeatureId,
} from './validation.js';

function capabilityDefinitions(values: readonly FeatureCapabilityDefinition[]): readonly FeatureCapabilityDefinition[] {
  assertDefinitionCount(values, 'capabilities');
  const keys = new Set<string>();
  return Object.freeze(
    values.map((value, index) => {
      assertReference(value.ref, ['capabilities', index, 'ref']);
      assertCapabilityKind(value.kind, ['capabilities', index, 'kind']);
      if (typeof value.schema?.safeParse !== 'function')
        throwFeature('feature.capability-schema', 'A capability requires a runtime schema.', [
          'capabilities',
          index,
          'schema',
        ]);
      const key = referenceKey(value.ref);
      if (keys.has(key))
        throwFeature('feature.capability-duplicate', `Capability ${key} is declared more than once.`, [
          'capabilities',
          index,
          'ref',
        ]);
      keys.add(key);
      return Object.freeze({ ref: frozenRef(value.ref), kind: value.kind, schema: value.schema });
    }),
  );
}

function checkedReferences(
  values: readonly VersionRef[] | undefined,
  available: ReadonlySet<string>,
  kind: 'capability' | 'view',
  path: readonly (string | number)[],
): readonly VersionRef[] {
  const refs = values ?? [];
  assertReferenceCount(refs, path);
  const seen = new Set<string>();
  return Object.freeze(
    refs.map((ref, index) => {
      assertReference(ref, [...path, index]);
      const key = referenceKey(ref);
      if (seen.has(key))
        throwFeature(`feature.${kind}-duplicate`, `${kind} reference ${key} is duplicated.`, [...path, index]);
      if (!available.has(key))
        throwFeature(`feature.${kind}-reference`, `${kind} reference ${key} is not declared by this feature.`, [
          ...path,
          index,
        ]);
      seen.add(key);
      return frozenRef(ref);
    }),
  );
}

function viewDefinitions(
  values: readonly FeatureViewDefinition[] | undefined,
  capabilities: ReadonlySet<string>,
): readonly FeatureViewDefinition[] {
  const views = values ?? [];
  assertReferenceCount(views, ['views']);
  const keys = new Set<string>();
  return Object.freeze(
    views.map((view, index) => {
      assertReference(view.ref, ['views', index, 'ref']);
      const key = referenceKey(view.ref);
      if (keys.has(key))
        throwFeature('feature.view-duplicate', `View ${key} is declared more than once.`, ['views', index, 'ref']);
      keys.add(key);
      return Object.freeze({
        ref: frozenRef(view.ref),
        capabilities: checkedReferences(view.capabilities, capabilities, 'capability', [
          'views',
          index,
          'capabilities',
        ]),
      });
    }),
  );
}

function intentDefinitions<Definitions extends readonly FeatureIntentDefinition[]>(
  values: Definitions,
  capabilities: ReadonlySet<string>,
  views: ReadonlySet<string>,
): Definitions {
  assertDefinitionCount(values, 'intents');
  const keys = new Set<string>();
  const normalized = values.map((intent, index) => {
    assertReference(intent.ref, ['intents', index, 'ref']);
    if (typeof intent.schema?.safeParse !== 'function')
      throwFeature('feature.intent-schema', 'An intent requires a runtime schema.', ['intents', index, 'schema']);
    const key = referenceKey(intent.ref);
    if (keys.has(key))
      throwFeature('feature.intent-duplicate', `Intent ${key} is declared more than once.`, ['intents', index, 'ref']);
    keys.add(key);
    return Object.freeze({
      ref: frozenRef(intent.ref),
      schema: intent.schema,
      capabilities: checkedReferences(intent.capabilities, capabilities, 'capability', [
        'intents',
        index,
        'capabilities',
      ]),
      ...(intent.views === undefined
        ? {}
        : { views: checkedReferences(intent.views, views, 'view', ['intents', index, 'views']) }),
    });
  });
  return Object.freeze(normalized) as unknown as Definitions;
}

function parseFeatureIntent<Definitions extends readonly FeatureIntentDefinition[]>(
  intents: Definitions,
  input: unknown,
): Outcome<FeatureIntentValue<Definitions>> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return failure('feature.intent', 'A feature intent must be an object.');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'intent' && key !== 'input'))
    return failure('feature.intent', 'A feature intent contains an unknown field.');
  if (!('intent' in record)) return failure('feature.intent', 'A feature intent reference is required.', ['intent']);
  try {
    assertReference(record.intent, ['intent']);
  } catch {
    return failure('feature.intent', 'A feature intent reference is invalid.', ['intent']);
  }
  const definition = intents.find(
    (candidate) => referenceKey(candidate.ref) === referenceKey(record.intent as VersionRef),
  );
  if (definition === undefined)
    return failure('feature.intent-reference', 'The intent is not declared by this feature.', ['intent']);
  let parsed: z.ZodSafeParseResult<unknown>;
  try {
    parsed = definition.schema.safeParse(record.input);
  } catch {
    return failure('feature.intent-input', 'The intent input schema failed safely.', ['input']);
  }
  if (!parsed.success)
    return failure('feature.intent-input', 'The intent input does not match its declared schema.', ['input']);
  return {
    ok: true,
    value: freezeOwned({ intent: frozenRef(definition.ref), input: parsed.data }) as FeatureIntentValue<Definitions>,
  };
}

/** Defines bounded non-relational capabilities without fabricating a Catalog or query source. */
export function defineFeature<const Definitions extends readonly FeatureIntentDefinition[]>(
  input: NonDataFeatureInput<Definitions>,
): NonDataFeatureDefinition<Definitions> {
  if (!validFeatureId(input.id)) throwFeature('feature.id', 'Feature ID must be a bounded identifier.', ['id']);
  const label = input.label ?? input.id;
  if (label.trim().length === 0 || label.length > 240)
    throwFeature('feature.label', 'Feature label must be bounded and non-empty.', ['label']);
  const revision = input.revision ?? '1';
  if (!validFeatureId(revision)) throwFeature('feature.revision', 'Feature revision must be bounded.', ['revision']);
  const capabilities = capabilityDefinitions(input.capabilities);
  const capabilityKeys = new Set(capabilities.map((capability) => referenceKey(capability.ref)));
  const views = viewDefinitions(input.views, capabilityKeys);
  const viewKeys = new Set(views.map((view) => referenceKey(view.ref)));
  const intents = intentDefinitions(input.intents, capabilityKeys, viewKeys);
  return Object.freeze({
    kind: 'feature' as const,
    id: input.id,
    label,
    definitionRevision: revision,
    capabilities,
    intents,
    views,
    parseIntent: (value: unknown) => parseFeatureIntent(intents, value),
  });
}
