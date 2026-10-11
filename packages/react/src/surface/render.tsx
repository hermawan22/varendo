import React from 'react';
import type { VersionRef } from '@varendo/core';
import type { PresentationResolverInput } from '@varendo/core/presentation';
import type { SurfaceController, SurfaceSnapshot } from '@varendo/runtime/surfaces';
import type { DataRecord } from '@varendo/runtime/data';
import { useContainerSize, useSurfaceState } from './hooks.js';
import { LocalAdaptiveSurface, type LocalDataSurface } from './local.js';
import { resolvedView, sameRef } from './native-resolution.js';
import type { ReactViewDefinition, ReactViewProps, ReactViewRegistry } from './types.js';

export interface ViewSurfaceProps<I, S> {
  readonly surface: SurfaceController<I, S>;
  readonly views: ReactViewRegistry<I, S>;
  readonly view: VersionRef;
  readonly fallback?: React.ReactNode;
}

export interface AdaptiveSurfaceProps<I, S> {
  readonly surface: SurfaceController<I, S>;
  readonly views: ReactViewRegistry<I, S>;
  /** Trusted host evidence, registry, and candidates for automatic native selection. */
  readonly presentation?: PresentationResolverInput;
  /** The host may select from the explicitly registered native views. */
  readonly selectView?: (
    snapshot: SurfaceSnapshot<I, S>,
    views: readonly ReactViewDefinition<I, S>[],
  ) => VersionRef | undefined;
  readonly fallback?: React.ReactNode;
}

export interface LocalAdaptiveSurfaceProps<Row extends DataRecord> {
  readonly surface: LocalDataSurface<Row>;
}

function missingView(fallback: React.ReactNode): React.ReactNode {
  return fallback ?? <p role="alert">The requested native React view is not registered.</p>;
}

function noEligibleView(fallback: React.ReactNode): React.ReactNode {
  return fallback ?? <p role="alert">No eligible native React view is registered for this surface.</p>;
}

function currentSnapshot<I, S>(snapshot: SurfaceSnapshot<I, S>): SurfaceSnapshot<I, S> {
  return snapshot;
}

function NativeView<I, S>({
  surface,
  snapshot,
  render: View,
}: {
  readonly surface: SurfaceController<I, S>;
  readonly snapshot: SurfaceSnapshot<I, S>;
  readonly render: React.ComponentType<ReactViewProps<I, S>>;
}): React.JSX.Element {
  return <View surface={surface} snapshot={snapshot} request={surface.request.bind(surface)} />;
}

function nativeTargetKey<I, S>(snapshot: SurfaceSnapshot<I, S>): string {
  const address = snapshot.address;
  return [
    address.runtimeId,
    address.scopeInstanceId,
    address.activationEpoch,
    address.surfaceGeneration,
    address.surfaceId,
  ].join('\u0000');
}

type ReadyNativeView<I, S> = {
  readonly ref: VersionRef;
  readonly render: NonNullable<ReactViewDefinition<I, S>['render']>;
};

function authorizedPrior<I, S>(
  active: ReadyNativeView<I, S> | undefined,
  selected: VersionRef,
  canRetain: (ref: VersionRef) => boolean,
): ReadyNativeView<I, S> | undefined {
  if (active === undefined) return undefined;
  if (sameRef(active.ref, selected)) return active;
  return canRetain(active.ref) ? active : undefined;
}

function selectedNativeView<I, S>(
  ref: VersionRef,
  render: ReactViewDefinition<I, S>['render'],
  retained: ReadyNativeView<I, S> | undefined,
): ReadyNativeView<I, S> | undefined {
  if (render === undefined) return retained;
  if (retained !== undefined && sameRef(retained.ref, ref)) return retained;
  return { ref, render };
}

