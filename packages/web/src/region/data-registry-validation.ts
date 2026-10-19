import { parseResult, parseWireValue, validateScalar, type Outcome, type Result } from '@varendo/core';
import type { VarendoDataRecord, VarendoDataScope, VarendoDataValue } from '../data/index.js';
import type { VarendoDataBinding, VarendoDataRegistryOptions, VarendoValidatedBinding } from './data-registry-types.js';
import { columns } from './data-registry-columns.js';
import { rowIdentity } from './data-registry-selection.js';
import { boundedText, failure, fieldMap, isPlainRecord } from './data-registry-common.js';

interface ParsedDataBinding {
  readonly result: Result;
  readonly rows: readonly VarendoDataRecord[];
  readonly columns?: VarendoDataBinding['columns'];
  readonly scope?: VarendoDataScope;
}

interface CanonicalScopeParts {
  readonly value: VarendoDataScope;
  readonly populationDigest?: string;
}

type CanonicalScopeKind = NonNullable<VarendoDataScope['kind']>;

function coverageKind(result: Result): Outcome<CanonicalScopeKind> {
  switch (result.coverage.kind) {
    case 'complete':
      return { ok: true, value: 'population' };
    case 'partial':
      return { ok: true, value: 'loaded' };
    case 'sample':
      return { ok: true, value: 'sample' };
    case 'unknown':
      return { ok: true, value: 'unknown' };
    default:
      return failure('scope', 'The Result coverage state is not registered.');
  }
}

function populationDigest(result: Result): Outcome<string | undefined> {
  const population = result.counts.population;
  const coverage = result.coverage;
  const populationDigest = population.kind === 'unknown' ? undefined : population.populationDigest;
  const coverageDigest = coverage.kind === 'unknown' ? undefined : coverage.populationDigest;
  if (populationDigest !== undefined && coverageDigest !== undefined && populationDigest !== coverageDigest) {
    return failure('scope', 'The Result population and coverage digests must match.');
  }
  return { ok: true, value: populationDigest };
}

function validateCanonicalCounts(result: Result, rows: readonly VarendoDataRecord[]): Outcome<void> {
  const population = result.counts.population;
  if (population.kind === 'exact' && population.value < rows.length) {
    return failure('count', 'The exact Result population count cannot be below loaded rows.');
  }
  if (result.coverage.kind === 'complete' && population.kind === 'exact' && population.value !== rows.length) {
    return failure('count', 'Complete coverage requires the exact population count to equal loaded rows.');
  }
  return { ok: true, value: undefined };
}

function canonicalScopeParts(result: Result, rows: readonly VarendoDataRecord[]): Outcome<CanonicalScopeParts> {
  const kind = coverageKind(result);
  if (!kind.ok) return kind;
  const digest = populationDigest(result);
  if (!digest.ok) return digest;
  const count = validateCanonicalCounts(result, rows);
  if (!count.ok) return count;
  const population = result.counts.population;
  const resolvedPopulationDigest = digest.value;
  const value: VarendoDataScope = {
    loaded: rows.length,
    ...(population.kind === 'exact' ? { populationTotal: population.value } : {}),
    ...(resolvedPopulationDigest === undefined ? {} : { populationDigest: resolvedPopulationDigest }),
    kind: kind.value,
  };
  return {
    ok: true,
    value: {
      value,
      ...(resolvedPopulationDigest === undefined ? {} : { populationDigest: resolvedPopulationDigest }),
    },
  };
}

function validScopeShape(scope: unknown): scope is VarendoDataScope & Record<string, unknown> {
  return isPlainRecord(scope);
}

function validateScopeKeys(scope: VarendoDataScope): Outcome<void> {
  const allowed = ['loaded', 'filteredTotal', 'populationTotal', 'populationDigest', 'kind', 'label'];
  if (Object.keys(scope).some((key) => !allowed.includes(key))) {
    return failure('scope', 'Scope contains an unknown property.');
  }
  return { ok: true, value: undefined };
}

function validateLoadedCount(scope: VarendoDataScope, rows: readonly VarendoDataRecord[]): Outcome<void> {
  if (scope.loaded !== undefined && scope.loaded !== rows.length) {
    return failure('count', 'Scope.loaded must equal the supplied authorized row count.');
  }
  return { ok: true, value: undefined };
}

function validateLoadedSafeCount(scope: VarendoDataScope): Outcome<void> {
  if (scope.loaded !== undefined && (!Number.isSafeInteger(scope.loaded) || scope.loaded < 0)) {
    return failure('count', 'Scope.loaded must be a safe nonnegative count.');
  }
  return { ok: true, value: undefined };
}

