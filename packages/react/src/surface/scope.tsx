import React, { createContext, useCallback, useContext, useEffect, type PropsWithChildren } from 'react';
import type { ScopeController, ScopeSnapshot } from '@varendo/runtime/scopes';
import { useStoreSelector } from './hooks.js';

const AeliqoScopeContext = createContext<ScopeController | undefined>(undefined);

export interface AeliqoScopeProps extends PropsWithChildren {
  /** An application-owned scope. This component attaches it but never disposes it. */
  readonly scope: ScopeController;
}

function inactiveMessage(status: ScopeSnapshot['status']): string {
  if (status === 'denied') return 'This scope is no longer available.';
  if (status === 'disposed') return 'This scope has closed.';
  return 'Resolving scope…';
}

/** Makes one host-created scope available to React descendants. */
export function AeliqoScope({ scope, children }: AeliqoScopeProps): React.JSX.Element {
  useEffect(() => scope.attach(), [scope]);
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope]);
  const snapshot = useCallback(() => scope.getSnapshot(), [scope]);
  const state = useStoreSelector(subscribe, snapshot, (current) => current);
  if (state.status !== 'active' || !state.active || state.selector === null) {
    return <p role="status">{inactiveMessage(state.status)}</p>;
  }
  return (
    <AeliqoScopeContext.Provider value={scope}>
      <React.Fragment key={`${state.scopeInstanceId}:${state.activationEpoch}`}>{children}</React.Fragment>
    </AeliqoScopeContext.Provider>
  );
}

export function useAeliqoScope(): ScopeController {
  const scope = useContext(AeliqoScopeContext);
  if (scope === undefined) throw new Error('Varendo surface hooks require an AeliqoScope.');
  return scope;
}

/** Internal boundary check for providerless local helpers. */
export function useOptionalAeliqoScope(): ScopeController | undefined {
  return useContext(AeliqoScopeContext);
}

/** Subscribes to an immutable host-owned scope snapshot with a narrow selector. */
export function useAeliqoScopeState<T>(selector: (snapshot: ScopeSnapshot) => T): T {
  const scope = useAeliqoScope();
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope]);
  const snapshot = useCallback(() => scope.getSnapshot(), [scope]);
  return useStoreSelector(subscribe, snapshot, selector);
}
