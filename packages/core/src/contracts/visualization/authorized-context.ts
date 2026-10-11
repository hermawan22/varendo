import { parseCatalog, parseResult } from '../parse.js';
import { WIRE_LIMITS } from '../limits.js';
import type { Catalog, Outcome, Result } from '../types.js';
import type { AuthorizedVisualizationContext, VisualizationBindingContext } from './binding-types.js';
import { fail, resultRefKey, versionRefKey } from './validation-common.js';

export function authorizeVisualizationContext(
  context: VisualizationBindingContext,
): Outcome<AuthorizedVisualizationContext> {
  const results = authorizeResults(context.results);
  if (!results.ok) return results;
  const catalog = authorizeCatalog(context.catalog);
  if (!catalog.ok) return catalog;
  return { ok: true, value: { results: results.value, catalog: catalog.value } };
}

function authorizeResults(input: readonly Result[]): Outcome<ReadonlyMap<string, Result>> {
  if (!Array.isArray(input) || input.length > WIRE_LIMITS.outputs)
    return fail('results', 'Authorized results must be bounded.');

  const results = new Map<string, Result>();
  for (const inputResult of input) {
    const parsed = parseResult(inputResult);
    if (!parsed.ok) return parsed;
    const result = parsed.value;
    const ref = resultRefKey(result.ref);
    if (results.has(ref)) return fail('results', 'An exact result reference is repeated.');

    const fieldIds = result.fields.map((field) => field.id);
    if (fieldIds.includes('__proto__'))
      return fail('field', 'The reserved wire key __proto__ requires a safe host field alias.');
    if (!hasValidIdentity(result, fieldIds))
      return fail('identity', 'Visualization rows require declared nonnullable stable identity and field-based grain.');

    const scope = validateResultScope(result);
    if (!scope.ok) return scope;
    results.set(ref, result);
  }
  return { ok: true, value: results };
}

function hasValidIdentity(result: Result, fieldIds: readonly string[]): boolean {
  if (new Set(fieldIds).size !== fieldIds.length) return false;
  if (result.identity.length === 0 || result.rowGrain.length === 0) return false;
  if (new Set(result.identity).size !== result.identity.length) return false;
  if (new Set(result.rowGrain).size !== result.rowGrain.length) return false;
  if ([...result.identity, ...result.rowGrain].some((id) => !fieldIds.includes(id))) return false;
  return !result.identity.some((id) => result.fields.find((field) => field.id === id)!.type.nullable);
}

function validateResultScope(result: Result): Outcome<true> {
  if (
    result.counts.population.kind === 'exact' &&
    (result.counts.loaded > result.counts.population.value ||
      (result.coverage.kind === 'complete' && result.counts.loaded !== result.counts.population.value))
  )
    return fail('scope', 'Loaded counts cannot overstate exact population completeness.');
  if (
    result.counts.population.kind !== 'unknown' &&
    result.coverage.kind !== 'unknown' &&
    result.counts.population.populationDigest !== result.coverage.populationDigest
  )
    return fail('scope', 'Population count and coverage must describe the same population.');
  return { ok: true, value: true };
}

function authorizeCatalog(input: Catalog | undefined): Outcome<Catalog | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  const parsed = parseCatalog(input);
  if (!parsed.ok) return parsed;
  if (!hasUnambiguousIdentities(parsed.value)) return fail('catalog', 'Catalog identities must be unambiguous.');
  return { ok: true, value: parsed.value };
}

function hasUnambiguousIdentities(catalog: Catalog): boolean {
  const entityIds = catalog.entities.map((entity) => entity.id);
  const relationshipIds = catalog.relationships.map(versionRefKey);
  const meaningIds = catalog.meanings.map(versionRefKey);
  return (
    new Set(entityIds).size === entityIds.length &&
    new Set(relationshipIds).size === relationshipIds.length &&
    new Set(meaningIds).size === meaningIds.length
  );
}
