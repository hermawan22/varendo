import * as z from 'zod';
import { parseCatalog } from '../contracts/parse.js';
import type { Catalog, Diagnostic, Outcome, SemanticType } from '../contracts/types.js';
import { createCatalogIndex } from '../semantics/catalog.js';
import { expandMeasures } from './measures.js';
import { STANDARD_INTENTS, ResourceDefinitionError } from './types.js';
import type {
  GeneratedResourceInput,
  ResourceDefinition,
  ResourceFieldMetadata,
  ResourceInput,
  ResourcePresentationDefaults,
  StandardIntentKind,
} from './types.js';

type Path = readonly (string | number)[];
type ZodRuntimeSchema = z.ZodType & {
  readonly type?: string;
  readonly format?: string | null;
  readonly isInt?: boolean;
  readonly values?: ReadonlySet<unknown>;
  readonly options?: readonly unknown[];
  unwrap?: () => z.ZodType;
};

function diagnostic(code: string, message: string, path: Path, remedies?: readonly string[]): Diagnostic {
  return { code, message, path, retryable: false, ...(remedies === undefined ? {} : { remedies }) };
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

const WRAPPER_SCHEMA_TYPES: ReadonlySet<string> = new Set(['default', 'prefault', 'readonly', 'catch']);
const SCALAR_VALUE_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

function unwrap(schema: ZodRuntimeSchema): {
  readonly schema: ZodRuntimeSchema;
  readonly nullable: boolean;
  readonly optional: boolean;
} {
  let current = schema;
  let nullable = false;
  let optional = false;
  const seen = new Set<z.ZodType>();
  while (!seen.has(current)) {
    seen.add(current);
    if (current.type === 'nullable') nullable = true;
    else if (current.type === 'optional') optional = true;
    else if (!WRAPPER_SCHEMA_TYPES.has(current.type ?? '')) break;
    const inner = current.unwrap?.();
    if (inner === undefined) break;
    current = inner;
  }
  return { schema: current, nullable, optional };
}

function inferType(schema: z.ZodType, path: Path): Outcome<SemanticType> {
  const unwrapped = unwrap(schema);
  if (unwrapped.optional) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'resource.optional-field',
          'Optional record fields cannot be represented as nullable values.',
          path,
          [
            'Use nullable() when null is valid, use default() when the field is always materialized, or project the source into a stable record shape.',
          ],
        ),
      ],
    };
  }
  const runtime = unwrapped.schema;
  const value = typeFromSchema(runtime);
  if (value === undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('resource.unsupported-schema', 'This field schema does not map to an Varendo scalar.', path, [
          'Project nested content into typed scalar fields or provide a dedicated typed binding outside the relational resource.',
        ]),
      ],
    };
  }
  const temporal = temporalFor(value);
  return { ok: true, value: { value, nullable: unwrapped.nullable, ...(temporal === undefined ? {} : { temporal }) } };
}

/** Reuses resource schema semantics for other core-owned bounded adapters. */
export function inferResourceFieldType(schema: z.ZodType): Outcome<SemanticType> {
  return inferType(schema, ['schema']);
}

function literalType(value: unknown): SemanticType['value'] | undefined {
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'string':
      return 'text';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'float';
    default:
      return undefined;
  }
}

const STRING_FORMAT_TYPES: Readonly<Record<string, SemanticType['value']>> = {
  date: 'date',
  datetime: 'instant',
};

function typeFromSchema(runtime: ZodRuntimeSchema): SemanticType['value'] | undefined {
  switch (runtime.type) {
    case 'string':
      return STRING_FORMAT_TYPES[runtime.format ?? ''] ?? 'text';
    case 'boolean':
      return 'boolean';
    case 'number':
      return runtime.isInt === true ? 'integer' : 'float';
    case 'enum':
      return 'text';
    case 'literal':
      return literalType(runtime.values?.values().next().value);
    default:
      return undefined;
  }
}

function temporalFor(value: SemanticType['value']): SemanticType['temporal'] | undefined {
  if (value === 'date') return { calendar: 'gregorian', timezone: 'UTC', grain: 'day' };
  if (value === 'instant') return { calendar: 'gregorian', timezone: 'UTC' };
  return undefined;
}

