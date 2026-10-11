import * as z from 'zod/mini';
import { idSchema, resultRefSchema, versionRefSchema } from '../schemas.js';
import { inspectWire as parseWireValue } from '../ingress.js';
import type { Catalog, FieldDefinition, MeaningDefinition, Outcome, Result } from '../types.js';
import type {
  BoundVisualization,
  ResultVisualizationSpec,
  VisualizationBindingContext,
  VisualizationFieldMap,
} from './binding-types.js';
import { bindAdditiveMeaning } from './additive-meaning.js';
import {
  fail,
  freezeOwned,
  isNumeric,
  isTemporal,
  resultRefKey,
  sameSet,
  semanticSignature,
  versionRefKey,
} from './validation-common.js';

const projections = z.array(idSchema).check(z.minLength(1), z.maxLength(16));
const relationshipBindingsSchema = z
  .array(
    z.strictObject({
      result: resultRefSchema,
      relationship: versionRefSchema,
      source: projections,
      target: projections,
    }),
  )
  .check(z.maxLength(128));

type HierarchySpec = Extract<ResultVisualizationSpec, { readonly view: 'tree' | 'treemap' }>;
type TreemapSpec = Extract<ResultVisualizationSpec, { readonly view: 'treemap' }>;
type RelationshipSpec = Extract<ResultVisualizationSpec, { readonly view: 'relationship' }>;
type TimelineSpec = Extract<ResultVisualizationSpec, { readonly view: 'timeline' }>;
type CalendarSpec = Extract<ResultVisualizationSpec, { readonly view: 'calendar-grid' }>;

interface ResultFamilyBinding {
  readonly meaning: MeaningDefinition | undefined;
  readonly relationship: Catalog['relationships'][number] | undefined;
}

interface AuthorizedRelationshipDetails {
  readonly relationship: Catalog['relationships'][number];
  readonly source: Catalog['entities'][number];
  readonly target: Catalog['entities'][number];
}

const noFamilyBinding: ResultFamilyBinding = { meaning: undefined, relationship: undefined };

export function bindResultVisualization(
  spec: ResultVisualizationSpec,
  results: ReadonlyMap<string, Result>,
  context: VisualizationBindingContext,
  catalog: Catalog | undefined,
): Outcome<BoundVisualization> {
  const result = results.get(resultRefKey(spec.result));
  if (result === undefined) return fail('result', 'The exact result revision and scope are unavailable.');

  const fields = new Map(result.fields.map((field) => [field.id, field]));
  if (!hasRequiredFields(spec, fields))
    return fail('field', 'A visualization field is absent from its authorized result.');

  const family = bindResultFamily(spec, result, fields, context, catalog);
  if (!family.ok) return family;
  return {
    ok: true,
    value: freezeOwned({
      spec,
      results: [result],
      ...(family.value.meaning === undefined ? {} : { meaning: family.value.meaning }),
      ...(family.value.relationship === undefined ? {} : { relationship: family.value.relationship }),
    }),
  };
}

function hasRequiredFields(spec: ResultVisualizationSpec, fields: VisualizationFieldMap): boolean {
  return requiredFieldIds(spec).every((id) => fields.has(id));
}

function requiredFieldIds(spec: ResultVisualizationSpec): readonly string[] {
  switch (spec.view) {
    case 'matrix':
      return spec.columns;
    case 'tree':
      return withOptionalLabel([...spec.node, ...spec.parent], spec.label);
    case 'treemap':
      return withOptionalLabel([...spec.node, ...spec.parent, spec.value], spec.label);
    case 'relationship':
      return withOptionalLabel([...spec.source, ...spec.target], spec.label);
    case 'timeline':
      return timelineFieldIds(spec);
    case 'calendar-grid':
      return calendarFieldIds(spec);
  }
}

function withOptionalLabel(fields: string[], label: string | undefined): readonly string[] {
  if (label) fields.push(label);
  return fields;
}

function timelineFieldIds(spec: TimelineSpec): readonly string[] {
  const fields = [spec.start];
  if (spec.end) fields.push(spec.end);
  return withOptionalLabel(fields, spec.label);
}

