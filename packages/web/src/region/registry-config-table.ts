import type { Outcome, Result, VersionRef } from '@varendo/core';
import type { PresentationValues, ResolvedPresentationConfig } from '@varendo/core/presentation';
import type { AeliqoPresentationRegistryOptions } from './registry-contracts.js';
import { AELIQO_OPERATION_REFS } from './registry-contracts.js';
import { allowedKeys } from './data-registry-common.js';
import {
  columns,
  defaultTableConfig,
  fail,
  hasFrozenFieldIds,
  identity,
  record,
  selectionPort,
} from './registry-config-common.js';

type TableSelection = 'none' | 'single' | 'multiple';
type TableColumns = readonly { readonly key: string; readonly label: string }[];

interface ValidatedTableInput {
  readonly input: Record<string, unknown>;
  readonly columns: TableColumns | undefined;
  readonly selection: TableSelection;
  readonly isDefault: boolean;
}

export function tableConfig(
  values: PresentationValues,
  result: Result | undefined,
  resolveEntity: AeliqoPresentationRegistryOptions['resolveEntity'],
  defaultConfigs: WeakMap<Result, Outcome<ResolvedPresentationConfig>>,
): Outcome<ResolvedPresentationConfig> {
  if (result === undefined) return fail('binding', 'A table requires a bound result.');
  const parsed = validatedTableInput(values, result);
  if (!parsed.ok) return parsed;
  const { input, columns: columnList, selection, isDefault } = parsed.value;
  if (isDefault) {
    const cached = defaultConfigs.get(result);
    if (cached !== undefined) return cached;
  }
  const identityFields = configuredIdentity(input, result);
  if (!identityFields.ok) return identityFields;
  const port = selectionPort(input, result, 'selection', resolveEntity);
  if (!port.ok) return port;
  const output = tableValues(columnList, selection, identityFields.value);
  const fields = tableFields(columnList, result);
  if (isDefault && hasFrozenFieldIds(result)) {
    const outcome = defaultTableConfig(output, fields, defaultOperations());
    defaultConfigs.set(result, outcome);
    return outcome;
  }
  return {
    ok: true,
    value: { values: output as PresentationValues, fields, ports: port.value, operations: tableOperations(selection) },
  };
}

function validatedTableInput(values: PresentationValues, result: Result): Outcome<ValidatedTableInput> {
  const input = record(values);
  if (input === undefined) return fail('config', 'The table configuration must be an object.');
  if (!allowedKeys(input, ['columns', 'identity', 'selection']))
    return fail('config', 'The table configuration contains an unknown field.');
  const columnList = input.columns === undefined ? undefined : columns(input, result);
  if (columnList !== undefined && !columnList.ok) return columnList;
  const selection = tableSelection(input);
  if (!selection.ok) return selection;
  return {
    ok: true,
    value: {
      input,
      columns: columnList?.value,
      selection: selection.value,
      isDefault: input.columns === undefined && input.identity === undefined && selection.value === 'none',
    },
  };
}

function tableSelection(input: Record<string, unknown>): Outcome<TableSelection> {
  const selection = input.selection ?? 'none';
  if (selection === 'none' || selection === 'single' || selection === 'multiple') return { ok: true, value: selection };
  return fail('config', 'selection must be none, single or multiple.');
}

function configuredIdentity(input: Record<string, unknown>, result: Result): Outcome<readonly string[] | undefined> {
  if (input.identity === undefined) return { ok: true, value: undefined };
  return identity(input, result);
}

function tableValues(
  columnList: TableColumns | undefined,
  selection: TableSelection,
  identityFields: readonly string[] | undefined,
): Record<string, unknown> {
  return {
    ...(columnList === undefined ? {} : { columns: columnList }),
    selection,
    ...(identityFields === undefined ? {} : { identity: identityFields }),
  };
}

function tableFields(columnList: TableColumns | undefined, result: Result): readonly string[] {
  if (columnList === undefined) return result.fields.map((field) => field.id);
  return columnList.map((column) => column.key);
}

function defaultOperations(): readonly VersionRef[] {
  return [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze];
}

function tableOperations(selection: TableSelection): readonly VersionRef[] {
  if (selection === 'none') return defaultOperations();
  return [...defaultOperations(), AELIQO_OPERATION_REFS.selection];
}
