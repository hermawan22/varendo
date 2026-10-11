import React from 'react';
import { createLocalDataSurface, type OwnedLocalDataSurface } from '@varendo/runtime/surfaces';
import type { DataRecord } from '@varendo/runtime/data';
import type { LocalDataSurfaceOptions } from './local.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The local data surface could not be initialized.';
}

export interface LocalOwnership<Row extends DataRecord> {
  readonly owned: OwnedLocalDataSurface<Row> | undefined;
  readonly error: string | undefined;
  readonly setError: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly initialData: React.RefObject<readonly Row[] | undefined>;
  readonly initialVersion: React.RefObject<string | number | undefined>;
}

export function useLocalMount<Row extends DataRecord>(
  options: LocalDataSurfaceOptions<Row> | undefined,
  scoped: boolean,
): LocalOwnership<Row> {
  const [owned, setOwned] = React.useState<OwnedLocalDataSurface<Row>>();
  const [error, setError] = React.useState<string>();
  const latest = React.useRef(options);
  const initialData = React.useRef<readonly Row[] | undefined>(options?.data);
  const initialVersion = React.useRef(options?.version);
  const canInitialize =
    options !== undefined &&
    (options.data.length > 0 || (options.schema !== undefined && options.identity !== undefined));
  const shouldStart = owned !== undefined || canInitialize;
  latest.current = options;

  React.useEffect(() => {
    const current = latest.current;
    if (current === undefined || scoped || !canInitialize) return;
    let instance: OwnedLocalDataSurface<Row>;
    try {
      instance = createLocalDataSurface(current);
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    initialData.current = current.data;
    initialVersion.current = current.version;
    setError(undefined);
    setOwned(instance);
    void instance.surface.request({ kind: 'browse' });
    return () => {
      instance.dispose();
      setOwned((previous) => (previous === instance ? undefined : previous));
    };
  }, [scoped, options?.schema, options?.identity, shouldStart]);

  return { owned, error, setError, initialData, initialVersion };
}

export function useLocalUpdates<Row extends DataRecord>(
  options: LocalDataSurfaceOptions<Row> | undefined,
  scoped: boolean,
  ownership: LocalOwnership<Row>,
): void {
  const { owned, setError, initialData, initialVersion } = ownership;
  React.useEffect(() => {
    if (scoped || owned === undefined || options === undefined) return;
    if (options.data === initialData.current && options.version === initialVersion.current) {
      setError(undefined);
      return;
    }
    const result = owned.replaceData(options.data);
    if (!result.ok) {
      const diagnostic = result.diagnostics[0];
      setError(
        diagnostic.message.startsWith(`${diagnostic.code}:`)
          ? diagnostic.message
          : `${diagnostic.code}: ${diagnostic.message}`,
      );
      return;
    }
    initialData.current = options.data;
    initialVersion.current = options.version;
    setError(undefined);
    void owned.surface.request({ kind: 'browse' });
  }, [scoped, owned, options?.data, options?.version]);
}
