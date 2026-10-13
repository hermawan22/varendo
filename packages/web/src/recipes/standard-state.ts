import type { VersionRef } from '@varendo/core';
import type { PresentationStateMappingManifest } from '@varendo/core/presentation';
import { VARENDO_PRESENTATION_REFS } from '../region/registry.js';
import { VARENDO_DATA_REFS } from '../region/data-registry.js';

export const STANDARD_STATE_MAPPINGS: readonly PresentationStateMappingManifest[] = Object.freeze([
  {
    ref: { id: 'varendo.web.table-to-cards', revision: '1' },
    from: VARENDO_PRESENTATION_REFS.table,
    to: VARENDO_DATA_REFS.cardCollection,
    fromRole: 'table',
    toRole: 'cardCollection',
    kind: 'transfer',
  },
  {
    ref: { id: 'varendo.web.cards-to-table', revision: '1' },
    from: VARENDO_DATA_REFS.cardCollection,
    to: VARENDO_PRESENTATION_REFS.table,
    fromRole: 'cardCollection',
    toRole: 'table',
    kind: 'transfer',
  },
]);

function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}

export function standardStateMapping(from: VersionRef, to: VersionRef): PresentationStateMappingManifest | undefined {
  return STANDARD_STATE_MAPPINGS.find((mapping) => sameRef(mapping.from, from) && sameRef(mapping.to, to));
}