function validatePopulationTotalMatch(scope: VarendoDataScope, result: Result): Outcome<void> {
  if (
    scope.populationTotal !== undefined &&
    (result.counts.population.kind !== 'exact' || scope.populationTotal !== result.counts.population.value)
  ) {
    return failure('count', 'Scope.populationTotal must match the exact Result population count.');
  }
  return { ok: true, value: undefined };
}

function validatePopulationTotalSafeCount(scope: VarendoDataScope): Outcome<void> {
  if (
    scope.populationTotal !== undefined &&
    (!Number.isSafeInteger(scope.populationTotal) || scope.populationTotal < 0)
  ) {
    return failure('count', 'Scope.populationTotal must be a safe nonnegative count.');
  }
  return { ok: true, value: undefined };
}

function validateFilteredTotal(
  scope: VarendoDataScope,
  result: Result,
  rows: readonly VarendoDataRecord[],
): Outcome<void> {
  if (
    scope.filteredTotal !== undefined &&
    (!Number.isSafeInteger(scope.filteredTotal) ||
      scope.filteredTotal < rows.length ||
      (result.counts.population.kind === 'exact' && scope.filteredTotal > result.counts.population.value))
  ) {
    return failure('count', 'Scope.filteredTotal must be a safe count at least as large as loaded rows.');
  }
  return { ok: true, value: undefined };
}

function validateScopeDigest(scope: VarendoDataScope, populationDigest: string | undefined): Outcome<void> {
  if (scope.populationDigest !== undefined && populationDigest !== scope.populationDigest) {
    return failure('scope', 'Scope.populationDigest must match the Result population digest.');
  }
  return { ok: true, value: undefined };
}

function validateScopeKind(scope: VarendoDataScope, canonical: VarendoDataScope): Outcome<void> {
  if (scope.kind !== undefined && scope.kind !== canonical.kind) {
    return failure('scope', 'Scope.kind must match the Result coverage state.');
  }
  return { ok: true, value: undefined };
}

function validateScopeLabel(scope: VarendoDataScope): Outcome<void> {
  if (scope.label !== undefined && !boundedText(scope.label, 'scope.label').ok) {
    return failure('scope', 'Scope.label must be bounded text.');
  }
  return { ok: true, value: undefined };
}

function validateScopeValues(
  scope: VarendoDataScope,
  result: Result,
  rows: readonly VarendoDataRecord[],
  canonical: CanonicalScopeParts,
): Outcome<void> {
  const keys = validateScopeKeys(scope);
  if (!keys.ok) return keys;
  const loaded = validateLoadedCount(scope, rows);
  if (!loaded.ok) return loaded;
  const population = validatePopulationTotalMatch(scope, result);
  if (!population.ok) return population;
  const digest = validateScopeDigest(scope, canonical.populationDigest);
  if (!digest.ok) return digest;
  const filtered = validateFilteredTotal(scope, result, rows);
  if (!filtered.ok) return filtered;
  const loadedSafe = validateLoadedSafeCount(scope);
  if (!loadedSafe.ok) return loadedSafe;
  const populationSafe = validatePopulationTotalSafeCount(scope);
  if (!populationSafe.ok) return populationSafe;
  const kind = validateScopeKind(scope, canonical.value);
  if (!kind.ok) return kind;
  const label = validateScopeLabel(scope);
  if (!label.ok) return label;
  return { ok: true, value: undefined };
}

function validateProvidedScope(
  scope: unknown,
  result: Result,
  rows: readonly VarendoDataRecord[],
  canonical: CanonicalScopeParts,
): Outcome<VarendoDataScope> {
  if (!validScopeShape(scope)) return failure('scope', 'Scope must be a plain object.');
  const checked = validateScopeValues(scope, result, rows, canonical);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: {
      ...canonical.value,
      ...(scope.filteredTotal === undefined ? {} : { filteredTotal: scope.filteredTotal }),
      ...(scope.label === undefined ? {} : { label: scope.label }),
      loaded: rows.length,
    },
  };
}

function validateScope(
  result: Result,
  rows: readonly VarendoDataRecord[],
  scope: VarendoDataScope | undefined,
): Outcome<VarendoDataScope> {
  try {
    const canonical = canonicalScopeParts(result, rows);
    if (!canonical.ok) return canonical;
    if (scope === undefined) return { ok: true, value: canonical.value.value };
    return validateProvidedScope(scope, result, rows, canonical.value);
  } catch {
    return failure('scope', 'Scope validation failed.');
  }
}

