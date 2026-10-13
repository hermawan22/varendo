import React, { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { defineFeature, type FeatureIntentValue } from '@varendo/core/features';
import type { CapabilitySurfaceBindings, SurfaceController } from '@varendo/runtime/surfaces';
import { VarendoProvider } from '../../../packages/react/src/app/index.js';
import {
  VarendoScope,
  useVarendoScopeState,
  useSurface,
  useSurfaceState,
} from '../../../packages/react/src/surface/index.js';
import { createScopeFixture } from '../../../tests/vnext/fixtures/scope.js';

const fixture = await createScopeFixture();
let scopeListeners = 0;
const originalScopeSubscribe = fixture.scope.subscribe.bind(fixture.scope);
fixture.scope.subscribe = (listener) => {
  scopeListeners += 1;
  const release = originalScopeSubscribe(listener);
  const label = document.getElementById('scope-listeners');
  if (label !== null) label.textContent = String(scopeListeners);
  return () => {
    release();
    scopeListeners -= 1;
    const current = document.getElementById('scope-listeners');
    if (current !== null) current.textContent = String(scopeListeners);
  };
};
const readRef = { id: 'orders.read', revision: '1' } as const;
const openRef = { id: 'orders.open', revision: '1' } as const;
const feature = defineFeature({
  id: 'react-orders',
  capabilities: [{ ref: readRef, kind: 'read', schema: z.object({}) }],
  intents: [{ ref: openRef, schema: z.object({}), capabilities: [readRef] }],
});
type OrdersIntent = FeatureIntentValue<typeof feature.intents>;
type OrdersState = { readonly workspace: string; readonly epoch: number };
const open: OrdersIntent = { intent: openRef, input: {} };
let firstA: SurfaceController<OrdersIntent, OrdersState> | undefined;
let currentSurface: SurfaceController<OrdersIntent, OrdersState> | undefined;
let nextRead: { readonly complete: Promise<void>; release(): void; start(): void } | undefined;
let activeRead: typeof nextRead;

function holdRead(): Promise<void> {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((done) => {
    start = done;
  });
  const complete = new Promise<void>((done) => {
    release = done;
  });
  nextRead = { start, complete, release };
  return started;
}

function SurfacePhase({
  surface,
}: {
  readonly surface: SurfaceController<OrdersIntent, OrdersState>;
}): React.JSX.Element {
  const phase = useSurfaceState(surface, (snapshot) => snapshot.phase);
  return <p data-testid="surface-phase">{phase}</p>;
}

function ScopedOrders({ surfaceId }: { readonly surfaceId: string }): React.JSX.Element {
  const workspace = useVarendoScopeState((snapshot) => snapshot.selector?.id ?? '');
  const epoch = useVarendoScopeState((snapshot) => snapshot.activationEpoch);
  const pending = useVarendoScopeState((snapshot) => snapshot.pending?.selector.id ?? '');
  const bindings = useMemo<CapabilitySurfaceBindings<OrdersIntent, OrdersState>>(
    () => ({
      initialIntent: open,
      initialState: { workspace: '', epoch: 0 },
      source: {
        kind: 'capability',
        read: async (_intent, context) => {
          const held = nextRead;
          if (held !== undefined) {
            nextRead = undefined;
            activeRead = held;
            held.start();
            await held.complete;
            activeRead = undefined;
          }
          return { workspace, epoch: context.scope.activationEpoch };
        },
      },
    }),
    [workspace, epoch],
  );
  const surface = useSurface(feature, { id: surfaceId, bindings });
  useEffect(() => {
    currentSurface = surface;
    if (workspace === 'acme' && epoch === 1 && surface !== undefined && firstA === undefined) firstA = surface;
    return () => {
      if (currentSurface === surface) currentSurface = undefined;
    };
  }, [workspace, epoch, surface]);
  return (
    <section>
      <p data-testid="selector">{workspace}</p>
      <p data-testid="surface-epoch">{surface?.address.activationEpoch ?? 'pending'}</p>
      <p data-testid="surface-id">{surface?.address.surfaceId ?? 'pending'}</p>
      <p data-testid="surface-generation">{surface?.address.surfaceGeneration ?? 'pending'}</p>
      {surface !== undefined && <SurfacePhase surface={surface} />}
      <p data-testid="pending">{pending}</p>
      <input aria-label="Scoped draft" defaultValue="" />
    </section>
  );
}

function App(): React.JSX.Element {
  const [mounted, setMounted] = useState(true);
  const [oldResult, setOldResult] = useState('');
  const [readResult, setReadResult] = useState('');
  const [readStarted, setReadStarted] = useState('idle');
  const [surfaceId, setSurfaceId] = useState('react-orders');
  const [guard, setGuard] = useState<ReturnType<typeof fixture.host.deferGuard>>();
  const scopeSnapshot = useSyncExternalStore(
    (listener) => fixture.scope.subscribe(listener),
    () => fixture.scope.getSnapshot(),
  );
  return (
    <>
      <button
        onClick={() => {
          fixture.host.setDirty(true);
          setGuard(fixture.host.deferGuard());
        }}
      >
        Hold leave guard
      </button>
      <button
        onClick={() => {
          void fixture.scope.requestChange({ kind: 'workspace', id: 'globex' });
        }}
      >
        Go to globex
      </button>
      <button
        onClick={() => {
          void fixture.scope.requestChange({ kind: 'workspace', id: 'acme' });
        }}
      >
        Go to acme
      </button>
      <button onClick={() => guard?.resolve({ status: 'discard' })}>Approve leave</button>
      <button onClick={() => fixture.scope.invalidate('revoked')}>Revoke scope</button>
      <button onClick={() => fixture.scope.dispose()}>Dispose scope</button>
      <button onClick={() => setMounted(false)}>Unmount provider</button>
      <button onClick={() => setSurfaceId('react-orders-replacement')}>Replace surface ID</button>
      <button
        onClick={() => {
          void holdRead().then(() => setReadStarted('started'));
        }}
      >
        Hold next read
      </button>
      <button
        onClick={() => {
          void currentSurface?.request(open).then((result) => setReadResult(result.status));
        }}
      >
        Request active surface
      </button>
      <button onClick={() => activeRead?.release()}>Release read</button>
      <button
        onClick={() => {
          void firstA?.request(open).then((result) => setOldResult(result.status));
        }}
      >
        Call old A controller
      </button>
      <p data-testid="old-result">{oldResult}</p>
      <p data-testid="read-started">{readStarted}</p>
      <p data-testid="read-result">{readResult}</p>
      <p id="scope-listeners" data-testid="scope-listeners">
        {scopeListeners}
      </p>
      <p data-testid="scope-status">{scopeSnapshot.status}</p>
      {mounted && (
        <VarendoProvider runtime={fixture.runtime}>
          <VarendoScope scope={fixture.scope}>
            <ScopedOrders surfaceId={surfaceId} />
          </VarendoScope>
        </VarendoProvider>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
window.addEventListener(
  'pagehide',
  () => {
    void fixture.dispose();
  },
  { once: true },
);
