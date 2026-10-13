import type { Outcome, Result, Task } from '@varendo/core';
import type { PresentationValues, ResolvedPresentationConfig } from '@varendo/core/presentation';
import { VARENDO_OPERATION_REFS } from './registry-contracts.js';
import type { VarendoPresentationRegistryOptions } from './registry-contracts.js';
import { fail, fieldMap, record, text, trustedEntity } from './registry-config-common.js';

export function filterConfig(
  values: PresentationValues,
  result: Result | undefined,
  resolveEntity: VarendoPresentationRegistryOptions['resolveEntity'],
): Outcome<ResolvedPresentationConfig> {
  const input = record(values);
  if (input === undefined) return fail('config', 'The filter configuration must be an object.');
  if (Object.keys(input).some((key) => key !== 'field' && key !== 'outputId'))
    return fail('config', 'The filter configuration contains an unknown field.');
  const field = text(input.field, 'field');
  if (!field.ok) return field;
  const outputId = text(input.outputId, 'outputId');
  if (!outputId.ok) return outputId;
  if (result === undefined) return fail('binding', 'A filter requires a bound authorized result.');
  const descriptor = fieldMap(result).get(field.value);
  if (descriptor === undefined) return fail('field', 'The filter field is absent from the bound result.');
  if (descriptor.type.value !== 'text') return fail('field', 'Filter controls accept only text result fields.');
  if (outputId.value !== result.ref.outputId)
    return fail('binding', 'The filter output must match the bound authorized result.');
  const owner = trustedEntity(result, resolveEntity);
  if (!owner.ok) return owner;
  return filterPresentation(field.value, outputId.value, owner.value);
}

function filterPresentation(
  field: string,
  outputId: string,
  entity: string | undefined,
): Outcome<ResolvedPresentationConfig> {
  const values: Record<string, unknown> = {
    field,
    outputId,
    ...(entity === undefined ? {} : { entity }),
  };
  return {
    ok: true,
    value: {
      values: values as PresentationValues,
      fields: [field],
      ports: [{ id: 'filter', direction: 'output', payload: 'filter' }],
      operations: [VARENDO_OPERATION_REFS.filter],
    },
  };
}

export function suggestTable(needs: readonly Task['needs'][number][]): Outcome<PresentationValues> {
  const selection = needs.some(isSelectionNeed) ? 'single' : 'none';
  return { ok: true, value: { selection } };
}

function isSelectionNeed(need: Task['needs'][number]): boolean {
  return (
    need.operation.id === VARENDO_OPERATION_REFS.selection.id &&
    need.operation.revision === VARENDO_OPERATION_REFS.selection.revision
  );
}

export function suggestFilter(
  needs: readonly Task['needs'][number][],
  result: Result | undefined,
): Outcome<PresentationValues> {
  const firstNeed = needs[0];
  const field = firstNeed?.fields[0] ?? result?.fields[0]?.id;
  const outputId = firstNeed?.outputId ?? result?.ref.outputId;
  if (field === undefined || outputId === undefined)
    return fail('suggestion', 'A filter suggestion requires a named field and output.');
  return { ok: true, value: { field, outputId } };
}
