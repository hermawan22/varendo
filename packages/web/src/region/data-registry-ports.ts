import type { Outcome, Result } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { AeliqoSelectionMode } from '../data/index.js';
import type { AeliqoDataRegistryOptions } from './data-registry-types.js';
import { boundedText, failure } from './data-registry-common.js';

function trustedEntity(
  result: Result,
  options: AeliqoDataRegistryOptions,
  required: boolean,
): Outcome<string | undefined> {
  if (options.resolveEntity === undefined) {
    if (required) return failure('binding', 'Selectable data views require a trusted entity resolver.');
    return { ok: true, value: undefined };
  }
  let entity: string | undefined;
  try {
    entity = options.resolveEntity(result);
  } catch {
    return failure('binding', 'The trusted entity resolver failed.');
  }
  if (entity === undefined) {
    if (required) return failure('binding', 'The authorized Result has no trusted entity binding.');
    return { ok: true, value: undefined };
  }
  return boundedText(entity, 'entity');
}

export function selectionPort(
  mode: AeliqoSelectionMode,
  result: Result,
  identity: readonly string[],
  options: AeliqoDataRegistryOptions,
): Outcome<readonly InteractionPort[]> {
  if (mode === 'none') return { ok: true, value: [] };
  const entity = trustedEntity(result, options, true);
  if (!entity.ok) return entity;
  return {
    ok: true,
    value: [
      {
        id: 'selection',
        direction: 'inout',
        payload: 'selection',
        entity: entity.value!,
        identity: [...identity],
        grain: [...result.rowGrain],
      },
    ],
  };
}

export function selectionSummaryEntity(
  result: Result,
  options: AeliqoDataRegistryOptions,
): Outcome<string | undefined> {
  return trustedEntity(result, options, false);
}

export function filterPort(): readonly InteractionPort[] {
  return [{ id: 'filter', direction: 'output', payload: 'filter' }];
}

export function paginationPort(input: Readonly<Record<string, unknown>>): readonly InteractionPort[] {
  if (input.page !== true) return [];
  return [{ id: 'page', direction: 'output', payload: 'page' }];
}