function inferredValues(schema: z.ZodType): readonly (string | number | boolean)[] | undefined {
  const runtime = unwrap(schema).schema;
  if (runtime.type !== 'enum' && runtime.type !== 'literal') return undefined;
  const values = [...(runtime.type === 'enum' ? (runtime.options ?? []) : (runtime.values ?? []))].filter(
    (value): value is string | number | boolean => SCALAR_VALUE_TYPES.has(typeof value),
  );
  return values.length === 0 ? undefined : Object.freeze(values);
}

function fieldValues(
  schema: z.ZodType,
  metadata: ResourceFieldMetadata | undefined,
  path: Path,
): Outcome<readonly (string | number | boolean)[] | undefined> {
  const values: unknown = metadata?.values ?? inferredValues(schema);
  if (values === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(values) || values.length === 0 || values.length > 100)
    return {
      ok: false,
      diagnostics: [diagnostic('resource.field-values', 'Field values must contain 1–100 unique scalar values.', path)],
    };
  const inspected: (string | number | boolean)[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value: unknown = values[index];
    if (!validFieldValue(value, inspected, schema))
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.field-values', 'A declared field value does not satisfy its runtime schema.', [
            ...path,
            index,
          ]),
        ],
      };
    inspected.push(value);
  }
  return { ok: true, value: Object.freeze(inspected) };
}

function validFieldValue(
  value: unknown,
  prior: readonly (string | number | boolean)[],
  schema: z.ZodType,
): value is string | number | boolean {
  const scalar = SCALAR_VALUE_TYPES.has(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
  if (!scalar) return false;
  if (typeof value === 'string' && (value.length === 0 || value.length > 160)) return false;
  if (prior.some((candidate) => Object.is(candidate, value))) return false;
  return schema.safeParse(value).success;
}

function generatedField<Schema extends z.ZodObject>(
  input: GeneratedResourceInput<Schema>,
  id: string,
  schema: z.ZodType,
): Outcome<Catalog['entities'][number]['fields'][number] | undefined> {
  const metadata = input.fields?.[id];
  const inferred = inferType(schema, ['schema', id]);
  if (!inferred.ok && metadata?.type === undefined) return inferred;
  return {
    ok: true,
    value: {
      id,
      label: metadata?.label ?? id,
      role: input.identity.includes(id) ? 'identity' : (metadata?.role ?? 'attribute'),
      type: generatedFieldType(metadata?.type, inferred),
    },
  };
}

function generatedFieldType(explicit: SemanticType | undefined, inferred: Outcome<SemanticType>): SemanticType {
  if (explicit !== undefined) return explicit;
  if (inferred.ok) return inferred.value;
  return { value: 'text', nullable: false };
}

function generatedFields<Schema extends z.ZodObject>(
  input: GeneratedResourceInput<Schema>,
): {
  readonly fields: Catalog['entities'][number]['fields'][number][];
  readonly diagnostics: Diagnostic[];
} {
  const fields: Catalog['entities'][number]['fields'][number][] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [id, schema] of Object.entries(input.schema.shape)) {
    const field = generatedField(input, id, schema);
    if (!field.ok) diagnostics.push(...field.diagnostics);
    else if (field.value !== undefined) fields.push(field.value);
  }
  return { fields, diagnostics };
}

function generatedCatalog<Schema extends z.ZodObject>(input: ResourceInput<Schema>): Outcome<Catalog> {
  if ('catalog' in input && input.catalog !== undefined) return parseCatalog(input.catalog);
  const generated = generatedFields(input);
  const firstDiagnostic = generated.diagnostics[0];
  if (firstDiagnostic !== undefined)
    return { ok: false, diagnostics: [firstDiagnostic, ...generated.diagnostics.slice(1)] };
  const functionRegistryDigest = input.functionRegistryDigest ?? 'core-query-2';
  const measures = expandMeasures(input.measures, {
    fields: generated.fields,
    identity: input.identity[0],
    functionRegistryDigest,
    reserved: new Set((input.meanings ?? []).map((meaning) => meaning.id)),
  });
  if (!measures.ok) return measures;
  const catalog: Catalog = {
    version: '1',
    revision: input.revision,
    functionRegistryDigest,
    entities: [
      {
        id: input.id,
        label: input.label,
        identity: input.identity,
        rowGrain: input.rowGrain ?? input.identity,
        fields: generated.fields,
      },
    ],
    relationships: [],
    meanings: [...(input.meanings ?? []), ...measures.value],
    capabilities: [],
  };
  return parseCatalog(catalog);
}

