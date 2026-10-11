import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { AeliqoRuntime } from '@varendo/runtime/app';
import type { AeliqoApp } from '@varendo/web/app';

const AeliqoAppContext = createContext<AeliqoApp | undefined>(undefined);
const AeliqoRuntimeContext = createContext<AeliqoRuntime | undefined>(undefined);

export type AeliqoProviderProps = PropsWithChildren &
  ({ readonly app: AeliqoApp; readonly runtime?: never } | { readonly runtime: AeliqoRuntime; readonly app?: never });

/** Shares one application-owned Varendo instance. The provider never disposes an instance it did not create. */
export function AeliqoProvider({ app, runtime, children }: AeliqoProviderProps): React.JSX.Element {
  if (app !== undefined && runtime !== undefined)
    throw new TypeError('AeliqoProvider accepts either app or runtime, not both.');
  const resolvedRuntime = runtime ?? app?.runtime;
  if (resolvedRuntime === undefined) throw new TypeError('AeliqoProvider requires an application or runtime.');
  return (
    <AeliqoRuntimeContext.Provider value={resolvedRuntime}>
      <AeliqoAppContext.Provider value={app}>{children}</AeliqoAppContext.Provider>
    </AeliqoRuntimeContext.Provider>
  );
}

export function useAeliqoApp(): AeliqoApp {
  const app = useContext(AeliqoAppContext);
  if (app === undefined) throw new Error('Varendo React bindings require an AeliqoProvider.');
  return app;
}

/** Reads the application-owned runtime without taking ownership of its lifecycle. */
export function useAeliqoRuntime(): AeliqoRuntime {
  const runtime = useContext(AeliqoRuntimeContext);
  if (runtime === undefined) throw new Error('Varendo React bindings require an AeliqoProvider runtime.');
  return runtime;
}

/** Internal optional read for hooks that also support a providerless local path. */
export function useOptionalAeliqoRuntime(): AeliqoRuntime | undefined {
  return useContext(AeliqoRuntimeContext);
}