function calendarFieldIds(spec: CalendarSpec): readonly string[] {
  const fields = [spec.date];
  if (spec.value) fields.push(spec.value);
  return withOptionalLabel(fields, spec.label);
}

function bindResultFamily(
  spec: ResultVisualizationSpec,
  result: Result,
  fields: VisualizationFieldMap,
  context: VisualizationBindingContext,
  catalog: Catalog | undefined,
): Outcome<ResultFamilyBinding> {
  switch (spec.view) {
    case 'matrix':
      return bindMatrix(spec);
    case 'tree':
      return bindTree(spec, result, fields);
    case 'treemap':
      return bindTreemap(spec, result, fields, catalog);
    case 'relationship':
      return bindRelationship(spec, fields, context.relationships, catalog);
    case 'timeline':
      return bindTimeline(spec, fields);
    case 'calendar-grid':
      return bindCalendar(spec, fields);
  }
}

function bindMatrix(spec: Extract<ResultVisualizationSpec, { readonly view: 'matrix' }>): Outcome<ResultFamilyBinding> {
  if (new Set(spec.columns).size !== spec.columns.length) return fail('matrix', 'Matrix columns must be unique.');
  return { ok: true, value: noFamilyBinding };
}

function bindTree(
  spec: Extract<ResultVisualizationSpec, { readonly view: 'tree' }>,
  result: Result,
  fields: VisualizationFieldMap,
): Outcome<ResultFamilyBinding> {
  if (!hasValidHierarchy(spec, result, fields))
    return fail('hierarchy', 'Hierarchy requires one row per stable node and compatible explicit parent keys.');
  return { ok: true, value: noFamilyBinding };
}

function bindTreemap(
  spec: TreemapSpec,
  result: Result,
  fields: VisualizationFieldMap,
  catalog: Catalog | undefined,
): Outcome<ResultFamilyBinding> {
  if (!hasValidHierarchy(spec, result, fields))
    return fail('hierarchy', 'Hierarchy requires one row per stable node and compatible explicit parent keys.');
  const meaning = bindAdditiveMeaning(spec.meaning, fields.get(spec.value)!, catalog);
  if (!meaning.ok) return meaning;
  return { ok: true, value: { meaning: meaning.value, relationship: undefined } };
}

function hasValidHierarchy(spec: HierarchySpec, result: Result, fields: VisualizationFieldMap): boolean {
  if (new Set(spec.node).size !== spec.node.length || !sameSet(spec.node, result.identity)) return false;
  if (!sameSet(spec.node, result.rowGrain) || spec.node.length !== spec.parent.length) return false;
  if (new Set(spec.parent).size !== spec.parent.length || spec.node.some((id) => spec.parent.includes(id)))
    return false;
  return spec.node.every((id, index) => haveCompatibleTypes(fields.get(id)!, fields.get(spec.parent[index]!)!));
}

function haveCompatibleTypes(node: FieldDefinition, parent: FieldDefinition): boolean {
  return semanticSignature(node.type, false) === semanticSignature(parent.type, false);
}

function bindRelationship(
  spec: RelationshipSpec,
  fields: VisualizationFieldMap,
  inputBindings: VisualizationBindingContext['relationships'],
  catalog: Catalog | undefined,
): Outcome<ResultFamilyBinding> {
  const details = findAuthorizedRelationship(spec, catalog);
  if (details === undefined)
    return fail(
      'relationship',
      'Relationship view requires a declared versioned relation and stable endpoint identities.',
    );

  const declarations = parseRelationshipBindings(inputBindings ?? []);
  if (!declarations.ok) return declarations;
  if (!hasExactRelationshipBinding(spec, declarations.value))
    return fail('relationship', 'The exact endpoint projection must be declared once by the authorized host.');
  if (!hasValidEndpointProjection(details.source, spec.source, fields))
    return fail('relationship', 'Edge endpoint fields do not match the declared entity identities.');
  if (!hasValidEndpointProjection(details.target, spec.target, fields))
    return fail('relationship', 'Edge endpoint fields do not match the declared entity identities.');
  return { ok: true, value: { meaning: undefined, relationship: details.relationship } };
}

