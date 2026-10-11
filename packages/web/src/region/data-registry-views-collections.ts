import type { Outcome } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { AeliqoDataColumn, AeliqoFilterPredicate } from '../data/index.js';
import { scopeText } from '../data/shared.js';
import type {
  AeliqoDataRegistryOptions,
  AeliqoDataResolvedConfig,
  AeliqoValidatedBinding,
} from './data-registry-types.js';
import { columns } from './data-registry-columns.js';
import { filterPredicate, isEditableFilterPredicate } from './data-registry-filters.js';
import {
  allowedKeys,
  boundedText,
  commonConfig,
  failure,
  fieldMap,
  identityFields,
  selection,
  validFieldList,
} from './data-registry-common.js';
import { filterPort, paginationPort, selectionPort, selectionSummaryEntity } from './data-registry-ports.js';

type CollectionKind = 'recordList' | 'cardCollection' | 'table';
type SelectionMode = 'none' | 'single' | 'multiple';

function collectionKeys(kind: CollectionKind): readonly string[] {
  if (kind === 'cardCollection') return ['columns', 'identity', 'selection', 'page', 'headingKey'];
  return ['columns', 'identity', 'selection', 'page', 'mode', 'virtualStart', 'virtualized'];
}

function validatePageOption(input: Readonly<Record<string, unknown>>): Outcome<void> {
  if (input.page !== undefined && typeof input.page !== 'boolean') {
    return failure('config', 'page must be boolean when provided.');
  }
  return { ok: true, value: undefined };
}

function validateHeadingKey(input: Readonly<Record<string, unknown>>, binding: AeliqoValidatedBinding): Outcome<void> {
  if (input.headingKey === undefined) return { ok: true, value: undefined };
  const heading = boundedText(input.headingKey, 'headingKey');
  if (!heading.ok) return heading;
  if (!binding.result.fields.some((field) => field.id === heading.value)) {
    return failure('field', 'headingKey must name an authorized Result field.');
  }
  return { ok: true, value: undefined };
}

function validateTableOptions(input: Readonly<Record<string, unknown>>): Outcome<void> {
  if (input.mode !== undefined && input.mode !== 'table' && input.mode !== 'grid') {
    return failure('config', 'table mode must be table or grid.');
  }
  if (input.virtualized !== undefined && typeof input.virtualized !== 'boolean') {
    return failure('config', 'table virtualized must be boolean.');
  }
  if (
    input.virtualStart !== undefined &&
    (!Number.isSafeInteger(input.virtualStart) || (input.virtualStart as number) < 0)
  ) {
    return failure('config', 'table virtualStart must be a safe nonnegative integer.');
  }
  return { ok: true, value: undefined };
}

function validateCollectionOptions(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
  kind: CollectionKind,
): Outcome<void> {
  if (!allowedKeys(input, collectionKeys(kind))) {
    return failure('config', `${kind} configuration contains an unknown property.`);
  }
  const page = validatePageOption(input);
  if (!page.ok) return page;
  if (kind === 'cardCollection') return validateHeadingKey(input, binding);
  if (kind === 'table') return validateTableOptions(input);
  return { ok: true, value: undefined };
}

export function resolveCollection(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
  options: AeliqoDataRegistryOptions,
  kind: CollectionKind,
): Outcome<AeliqoDataResolvedConfig> {
  const optionsCheck = validateCollectionOptions(input, binding, kind);
  if (!optionsCheck.ok) return optionsCheck;
  const identity = identityFields(input, binding.result);
  if (!identity.ok) return identity;
  const resolvedColumns = columns(input, binding.result, binding.columns);
  if (!resolvedColumns.ok) return resolvedColumns;
  const mode = selection(input);
  if (!mode.ok) return mode;
  const ports = selectionPort(mode.value, binding.result, identity.value, options);
  if (!ports.ok) return ports;
  return {
    ok: true,
    value: commonConfig(
      input,
      {
        fields: resolvedColumns.value.map((column) => column.key),
        columns: resolvedColumns.value,
        identity: identity.value,
        selection: mode.value,
      },
      [...ports.value, ...paginationPort(input)],
    ),
  };
}

