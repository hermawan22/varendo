import React from 'react';
import { inferLocalDataShape } from '@varendo/core/features';
import type { Intent } from '@varendo/core';
import type {
  LocalBrowseState,
  LocalDataSurfaceInput,
  SurfaceController,
  SurfacePresentationEvidence,
} from '@varendo/runtime/surfaces';
import type { DataRecord } from '@varendo/runtime/data';
import { useContainerSize, useSurfaceState } from './hooks.js';
import { useLocalMount, useLocalUpdates } from './local-hooks.js';
import { DataCards, DataRows } from './local-fallback.js';
import { resolveLocalBrowse, type ContainerSize } from './local-presentation.js';
import { useOptionalAeliqoScope } from './scope.js';

export type LocalDataSurfaceOptions<Row extends DataRecord> = Omit<LocalDataSurfaceInput<Row>, 'id'> & {
  readonly id?: string;
  /** Signal an in-place mutation; a new data reference needs no signal. */
  readonly version?: string | number;
};

export interface LocalDataSurface<Row extends DataRecord> {
  readonly kind: 'local-data';
  readonly data: readonly Row[];
  readonly getRowId: (row: Row) => unknown;
  readonly schema?: LocalDataSurfaceOptions<Row>['schema'];
  readonly identity?: string;
  readonly version?: string | number;
  readonly controller?: SurfaceController<Intent, LocalBrowseState>;
  readonly error?: string;
}

/** The owned runtime is created only after React commits this hook. */
export function useLocalDataSurface<Row extends DataRecord>(
  options: LocalDataSurfaceOptions<Row> | undefined,
): LocalDataSurface<Row> | undefined {
  const scoped = useOptionalAeliqoScope() !== undefined;
  const ownership = useLocalMount(options, scoped);
  useLocalUpdates(options, scoped, ownership);
  if (options === undefined) return undefined;
  const visibleError = !scoped
    ? ownership.error
    : 'data.scope-incompatible: A providerless local surface cannot create authority inside an application scope.';
  return {
    kind: 'local-data',
    data: options.data,
    getRowId: options.getRowId,
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    ...(options.identity === undefined ? {} : { identity: options.identity }),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(scoped || ownership.owned === undefined ? {} : { controller: ownership.owned.surface }),
    ...(visibleError === undefined ? {} : { error: visibleError }),
  };
}

function committedFields(evidence: SurfacePresentationEvidence | undefined): readonly string[] {
  return evidence?.results[0]?.fields.map((field) => field.id) ?? [];
}

function LiveRows({
  controller,
  size,
}: {
  readonly controller: SurfaceController<Intent, LocalBrowseState>;
  readonly size: ContainerSize | undefined;
}): React.JSX.Element {
  const snapshot = useSurfaceState(controller, (current) => current);
  if (snapshot.phase === 'denied' || snapshot.phase === 'unsupported' || snapshot.phase === 'failed')
    return <p role="alert">Local data is {snapshot.phase}.</p>;
  if (snapshot.phase !== 'ready') return <p role="status">Loading local data…</p>;
  const evidence = controller.presentationEvidence?.();
  const view = evidence === undefined ? undefined : resolveLocalBrowse(evidence, size);
  if (view === undefined) return <p role="alert">No eligible local browse view is available.</p>;
  const visibleFields = committedFields(evidence);
  if (snapshot.state.rows.length === 0) return <p role="status">No records to show.</p>;
  return view === 'cards' ? (
    <DataCards rows={snapshot.state.rows} fields={visibleFields} />
  ) : (
    <DataRows rows={snapshot.state.rows} fields={visibleFields} />
  );
}

function retainedResult(
  message: string,
  controller: SurfaceController<Intent, LocalBrowseState> | undefined,
  size: ContainerSize | undefined,
): React.JSX.Element {
  return (
    <>
      <p role="alert">{message}</p>
      {controller === undefined ? null : <LiveRows controller={controller} size={size} />}
    </>
  );
}

/** Read-only browse presentation; row indexes are display keys, never business identity. */
function LocalAdaptiveContent<Row extends DataRecord>({
  surface,
  size,
}: {
  readonly surface: LocalDataSurface<Row>;
  readonly size: ContainerSize | undefined;
}): React.JSX.Element {
  const inspected = React.useMemo(
    () =>
      inferLocalDataShape({
        id: 'local-preview',
        rows: surface.data,
        ...(surface.schema === undefined ? {} : { schema: surface.schema }),
        ...(surface.data.length === 0 && surface.identity !== undefined
          ? { identity: [surface.identity] }
          : { getRowId: surface.getRowId as (row: unknown) => unknown }),
      }),
    [surface.data, surface.schema, surface.identity, surface.version],
  );
  if (
    surface.data.length === 0 &&
    surface.schema !== undefined &&
    surface.identity === undefined &&
    surface.controller === undefined
  )
    return <p role="status">No records to show. Add an identity field to activate this empty dataset.</p>;
  if (!inspected.ok) {
    const diagnostic = inspected.diagnostics[0];
    if (diagnostic.code === 'data.shape-empty') {
      if (surface.controller !== undefined) return <LiveRows controller={surface.controller} size={size} />;
      return <p role="status">No records to show. Add a schema to describe empty data.</p>;
    }
    return retainedResult(`${diagnostic.code}: ${diagnostic.message}`, surface.controller, size);
  }
  if (surface.identity !== undefined && inspected.value.identity[0] !== surface.identity)
    return retainedResult(
      'data.identity-ambiguous: The declared identity does not match getRowId.',
      surface.controller,
      size,
    );
  if (surface.error !== undefined) return retainedResult(surface.error, surface.controller, size);
  const fields = inspected.value.fields.map((field) => field.id);
  if (surface.controller !== undefined) return <LiveRows controller={surface.controller} size={size} />;
  return <DataRows rows={surface.data} fields={fields} />;
}

/** Read-only browse presentation; row indexes are display keys, never business identity. */
export function LocalAdaptiveSurface<Row extends DataRecord>({
  surface,
}: {
  readonly surface: LocalDataSurface<Row>;
}): React.JSX.Element {
  const container = useContainerSize(true);
  return (
    <div ref={container.ref}>
      <LocalAdaptiveContent surface={surface} size={container.size} />
    </div>
  );
}