function NativeViewTransition<I, S>({
  surface,
  snapshot,
  definition,
  fallback,
  canRetain,
  readyToLoad = true,
}: {
  readonly surface: SurfaceController<I, S>;
  readonly snapshot: SurfaceSnapshot<I, S>;
  readonly definition: ReactViewDefinition<I, S>;
  readonly fallback?: React.ReactNode;
  readonly canRetain: (ref: VersionRef) => boolean;
  readonly readyToLoad?: boolean;
}): React.JSX.Element {
  const [active, setActive] = React.useState<ReadyNativeView<I, S>>();
  const [failed, setFailed] = React.useState(false);
  const [attempt, retry] = React.useReducer((count: number) => count + 1, 0);
  const { ref, render, load } = definition;
  const latestImplementation = React.useRef({ render, load });
  React.useEffect(() => {
    latestImplementation.current = { render, load };
  }, [render, load]);
  const isLazy = render === undefined;
  React.useEffect(() => {
    if (!isLazy) {
      const currentRender = latestImplementation.current.render!;
      setActive((previous) =>
        previous !== undefined && sameRef(previous.ref, ref) ? previous : { ref, render: currentRender },
      );
      setFailed(false);
      return;
    }
    if (!readyToLoad) return;
    let current = true;
    setFailed(false);
    void Promise.resolve().then(async () => {
      if (!current) return;
      try {
        const loadedRender = await latestImplementation.current.load!();
        if (current) setActive({ ref, render: loadedRender });
      } catch {
        if (current) setFailed(true);
      }
    });
    return () => {
      current = false;
    };
  }, [ref.id, ref.revision, isLazy, attempt, readyToLoad]);
  const retained = authorizedPrior(active, ref, canRetain);
  const selected = selectedNativeView(ref, render, retained);
  const visible =
    selected?.render === undefined ? (
      (fallback ?? <p role="status">Loading native React view.</p>)
    ) : (
      <NativeView surface={surface} snapshot={snapshot} render={selected.render} />
    );
  if (!isLazy || (retained !== undefined && sameRef(retained.ref, ref))) return <>{visible}</>;
  return (
    <>
      {visible}
      {failed ? (
        <div role="alert">
          Could not load the native React view.{' '}
          <button type="button" onClick={retry}>
            Retry view load
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Renders one explicit application-authored React view in the existing React tree. */
export function ViewSurface<I, S>({ surface, views, view, fallback }: ViewSurfaceProps<I, S>): React.ReactNode {
  const snapshot = useSurfaceState(surface, currentSnapshot);
  if (snapshot.phase === 'disposed' || snapshot.phase === 'denied') return noEligibleView(fallback);
  const definition = views.resolve(view);
  if (definition === undefined) return missingView(fallback);
  return (
    <NativeViewTransition
      key={nativeTargetKey(snapshot)}
      surface={surface}
      snapshot={snapshot}
      definition={definition}
      fallback={fallback}
      canRetain={(ref) => views.resolve(ref) !== undefined}
    />
  );
}

/** Renders an explicitly selected native view; standalone registrations are not automatic candidates. */
function NativeAdaptiveSurface<I, S>({
  surface,
  views,
  presentation,
  selectView,
  fallback,
}: AdaptiveSurfaceProps<I, S>): React.ReactNode {
  const snapshot = useSurfaceState(surface, currentSnapshot);
  const container = useContainerSize(presentation !== undefined);
  const selected = selectView?.(snapshot, views.views);
  if (presentation !== undefined) {
    const definition = resolvedView(surface, snapshot, views, presentation, selected, container.size);
    const content =
      definition === undefined ? (
        noEligibleView(fallback)
      ) : (
        <NativeViewTransition
          key={nativeTargetKey(snapshot)}
          surface={surface}
          snapshot={snapshot}
          definition={definition}
          fallback={fallback}
          canRetain={(ref) => resolvedView(surface, snapshot, views, presentation, ref, container.size) !== undefined}
          readyToLoad={container.size !== undefined}
        />
      );
    return <div ref={container.ref}>{content}</div>;
  }
  return noEligibleView(fallback);
}

export function AdaptiveSurface<Row extends DataRecord>(props: LocalAdaptiveSurfaceProps<Row>): React.ReactNode;
export function AdaptiveSurface<I, S>(props: AdaptiveSurfaceProps<I, S>): React.ReactNode;
export function AdaptiveSurface<I, S, Row extends DataRecord>(
  props: LocalAdaptiveSurfaceProps<Row> | AdaptiveSurfaceProps<I, S>,
): React.ReactNode {
  if ('views' in props) return <NativeAdaptiveSurface {...props} />;
  return <LocalAdaptiveSurface surface={props.surface} />;
}
