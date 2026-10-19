import React, { createContext, useCallback, useContext, useEffect, type PropsWithChildren } from 'react';
import type { ScopeController, ScopeSnapshot } from '@varendo/runtime/scopes';
import { useStoreSelector } from './hooks.js';

const VarendoScopeContext = createContext<ScopeController | undefined>(undefined);

export interface VarendoScopeProps extends PropsWithChildren {
  /** An application-owned scope. This component attaches it but never disposes it. */
  readonly scope: ScopeController;
}

function inactiveMessage(status: ScopeSnapshot['status']): string {
  if (status === 'denied') return 'This scope is no longer available.';
  if (status === 'disposed') return 'This scope has closed.';
  return 'Resolving scope…';
}

/** Makes one host-created scope available to React descendants. */
export function VarendoScope({ scope, children }: VarendoScopeProps): React.JSX.Element {
  useEffect(() => scope.attach(), [scope]);
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope]);
  const snapshot = useCallback(() => scope.getSnapshot(), [scope]);
  const state = useStoreSelector(subscribe, snapshot, (current) => current);
  if (state.status !== 'active' || !state.active || state.selector === null) {
    return <p role="status">{inactiveMessage(state.status)}</p>;
  }
  return (
    <VarendoScopeContext.Provider value={scope}>
      <React.Fragment key={`${state.scopeInstanceId}:${state.activationEpoch}`}>{children}</React.Fragment>
    </VarendoScopeContext.Provider>
  );
}

export function useVarendoScope(): ScopeController {
  const scope = useContext(VarendoScopeContext);
  if (scope === undefined) throw new Error('Varendo surface hooks require an VarendoScope.');
  return scope;
}

/** Internal boundary check for providerless local helpers. */
export function useOptionalVarendoScope(): ScopeController | undefined {
  return useContext(VarendoScopeContext);
}

/** Subscribes to an immutable host-owned scope snapshot with a narrow selector. */
export function useVarendoScopeState<T>(selector: (snapshot: ScopeSnapshot) => T): T {
  const scope = useVarendoScope();
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope]);
  const snapshot = useCallback(() => scope.getSnapshot(), [scope]);
  return useStoreSelector(subscribe, snapshot, selector);
}
