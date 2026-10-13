import React, { createContext, useContext, type PropsWithChildren } from 'react';
import type { VarendoRuntime } from '@varendo/runtime/app';
import type { VarendoApp } from '@varendo/web/app';

const VarendoAppContext = createContext<VarendoApp | undefined>(undefined);
const VarendoRuntimeContext = createContext<VarendoRuntime | undefined>(undefined);

export type VarendoProviderProps = PropsWithChildren &
  ({ readonly app: VarendoApp; readonly runtime?: never } | { readonly runtime: VarendoRuntime; readonly app?: never });

/** Shares one application-owned Varendo instance. The provider never disposes an instance it did not create. */
export function VarendoProvider({ app, runtime, children }: VarendoProviderProps): React.JSX.Element {
  if (app !== undefined && runtime !== undefined)
    throw new TypeError('VarendoProvider accepts either app or runtime, not both.');
  const resolvedRuntime = runtime ?? app?.runtime;
  if (resolvedRuntime === undefined) throw new TypeError('VarendoProvider requires an application or runtime.');
  return (
    <VarendoRuntimeContext.Provider value={resolvedRuntime}>
      <VarendoAppContext.Provider value={app}>{children}</VarendoAppContext.Provider>
    </VarendoRuntimeContext.Provider>
  );
}

export function useVarendoApp(): VarendoApp {
  const app = useContext(VarendoAppContext);
  if (app === undefined) throw new Error('Varendo React bindings require an VarendoProvider.');
  return app;
}

/** Reads the application-owned runtime without taking ownership of its lifecycle. */
export function useVarendoRuntime(): VarendoRuntime {
  const runtime = useContext(VarendoRuntimeContext);
  if (runtime === undefined) throw new Error('Varendo React bindings require an VarendoProvider runtime.');
  return runtime;
}

/** Internal optional read for hooks that also support a providerless local path. */
export function useOptionalVarendoRuntime(): VarendoRuntime | undefined {
  return useContext(VarendoRuntimeContext);
}
