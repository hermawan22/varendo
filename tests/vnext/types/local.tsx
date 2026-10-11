/**
 * DECLARATION-ONLY DESIGN CONSUMER, NOT AELIQO IMPLEMENTATION.
 * This fixture describes the providerless local/no-AI adoption path.
 */
import type { ReactElement } from 'react';
import { AdaptiveSurface, useDataSurface, useSurfaceState } from '../api-contract.js';

interface Person {
  readonly id: string;
  readonly name: string;
  readonly team: 'Design' | 'Engineering';
}

export function LocalPeople({ rows }: { readonly rows: readonly Person[] }): ReactElement {
  const surface = useDataSurface({
    id: 'people-local',
    data: rows,
    getRowId: (row) => row.id,
  });
  const visibleRows = useSurfaceState(surface, (snapshot) => snapshot.state.rows);
  void visibleRows;
  void surface.request({ kind: 'browse' });

  return <AdaptiveSurface surface={surface} />;
}