function findAuthorizedRelationship(
  spec: RelationshipSpec,
  catalog: Catalog | undefined,
): AuthorizedRelationshipDetails | undefined {
  const relationship = catalog?.relationships.find((item) => versionRefKey(item) === versionRefKey(spec.relationship));
  if (relationship === undefined || catalog === undefined) return undefined;
  const source = catalog.entities.find((entity) => entity.id === relationship.sourceEntity);
  const target = catalog.entities.find((entity) => entity.id === relationship.targetEntity);
  if (source === undefined || target === undefined || !hasValidRelationship(spec, source, target)) return undefined;
  return { relationship, source, target };
}

function hasValidRelationship(
  spec: RelationshipSpec,
  source: Catalog['entities'][number],
  target: Catalog['entities'][number],
): boolean {
  if (spec.source.length !== source.identity.length || spec.target.length !== target.identity.length) return false;
  return new Set(spec.source).size === spec.source.length && new Set(spec.target).size === spec.target.length;
}

function parseRelationshipBindings(input: unknown): Outcome<z.infer<typeof relationshipBindingsSchema>> {
  const mappings = parseWireValue(input);
  if (!mappings.ok) return mappings;
  const declarations = z.safeParse(relationshipBindingsSchema, mappings.value);
  if (!declarations.success) return fail('relationship', 'Authorized edge bindings must be bounded and well formed.');
  return { ok: true, value: declarations.data };
}

function hasExactRelationshipBinding(
  spec: RelationshipSpec,
  declarations: z.infer<typeof relationshipBindingsSchema>,
): boolean {
  const exact = declarations.filter((item) => matchesRelationshipBinding(item, spec));
  return exact.length === 1;
}

function matchesRelationshipBinding(
  item: z.infer<typeof relationshipBindingsSchema>[number],
  spec: RelationshipSpec,
): boolean {
  return (
    JSON.stringify(item.source) === JSON.stringify(spec.source) &&
    JSON.stringify(item.target) === JSON.stringify(spec.target) &&
    resultRefKey(item.result) === resultRefKey(spec.result) &&
    versionRefKey(item.relationship) === versionRefKey(spec.relationship)
  );
}

function hasValidEndpointProjection(
  entity: Catalog['entities'][number],
  projection: readonly string[],
  fields: VisualizationFieldMap,
): boolean {
  return entity.identity.every((id, index) =>
    matchesEndpointIdentity(
      entity.fields.find((field) => field.id === id),
      fields.get(projection[index]!),
    ),
  );
}

function matchesEndpointIdentity(
  identity: FieldDefinition | undefined,
  projected: FieldDefinition | undefined,
): boolean {
  if (identity === undefined || identity.type.nullable || projected === undefined) return false;
  return semanticSignature(identity.type) === semanticSignature(projected.type);
}

function bindTimeline(spec: TimelineSpec, fields: VisualizationFieldMap): Outcome<ResultFamilyBinding> {
  const start = fields.get(spec.start)!;
  if (!isTemporal(start.type))
    return fail('temporal', 'Dated views require a declared calendar and timezone for instants.');
  if (spec.end !== undefined && !haveCompatibleTypes(start, fields.get(spec.end)!))
    return fail('temporal', 'Interval endpoints must share their temporal policy.');
  return { ok: true, value: noFamilyBinding };
}

function bindCalendar(spec: CalendarSpec, fields: VisualizationFieldMap): Outcome<ResultFamilyBinding> {
  if (!isTemporal(fields.get(spec.date)!.type))
    return fail('temporal', 'Dated views require a declared calendar and timezone for instants.');
  if (spec.value !== undefined && !isNumeric(fields.get(spec.value)!.type))
    return fail('calendar', 'A calendar value field must be quantitative; labels may remain textual.');
  return { ok: true, value: noFamilyBinding };
}
