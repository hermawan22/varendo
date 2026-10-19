import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Intent } from '@varendo/core';
import type { ScopeController, ScopeSnapshot, SurfaceController, SurfaceSnapshot } from '@varendo/runtime';
import { VarendoScope, useVarendoScopeState, useSurfaceState } from '../../../packages/react/src/surface/index.js';

type State = { readonly rows: readonly string[] };

function testStore<T>(initial: T) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change(next: T) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

const surfaceStore = testStore<SurfaceSnapshot<Intent, State>>({
  id: 'test',
  address: { runtimeId: 'test', scopeInstanceId: 'test', activationEpoch: 1, surfaceId: 'test', surfaceGeneration: 1 },
  revision: '1',
  phase: 'ready',
  intent: { kind: 'browse', version: '1', id: 'browse', resource: 'test' },
  state: { rows: ['ada'] },
});
const scopeStore = testStore<ScopeSnapshot>({
  runtimeId: 'test',
  scopeInstanceId: 'test',
  activationEpoch: 1,
  active: true,
  permissionRevision: 1,
  status: 'active',
  selector: { kind: 'workspace', id: 'acme' },
  revision: '1',
});
const surface = surfaceStore as unknown as SurfaceController<Intent, State>;
const scope = { ...scopeStore, attach: () => () => undefined } as unknown as ScopeController;
let surfaceRenders = 0;
let scopeRenders = 0;
let primitiveRenders = 0;
let referenceRenders = 0;

function PrimitiveProbe(): React.JSX.Element {
  const selected = useSurfaceState(surface, (snapshot) => snapshot.phase);
  primitiveRenders += 1;
  return <output data-testid="primitive-selection">{`${selected}:${primitiveRenders}`}</output>;
}

function ReferenceProbe(): React.JSX.Element {
  const selected = useSurfaceState(surface, (snapshot) => snapshot.state.rows);
  referenceRenders += 1;
  return <output data-testid="reference-selection">{`${selected.join(',')}:${referenceRenders}`}</output>;
}

function SurfaceProbe(): React.JSX.Element {
  const selected = useSurfaceState(surface, (snapshot) => ({ people: snapshot.state.rows }));
  surfaceRenders += 1;
  return <output data-testid="surface-selection">{`${selected.people.join(',')}:${surfaceRenders}`}</output>;
}

function ScopeProbe(): React.JSX.Element {
  const selected = useVarendoScopeState((snapshot) => [snapshot.selector?.id ?? 'none']);
  scopeRenders += 1;
  return <output data-testid="scope-selection">{`${selected.join(',')}:${scopeRenders}`}</output>;
}

function App(): React.JSX.Element {
  const [parentVersion, setParentVersion] = useState(0);
  return (
    <main>
      <h1>Selector stability</h1>
      <button type="button" onClick={() => setParentVersion((value) => value + 1)}>
        Parent render
      </button>
      <button
        type="button"
        onClick={() => surfaceStore.change({ ...surfaceStore.getSnapshot(), revision: 'unrelated' })}
      >
        Unrelated surface
      </button>
      <button type="button" onClick={() => scopeStore.change({ ...scopeStore.getSnapshot(), revision: 'unrelated' })}>
        Unrelated scope
      </button>
      <button
        type="button"
        onClick={() =>
          surfaceStore.change({
            ...surfaceStore.getSnapshot(),
            revision: 'relevant',
            state: { rows: ['ada', 'sam'] },
          })
        }
      >
        Relevant surface
      </button>
      <button
        type="button"
        onClick={() =>
          scopeStore.change({
            ...scopeStore.getSnapshot(),
            revision: 'relevant',
            selector: { kind: 'workspace', id: 'globex' },
          })
        }
      >
        Relevant scope
      </button>
      <p data-testid="parent-version">{parentVersion}</p>
      <PrimitiveProbe />
      <ReferenceProbe />
      <SurfaceProbe />
      <VarendoScope scope={scope}>
        <ScopeProbe />
      </VarendoScope>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