function validateResourceMetadata<Schema extends z.ZodObject>(input: ResourceInput<Schema>): Outcome<void> {
  if (!validIdentifier(input.id))
    return {
      ok: false,
      diagnostics: [diagnostic('resource.id', 'Resource ID must be a bounded identifier without whitespace.', ['id'])],
    };
  if (input.label.trim().length === 0)
    return { ok: false, diagnostics: [diagnostic('resource.label', 'Resource label must not be empty.', ['label'])] };
  const shapeKeys = Object.keys(input.schema.shape);
  for (const metadataKey of Object.keys(input.fields ?? {})) {
    if (!shapeKeys.includes(metadataKey))
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.unknown-field', `Field metadata references unknown schema field ${metadataKey}.`, [
            'fields',
            metadataKey,
          ]),
        ],
      };
  }
  return { ok: true, value: undefined };
}

interface ResourceCatalogBinding {
  readonly catalog: Catalog;
  readonly entity: Catalog['entities'][number];
}

function resolveCatalogBinding<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<ResourceCatalogBinding> {
  const catalogOutcome = generatedCatalog(input);
  if (!catalogOutcome.ok) return catalogOutcome;
  const indexed = createCatalogIndex(catalogOutcome.value);
  if (!indexed.ok) return indexed;
  const entityId = 'catalog' in input && input.catalog !== undefined ? (input.entity ?? input.id) : input.id;
  const entity = indexed.value.entities.get(entityId);
  if (entity === undefined)
    return {
      ok: false,
      diagnostics: [diagnostic('resource.entity', `Catalog entity ${entityId} is not declared.`, ['entity'])],
    };
  return { ok: true, value: { catalog: catalogOutcome.value, entity } };
}

function validateSchemaCatalogFields<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
  entity: Catalog['entities'][number],
): Outcome<void> {
  const schemaFields = new Set(Object.keys(input.schema.shape));
  for (const field of entity.fields) {
    if (!schemaFields.has(field.id))
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.schema-field', `Catalog field ${field.id} is missing from the runtime schema.`, [
            'schema',
            field.id,
          ]),
        ],
      };
  }
  for (const key of schemaFields) {
    if (!entity.fields.some((field) => field.id === key))
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.catalog-field', `Runtime schema field ${key} is missing from the Catalog entity.`, [
            'schema',
            key,
          ]),
        ],
      };
  }
  return { ok: true, value: undefined };
}

function validateResourceIntents<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<readonly StandardIntentKind[]> {
  const defaultIntents = STANDARD_INTENTS.filter(
    (intent) => (intent !== 'create' && intent !== 'edit') || input.forms?.[intent] !== undefined,
  );
  const intents = Object.freeze([...(input.intents ?? defaultIntents)]);
  if (new Set(intents).size !== intents.length)
    return {
      ok: false,
      diagnostics: [
        diagnostic('resource.duplicate-intent', 'Resource intent declarations must be unique.', ['intents']),
      ],
    };
  for (const intent of ['create', 'edit'] as const) {
    if (intents.includes(intent) && input.forms?.[intent] === undefined)
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.form-intent', `${intent} requires a registered form schema and action.`, ['intents']),
        ],
      };
  }
  return { ok: true, value: intents };
}