function normalizeFieldValue(
  row: Readonly<Record<string, unknown>>,
  field: Result['fields'][number],
): Outcome<VarendoDataValue | undefined> {
  const value = row[field.id];
  if (value === undefined) {
    if (!field.type.nullable) {
      return failure('field', `Authorized row is missing non-nullable field ${field.id}.`);
    }
    return { ok: true, value: undefined };
  }
  const checked = validateScalar(value, field.type);
  if (!checked.ok) {
    return failure('field', `Authorized row field ${field.id} does not match the Result semantic type.`);
  }
  return { ok: true, value: checked.value };
}

function normalizeRow(
  row: unknown,
  result: Result,
  fields: ReadonlyMap<string, Result['fields'][number]>,
): Outcome<VarendoDataRecord> {
  if (!isPlainRecord(row)) return failure('row', 'Authorized rows must be plain records.');
  try {
    for (const key of Object.keys(row)) {
      if (!fields.has(key)) return failure('field', `Authorized row contains undeclared field ${key}.`);
    }
    const normalized: Record<string, VarendoDataValue> = {};
    for (const field of result.fields) {
      const checked = normalizeFieldValue(row, field);
      if (!checked.ok) return checked;
      if (checked.value !== undefined) normalized[field.id] = checked.value;
    }
    return { ok: true, value: Object.freeze(normalized) };
  } catch {
    return failure('row', 'Authorized row access failed validation.');
  }
}

function normalizeRows(rows: readonly VarendoDataRecord[], result: Result): Outcome<readonly VarendoDataRecord[]> {
  const fields = fieldMap(result);
  const identities = new Set<string>();
  const normalizedRows: VarendoDataRecord[] = [];
  for (const row of rows) {
    const normalized = normalizeRow(row, result, fields);
    if (!normalized.ok) return normalized;
    const identity = rowIdentity(normalized.value, result);
    if (!identity.ok) return identity;
    if (identities.has(identity.value)) {
      return failure('identity', 'Authorized rows contain duplicate identity tuples.');
    }
    identities.add(identity.value);
    normalizedRows.push(normalized.value);
  }
  return { ok: true, value: normalizedRows };
}

function parseBinding(binding: VarendoDataBinding): Outcome<ParsedDataBinding> {
  const inspected = parseWireValue(binding);
  if (!inspected.ok || !isPlainRecord(inspected.value)) {
    return failure('binding', 'A data binding is required.');
  }
  const wireBinding = inspected.value as unknown as VarendoDataBinding;
  if (wireBinding.result === null || typeof wireBinding.result !== 'object') {
    return failure('binding', 'The authorized Result descriptor is malformed.');
  }
  const parsedResult = parseResult(wireBinding.result);
  if (!parsedResult.ok) {
    return failure('binding', 'The authorized Result descriptor is not a valid core Result.');
  }
  if (!Array.isArray(wireBinding.rows)) return failure('binding', 'Authorized rows must be an array.');
  return {
    ok: true,
    value: {
      result: parsedResult.value,
      rows: wireBinding.rows,
      ...(wireBinding.columns === undefined ? {} : { columns: wireBinding.columns }),
      ...(wireBinding.scope === undefined ? {} : { scope: wireBinding.scope }),
    },
  };
}

function validateRowLimit(
  rows: readonly VarendoDataRecord[],
  result: Result,
  options: VarendoDataRegistryOptions,
): Outcome<void> {
  const maxRows = options.maxRows ?? 10_000;
  if (!Number.isSafeInteger(maxRows) || maxRows < 0 || maxRows > 10_000 || rows.length > maxRows) {
    return failure('count', 'Authorized rows exceed the bounded data view limit.');
  }
  if (rows.length !== result.counts.loaded) {
    return failure('count', 'The supplied row count must equal Result.counts.loaded.');
  }
  return { ok: true, value: undefined };
}

function validateBinding(
  binding: VarendoDataBinding,
  options: VarendoDataRegistryOptions,
): Outcome<VarendoValidatedBinding> {
  const parsed = parseBinding(binding);
  if (!parsed.ok) return parsed;
  const limit = validateRowLimit(parsed.value.rows, parsed.value.result, options);
  if (!limit.ok) return limit;
  const rows = normalizeRows(parsed.value.rows, parsed.value.result);
  if (!rows.ok) return rows;
  const checkedColumns = columns({}, parsed.value.result, parsed.value.columns);
  if (!checkedColumns.ok) return checkedColumns;
  const scope = validateScope(parsed.value.result, rows.value, parsed.value.scope);
  if (!scope.ok) return scope;
  return {
    ok: true,
    value: {
      result: parsed.value.result,
      rows: rows.value,
      columns: checkedColumns.value.map((column) => Object.freeze({ ...column })),
      scope: scope.value,
    },
  };
}

export function validateVarendoDataBinding(
  binding: VarendoDataBinding,
  options: VarendoDataRegistryOptions = {},
): Outcome<VarendoValidatedBinding> {
  return validateBinding(binding, options);
}