function filterFields(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<readonly string[]> {
  if (input.field !== undefined && input.fields !== undefined) {
    return failure('config', 'FilterBuilder must use either field or fields, not both.');
  }
  let rawFields = input.fields;
  if (rawFields === undefined || rawFields === null) {
    rawFields = input.field === undefined ? undefined : [input.field];
  }
  return validFieldList(rawFields, binding.result, 'fields');
}

function parseFilterState(
  raw: unknown,
  binding: AeliqoValidatedBinding,
  fields: readonly string[],
  initial: boolean,
): Outcome<AeliqoFilterPredicate | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const predicate = filterPredicate(raw, binding.result, fields);
  if (!predicate.ok) return predicate;
  if (initial && !isEditableFilterPredicate(predicate.value)) {
    return failure('unsupported', 'The initial filter predicate cannot be represented by the editable filter builder.');
  }
  return { ok: true, value: predicate.value };
}

function authorizedScopeLabel(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<string> {
  const label = scopeText(binding.scope) ?? 'Current authorized scope';
  if (input.scopeLabel === undefined) return { ok: true, value: label };
  const supplied = boundedText(input.scopeLabel, 'scopeLabel');
  if (!supplied.ok) return supplied;
  if (supplied.value !== label) return failure('scope', 'scopeLabel must match the authorized Result scope.');
  return { ok: true, value: label };
}

function filterBuilderColumns(fields: readonly string[], binding: AeliqoValidatedBinding): readonly AeliqoDataColumn[] {
  const descriptors = fieldMap(binding.result);
  return fields.map((id) => {
    const descriptor = descriptors.get(id)!;
    return { key: id, label: descriptor.label, type: descriptor.type.value };
  });
}

export function resolveFilterBuilder(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
): Outcome<AeliqoDataResolvedConfig> {
  if (!allowedKeys(input, ['field', 'fields', 'outputId', 'predicate', 'inherited', 'scopeLabel'])) {
    return failure('config', 'FilterBuilder configuration contains an unknown property.');
  }
  const outputId = boundedText(input.outputId, 'outputId');
  if (!outputId.ok) return outputId;
  if (outputId.value !== binding.result.ref.outputId) {
    return failure('binding', 'FilterBuilder outputId must match the exact authorized ResultRef.');
  }
  const fields = filterFields(input, binding);
  if (!fields.ok) return fields;
  const predicate = parseFilterState(input.predicate, binding, fields.value, true);
  if (!predicate.ok) return predicate;
  const inherited = parseFilterState(input.inherited, binding, fields.value, false);
  if (!inherited.ok) return inherited;
  const label = authorizedScopeLabel(input, binding);
  if (!label.ok) return label;
  const normalized: Record<string, unknown> = {
    fields: fields.value,
    outputId: outputId.value,
    ...(predicate.value === undefined ? {} : { predicate: predicate.value }),
    ...(inherited.value === undefined ? {} : { inherited: inherited.value }),
    scopeLabel: label.value,
  };
  return {
    ok: true,
    value: commonConfig(
      normalized,
      {
        fields: fields.value,
        columns: filterBuilderColumns(fields.value, binding),
        identity: binding.result.identity,
        selection: 'none',
      },
      filterPort(),
    ),
  };
}

function summarySelectionMode(input: Readonly<Record<string, unknown>>): Outcome<SelectionMode> {
  if (input.selection === undefined) return { ok: true, value: 'multiple' };
  return selection(input);
}

function summaryPorts(
  mode: SelectionMode,
  identity: readonly string[],
  binding: AeliqoValidatedBinding,
  options: AeliqoDataRegistryOptions,
): Outcome<readonly InteractionPort[]> {
  if (mode === 'none') return { ok: true, value: [] };
  return selectionPort(mode, binding.result, identity, options);
}

export function resolveSelectionSummary(
  input: Readonly<Record<string, unknown>>,
  binding: AeliqoValidatedBinding,
  options: AeliqoDataRegistryOptions,
): Outcome<AeliqoDataResolvedConfig> {
  if (!allowedKeys(input, ['identity', 'entity', 'clearable', 'selection'])) {
    return failure('config', 'SelectionSummary configuration contains an unknown property.');
  }
  const identity = identityFields(input, binding.result);
  if (!identity.ok) return identity;
  const entity = selectionSummaryEntity(binding.result, options);
  if (!entity.ok) return entity;
  if (input.entity !== undefined && (entity.value === undefined || input.entity !== entity.value)) {
    return failure('binding', 'SelectionSummary entity must use the trusted entity binding.');
  }
  const mode = summarySelectionMode(input);
  if (!mode.ok) return mode;
  const ports = summaryPorts(mode.value, identity.value, binding, options);
  if (!ports.ok) return ports;
  return {
    ok: true,
    value: commonConfig(
      input,
      {
        fields: [],
        columns: [],
        identity: identity.value,
        selection: mode.value,
      },
      ports.value,
    ),
  };
}