function validateResourcePresentation<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<ResourcePresentationDefaults> {
  const allowedViews = Object.freeze([...input.presentation.allowedViews]);
  if (
    allowedViews.length === 0 ||
    new Set(allowedViews).size !== allowedViews.length ||
    allowedViews.some((view) => !validIdentifier(view))
  )
    return {
      ok: false,
      diagnostics: [
        diagnostic('resource.views', 'A resource needs unique bounded allowed view IDs.', [
          'presentation',
          'allowedViews',
        ]),
      ],
    };
  for (const [kind, preferred] of Object.entries(input.presentation.preferred ?? {})) {
    if (!allowedViews.includes(preferred))
      return {
        ok: false,
        diagnostics: [
          diagnostic('resource.preferred-view', `Preferred ${kind} view ${preferred} is not allowed.`, [
            'presentation',
            'preferred',
            kind,
          ]),
        ],
      };
  }
  return {
    ok: true,
    value: Object.freeze({
      allowedViews,
      ...(input.presentation.preferred === undefined
        ? {}
        : { preferred: Object.freeze({ ...input.presentation.preferred }) }),
    }),
  };
}

function createFieldMetadata<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<Readonly<Record<string, ResourceFieldMetadata>>> {
  const mutable: Record<string, ResourceFieldMetadata> = {};
  for (const [key, schema] of Object.entries(input.schema.shape)) {
    const values = fieldValues(schema, input.fields?.[key], ['fields', key, 'values']);
    if (!values.ok) return values;
    mutable[key] = Object.freeze({
      ...input.fields?.[key],
      ...(values.value === undefined ? {} : { values: values.value }),
    });
  }
  return { ok: true, value: Object.freeze(mutable) };
}

function createRecordParser<Schema extends z.ZodObject>(schema: Schema): ResourceDefinition<Schema>['parseRecord'] {
  return (value) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data };
    const issues = parsed.error.issues.slice(0, 16).map((issue) =>
      diagnostic(
        `resource.record.${issue.code}`,
        issue.message,
        issue.path.filter((part): part is string | number => typeof part !== 'symbol'),
      ),
    );
    const firstIssue = issues[0];
    if (firstIssue !== undefined) return { ok: false, diagnostics: [firstIssue, ...issues.slice(1)] };
    return {
      ok: false,
      diagnostics: [diagnostic('resource.record.invalid', 'The record does not match its runtime schema.', [])],
    };
  };
}

function buildResourceDefinition<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
  binding: ResourceCatalogBinding,
  intents: readonly StandardIntentKind[],
  presentation: ResourcePresentationDefaults,
  fieldMetadata: Readonly<Record<string, ResourceFieldMetadata>>,
): ResourceDefinition<Schema> {
  const definition: ResourceDefinition<Schema> = {
    id: input.id,
    label: input.label,
    ...(input.description === undefined ? {} : { description: input.description }),
    schema: input.schema,
    catalog: binding.catalog,
    entity: binding.entity,
    fieldMetadata,
    intents,
    presentation,
    ...(input.forms === undefined ? {} : { forms: Object.freeze({ ...input.forms }) }),
    parseRecord: createRecordParser(input.schema),
  };
  return Object.freeze(definition);
}

function inspectResource<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<ResourceDefinition<Schema>> {
  const metadata = validateResourceMetadata(input);
  if (!metadata.ok) return metadata;
  const binding = resolveCatalogBinding(input);
  if (!binding.ok) return binding;
  const fields = validateSchemaCatalogFields(input, binding.value.entity);
  if (!fields.ok) return fields;
  const intents = validateResourceIntents(input);
  if (!intents.ok) return intents;
  const presentation = validateResourcePresentation(input);
  if (!presentation.ok) return presentation;
  const fieldMetadata = createFieldMetadata(input);
  if (!fieldMetadata.ok) return fieldMetadata;
  return {
    ok: true,
    value: buildResourceDefinition(input, binding.value, intents.value, presentation.value, fieldMetadata.value),
  };
}

/** Define trusted application metadata once. Runtime records still cross parseRecord before use. */
export function defineResource<Schema extends z.ZodObject>(input: ResourceInput<Schema>): ResourceDefinition<Schema> {
  const outcome = inspectResource(input);
  if (!outcome.ok) throw new ResourceDefinitionError(outcome.diagnostics);
  return outcome.value;
}

export function validateResource<Schema extends z.ZodObject>(
  input: ResourceInput<Schema>,
): Outcome<ResourceDefinition<Schema>> {
  return inspectResource(input);
}
