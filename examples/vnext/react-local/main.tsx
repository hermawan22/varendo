import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdaptiveSurface, useDataSurface, useSurfaceState } from '../../../packages/react/src/surface/index.js';
import type { Intent } from '@varendo/core';
import type { LocalBrowseState, SurfaceController } from '@varendo/runtime/surfaces';

type Person = { id: string; name: string; team: string };
const initial: Person[] = [
  { id: 'ada', name: 'Ada Chen', team: 'Design' },
  { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
];

function SourceProbe({
  surface,
}: {
  readonly surface: SurfaceController<Intent, LocalBrowseState>;
}): React.JSX.Element {
  const snapshot = useSurfaceState(surface, (current) => current);
  return (
    <>
      <output data-testid="source-state">
        {snapshot.phase}:{snapshot.state.rows.length}
      </output>
      <output data-testid="surface-revision">{snapshot.revision}</output>
    </>
  );
}

function People(): React.JSX.Element {
  const [rows, setRows] = useState<Person[]>(new URLSearchParams(location.search).has('empty') ? [] : initial);
  const [version, setVersion] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const surface = useDataSurface({ data: rows, version, getRowId: (row) => row.id });
  return (
    <main>
      <h1>People</h1>
      <button type="button" onClick={() => setRows([{ id: 'ada', name: 'Ada Chen', team: 'Engineering' }])}>
        Update people
      </button>
      <button type="button" onClick={() => setRows([])}>
        Clear people
      </button>
      <button type="button" onClick={() => setRows([...initial])}>
        Restore people
      </button>
      <button type="button" onClick={() => setRows(initial)}>
        Restore original
      </button>
      <button type="button" onClick={() => setNarrow(true)}>
        Narrow host
      </button>
      <button
        type="button"
        onClick={() =>
          setRows([
            { id: 'ada', name: 'First duplicate', team: 'Design' },
            { id: 'ada', name: 'Second duplicate', team: 'Design' },
          ])
        }
      >
        Invalid update
      </button>
      <button
        type="button"
        onClick={() => {
          rows[1]!.team = 'Support';
          setVersion((current) => current + 1);
        }}
      >
        Signal same-reference update
      </button>
      <p data-testid="surface-address">{surface.controller?.address.surfaceId ?? 'pending'}</p>
      {surface.controller === undefined ? null : <SourceProbe surface={surface.controller} />}
      <div style={{ width: narrow ? 360 : 800, maxWidth: '100%' }}>
        <AdaptiveSurface surface={surface} />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <People />
  </StrictMode>,
);
