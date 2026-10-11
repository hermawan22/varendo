import type { Catalog, FieldDefinition, MeaningDefinition, Outcome, VersionRef } from '../types.js';
import { fail, isNumeric, sameSet, semanticSignature, versionRefKey } from './validation-common.js';

export function bindAdditiveMeaning(
  ref: VersionRef,
  field: FieldDefinition,
  catalog: Catalog | undefined,
): Outcome<MeaningDefinition> {
  const found = catalog?.meanings.find((item) => versionRefKey(item) === versionRefKey(ref));
  if (!isAuthorizedAdditiveMeaning(found, ref, field, catalog))
    return fail(
      'additivity',
      'Area magnitude requires an active authorized additive meaning pinned by the result field.',
    );
  return { ok: true, value: found };
}

function isAuthorizedAdditiveMeaning(
  found: MeaningDefinition | undefined,
  ref: VersionRef,
  field: FieldDefinition,
  catalog: Catalog | undefined,
): found is MeaningDefinition {
  if (!isNumeric(field.type) || found === undefined || catalog === undefined) return false;
  return hasAuthorizedAdditivePolicy(found, ref, catalog) && hasMatchingMeaningField(found, field);
}

function hasAuthorizedAdditivePolicy(found: MeaningDefinition, ref: VersionRef, catalog: Catalog): boolean {
  if (versionRefKey(found) !== versionRefKey(ref)) return false;
  if (found.lifecycle !== 'active' || found.authority === 'hypothesis') return false;
  return found.functionRegistryDigest === catalog.functionRegistryDigest && found.aggregation === 'additive';
}

function hasMatchingMeaningField(found: MeaningDefinition, field: FieldDefinition): boolean {
  if (field.derivation === undefined || versionRefKey(field.derivation) !== versionRefKey(found)) return false;
  if (semanticSignature(found.output) !== semanticSignature(field.type)) return false;
  return found.output.grain === undefined || sameSet(found.output.grain, field.type.grain ?? []);
}
