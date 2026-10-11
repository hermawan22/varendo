import type { Catalog, VersionRef } from '../../contracts/types.js';
import type { QueryOutcome } from '../types.js';
import { failure, type CatalogRelationship } from './shared.js';
import { sameTypeFamily } from './expressions.js';

export function relationshipFor(catalog: Catalog, ref: VersionRef): CatalogRelationship | undefined {
  return catalog.relationships.find(
    (relationship) => relationship.id === ref.id && relationship.revision === ref.revision,
  );
}

export function validateRelationshipKeyTypes(
  catalog: Catalog,
  relationship: CatalogRelationship,
  path: readonly (string | number)[],
): QueryOutcome<void> {
  const source = catalog.entities.find((entity) => entity.id === relationship.sourceEntity);
  const target = catalog.entities.find((entity) => entity.id === relationship.targetEntity);
  if (source === undefined || target === undefined)
    return failure('query.relationship-key', 'Relationship key entities are not declared.', path);
  for (let index = 0; index < relationship.keys.length; index += 1) {
    const key = relationship.keys[index]!;
    const left = source.fields.find((field) => field.id === key.sourceField);
    const right = target.fields.find((field) => field.id === key.targetField);
    if (left === undefined || right === undefined)
      return failure('query.relationship-key', 'Relationship key fields are not declared on their entities.', [
        ...path,
        'keys',
        index,
      ]);
    if (!sameTypeFamily(left.type, right.type))
      return failure(
        'query.relationship-key-type',
        'Relationship key fields must have compatible semantic types, units and temporal policies.',
        [...path, 'keys', index],
      );
  }
  return { ok: true, value: undefined };
}
