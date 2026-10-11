import type { VersionRef } from '@varendo/core';
import type { PresentationStateMappingManifest } from '@varendo/core/presentation';
import { AELIQO_PRESENTATION_REFS } from '../region/registry.js';
import { AELIQO_DATA_REFS } from '../region/data-registry.js';

export const STANDARD_STATE_MAPPINGS: readonly PresentationStateMappingManifest[] = Object.freeze([
  {
    ref: { id: 'aeliqo.web.table-to-cards', revision: '1' },
    from: AELIQO_PRESENTATION_REFS.table,
    to: AELIQO_DATA_REFS.cardCollection,
    fromRole: 'table',
    toRole: 'cardCollection',
    kind: 'transfer',
  },
  {
    ref: { id: 'aeliqo.web.cards-to-table', revision: '1' },
    from: AELIQO_DATA_REFS.cardCollection,
    to: AELIQO_PRESENTATION_REFS.table,
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
