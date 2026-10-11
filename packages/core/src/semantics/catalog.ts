import type { Catalog, MeaningDefinition, Outcome } from '../contracts/types.js';
import { parseCatalog } from '../contracts/parse.js';
import { versionRefKey as key } from '../contracts/stable.js';
import { semanticFailure } from './errors.js';
import { validateSemanticType } from './type-utils.js';
import type { CatalogEntity, CatalogIndex, FieldBinding } from './types.js';

const CAPABILITY_ERROR = 'Invalid capability.';

function capabilityFailure(code: string, index: number, path: string[] = []): Outcome<never> {
  return semanticFailure(`semantic.capability-${code}`, CAPABILITY_ERROR, ['capabilities', index, ...path]);
}

function fieldTypeWithEntityGrain(field: FieldBinding['field'], entity: CatalogEntity): FieldBinding['type'] {
  if (field.type.grain !== undefined) return field.type;
  return { ...field.type, grain: entity.rowGrain };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function resolveField(
  entityId: string | undefined,
  fieldId: string,
  fieldsByEntity: ReadonlyMap<string, ReadonlyMap<string, FieldBinding>>,
  fieldsById: ReadonlyMap<string, readonly FieldBinding[]>,
): ReturnType<CatalogIndex['resolveField']> {
  if (entityId !== undefined) {
    const field = fieldsByEntity.get(entityId)?.get(fieldId);
    if (field !== undefined) return { ok: true, value: field };
    return semanticFailure('semantic.unknown-field', `Field ${fieldId} is not available on entity ${entityId}.`, [
      'ref',
    ]);
  }
  const fields = fieldsById.get(fieldId) ?? [];
  if (fields.length === 1) return { ok: true, value: fields[0]! };
  if (fields.length > 1)
    return semanticFailure('semantic.ambiguous-field', `Field ${fieldId} belongs to more than one entity.`, ['ref']);
  return semanticFailure('semantic.unknown-field', `Field ${fieldId} is not declared.`, ['ref']);
}

type ValidationFailure = Outcome<never> | undefined;
type CatalogRelationship = Catalog['relationships'][number];
type CatalogCapability = Catalog['capabilities'][number];

interface CatalogIndexes {
  readonly entities: Map<string, CatalogEntity>;
  readonly fieldsByEntity: Map<string, ReadonlyMap<string, FieldBinding>>;
  readonly fieldsById: Map<string, FieldBinding[]>;
  readonly relationships: Map<string, CatalogRelationship>;
  readonly meanings: Map<string, MeaningDefinition>;
  readonly capabilities: Map<string, CatalogCapability>;
}

function createIndexes(): CatalogIndexes {
  return {
    entities: new Map(),
    fieldsByEntity: new Map(),
    fieldsById: new Map(),
    relationships: new Map(),
    meanings: new Map(),
    capabilities: new Map(),
  };
}

function indexFields(
  entity: CatalogEntity,
  entityIndex: number,
  indexes: CatalogIndexes,
): Outcome<ReadonlyMap<string, FieldBinding>> {
  const fields = new Map<string, FieldBinding>();
  for (let fieldIndex = 0; fieldIndex < entity.fields.length; fieldIndex += 1) {
    const field = entity.fields[fieldIndex];
    if (field === undefined)
      return semanticFailure('semantic.field-shape', 'Field is not a canonical object.', [
        'entities',
        entityIndex,
        'fields',
        fieldIndex,
      ]);
    if (fields.has(field.id))
      return semanticFailure(
        'semantic.duplicate-field',
        `Field ${field.id} is declared more than once on ${entity.id}.`,
        ['entities', entityIndex, 'fields', fieldIndex, 'id'],
      );
    const fieldType = validateSemanticType(field.type, ['entities', entityIndex, 'fields', fieldIndex, 'type']);
    if (!fieldType.ok) return fieldType;
    const binding: FieldBinding = {
      entityId: entity.id,
      entity,
      field,
      type: fieldTypeWithEntityGrain({ ...field, type: fieldType.value }, entity),
    };
    fields.set(field.id, binding);
    const all = indexes.fieldsById.get(field.id) ?? [];
    all.push(binding);
    indexes.fieldsById.set(field.id, all);
  }
  return { ok: true, value: fields };
}

function firstMissingField(fields: ReadonlyMap<string, FieldBinding>, ids: readonly string[]): string | undefined {
  return ids.find((id) => !fields.has(id));
}

function validateEntityReferences(
  entity: CatalogEntity,
  entityIndex: number,
  fields: ReadonlyMap<string, FieldBinding>,
): ValidationFailure {
  const identity = firstMissingField(fields, entity.identity);
  if (identity !== undefined)
    return semanticFailure('semantic.identity-field', `Identity field ${identity} is not declared on ${entity.id}.`, [
      'entities',
      entityIndex,
      'identity',
    ]);
  const grain = firstMissingField(fields, entity.rowGrain);
  if (grain !== undefined)
    return semanticFailure('semantic.grain-field', `Row-grain field ${grain} is not declared on ${entity.id}.`, [
      'entities',
      entityIndex,
      'rowGrain',
    ]);
  return undefined;
}

function registerEntity(entity: CatalogEntity | undefined, index: number, indexes: CatalogIndexes): ValidationFailure {
  if (entity === undefined)
    return semanticFailure('semantic.catalog-entity', 'Catalog entity is not a canonical object.', ['entities', index]);
  if (indexes.entities.has(entity.id))
    return semanticFailure('semantic.duplicate-entity', `Entity ${entity.id} is declared more than once.`, [
      'entities',
      index,
      'id',
    ]);
  const fields = indexFields(entity, index, indexes);
  if (!fields.ok) return fields;
  const references = validateEntityReferences(entity, index, fields.value);
  if (references !== undefined) return references;
  indexes.entities.set(entity.id, entity);
  indexes.fieldsByEntity.set(entity.id, fields.value);
  return undefined;
}

function indexEach<T>(
  items: readonly T[],
  indexes: CatalogIndexes,
  visit: (item: T, index: number, indexes: CatalogIndexes) => ValidationFailure,
): ValidationFailure {
  for (let index = 0; index < items.length; index += 1) {
    const failure = visit(items[index]!, index, indexes);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function indexEntities(catalog: Catalog, indexes: CatalogIndexes): ValidationFailure {
  return indexEach(catalog.entities, indexes, registerEntity);
}

function validateRelationship(
  relationship: CatalogRelationship | undefined,
  index: number,
  indexes: CatalogIndexes,
): ValidationFailure {
  if (
    relationship === undefined ||
    !indexes.entities.has(relationship.sourceEntity) ||
    !indexes.entities.has(relationship.targetEntity)
  )
    return semanticFailure('semantic.relationship-entity', 'Relationship references an unknown entity.', [
      'relationships',
      index,
    ]);
  const sourceFields = indexes.fieldsByEntity.get(relationship.sourceEntity)!;
  const targetFields = indexes.fieldsByEntity.get(relationship.targetEntity)!;
  const invalidKey = relationship.keys.findIndex(
    (joinKey) => !sourceFields.has(joinKey.sourceField) || !targetFields.has(joinKey.targetField),
  );
  if (invalidKey >= 0)
    return semanticFailure('semantic.relationship-field', 'Relationship key references an unknown field.', [
      'relationships',
      index,
      'keys',
      invalidKey,
    ]);
  const relationshipKey = key(relationship);
  if (indexes.relationships.has(relationshipKey))
    return semanticFailure('semantic.duplicate-relationship', 'Relationship is declared more than once.', [
      'relationships',
      index,
    ]);
  indexes.relationships.set(relationshipKey, relationship);
  return undefined;
}

function indexRelationships(catalog: Catalog, indexes: CatalogIndexes): ValidationFailure {
  return indexEach(catalog.relationships, indexes, validateRelationship);
}

function indexMeanings(catalog: Catalog, indexes: CatalogIndexes): ValidationFailure {
  for (let index = 0; index < catalog.meanings.length; index += 1) {
    const meaning = catalog.meanings[index]!;
    const meaningKey = key(meaning);
    if (indexes.meanings.has(meaningKey))
      return semanticFailure('semantic.duplicate-meaning', `Meaning ${meaningKey} is declared more than once.`, [
        'meanings',
        index,
      ]);
    indexes.meanings.set(meaningKey, meaning);
  }
  return undefined;
}

function validatePagination(
  capability: CatalogCapability,
  entity: CatalogEntity,
  fields: ReadonlyMap<string, FieldBinding>,
  index: number,
): ValidationFailure {
  const pagination = capability.pagination;
  if (pagination === undefined) return undefined;
  if (pagination.stableOrder.some(({ field }) => !fields.has(field)))
    return capabilityFailure('pagination-field', index, ['pagination', 'stableOrder']);
  if (!sameIds(pagination.identity, entity.identity))
    return capabilityFailure('pagination-identity', index, ['pagination', 'identity']);
  const suffix = pagination.stableOrder.slice(-pagination.identity.length).map(({ field }) => field);
  if (pagination.identity.length === 0 || !sameIds(suffix, pagination.identity))
    return capabilityFailure('pagination-order', index, ['pagination', 'stableOrder']);
  return undefined;
}

function validateCapability(capability: CatalogCapability, index: number, indexes: CatalogIndexes): ValidationFailure {
  const capabilityKey = key(capability.ref);
  if (indexes.capabilities.has(capabilityKey))
    return semanticFailure('semantic.duplicate-capability', CAPABILITY_ERROR, ['capabilities', index]);
  const entity = indexes.entities.get(capability.entity);
  const fields = indexes.fieldsByEntity.get(capability.entity);
  if (entity === undefined || fields === undefined) return capabilityFailure('entity', index, ['entity']);
  if (capability.fields.some((field) => !fields.has(field))) return capabilityFailure('field', index, ['fields']);
  if ((capability.metrics ?? []).some((metric) => !indexes.meanings.has(key(metric))))
    return capabilityFailure('metric', index, ['metrics']);
  if (
    capability.relations.some((relation) => {
      const declared = indexes.relationships.get(key(relation));
      return declared === undefined || declared.sourceEntity !== capability.entity;
    })
  )
    return capabilityFailure('relation', index, ['relations']);
  const pagination = validatePagination(capability, entity, fields, index);
  if (pagination !== undefined) return pagination;
  indexes.capabilities.set(capabilityKey, capability);
  return undefined;
}

function indexCapabilities(catalog: Catalog, indexes: CatalogIndexes): ValidationFailure {
  return indexEach(catalog.capabilities, indexes, validateCapability);
}

function createCatalogIndexValue(catalog: Catalog, indexes: CatalogIndexes): CatalogIndex {
  return {
    catalog,
    entities: indexes.entities,
    fieldsByEntity: indexes.fieldsByEntity,
    fieldsById: indexes.fieldsById,
    meanings: indexes.meanings,
    capabilities: indexes.capabilities,
    resolveField: (entityId, fieldId) => resolveField(entityId, fieldId, indexes.fieldsByEntity, indexes.fieldsById),
    resolveMeaning: (ref) => indexes.meanings.get(key(ref)),
    resolveCapability: (ref) => indexes.capabilities.get(key(ref)),
  };
}

export function createCatalogIndex(catalog: Catalog): Outcome<CatalogIndex> {
  const parsed = parseCatalog(catalog);
  if (!parsed.ok) return parsed;
  const indexes = createIndexes();
  const phases = [indexEntities, indexRelationships, indexMeanings, indexCapabilities];
  for (const phase of phases) {
    const failure = phase(parsed.value, indexes);
    if (failure !== undefined) return failure;
  }
  return { ok: true, value: createCatalogIndexValue(parsed.value, indexes) };
}

export { key as versionKey };
