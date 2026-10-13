import { useEffect, useRef, useState } from 'react';
import type { Intent } from '@varendo/core';
import type { DataFeatureDefinition, FeatureDefinition } from '@varendo/core/features';
import type { DataSurfaceRequest, RequestResult, SurfaceController, SurfaceRequest } from '@varendo/runtime/surfaces';
import type { CapabilitySurfaceBindings, DataSurfaceBindings, SurfaceOwnership } from '@varendo/runtime/surfaces';
import type { DataRecord } from '@varendo/runtime/data';
import type { VarendoRuntime } from '@varendo/runtime/app';
import type { ScopeController } from '@varendo/runtime/scopes';
import { useOptionalVarendoRuntime } from '../app/context.js';
import { useLocalDataSurface, type LocalDataSurface, type LocalDataSurfaceOptions } from './local.js';
import { useOptionalVarendoScope } from './scope.js';

/** A host-owned factory. Keep this object stable with `useMemo` or module scope. */
export interface SurfaceControllerFactory<I, S> {
  create(): SurfaceController<I, S>;
}

export interface UseSurfaceOptions<I, S> {
  readonly factory: SurfaceControllerFactory<I, S>;
  /** Runs only after the factory has created a controller in committed lifecycle. */
  readonly initialRequest?: SurfaceRequest<I>;
  readonly onRequestResult?: (result: RequestResult) => void;
}

export interface UseDataSurfaceOptions<S> {
  readonly factory: SurfaceControllerFactory<Intent, S>;
  readonly initialRequest?: DataSurfaceRequest;
  readonly onRequestResult?: (result: RequestResult) => void;
}

export interface ScopedDataSurfaceOptions<S> {
  readonly id: string;
  readonly bindings: DataSurfaceBindings<S>;
  readonly ownership?: SurfaceOwnership<Intent, S>;
  readonly initialRequest?: DataSurfaceRequest;
  readonly onRequestResult?: (result: RequestResult) => void;
}

export interface ScopedCapabilitySurfaceOptions<I, S> {
  readonly id: string;
  readonly bindings: CapabilitySurfaceBindings<I, S>;
  readonly ownership?: SurfaceOwnership<I, S>;
  readonly initialRequest?: SurfaceRequest<I>;
  readonly onRequestResult?: (result: RequestResult) => void;
}

type ScopedOptions<I, S> = ScopedDataSurfaceOptions<S> | ScopedCapabilitySurfaceOptions<I, S>;
type ScopedFeature<I> = DataFeatureDefinition | (FeatureDefinition<I> & { readonly kind: 'feature' });

interface OwnedScopedSurface<I, S> {
  readonly controller: SurfaceController<I, S>;
  readonly runtime: VarendoRuntime;
  readonly scope: ScopeController;
  readonly feature: ScopedFeature<I>;
  readonly epoch: number;
  readonly id: string;
}

function createScopedController<I, S>(
  runtime: VarendoRuntime,
  scope: ScopeController,
  feature: ScopedFeature<I>,
  options: ScopedOptions<I, S>,
): SurfaceController<I, S> {
  if (feature.kind === 'data')
    return runtime.createSurface({
      scope,
      id: options.id,
      feature,
      bindings: options.bindings as DataSurfaceBindings<S>,
      ...(options.ownership === undefined ? {} : { ownership: options.ownership as SurfaceOwnership<Intent, S> }),
    }) as SurfaceController<I, S>;
  return runtime.createSurface({
    scope,
    id: options.id,
    feature,
    bindings: options.bindings as CapabilitySurfaceBindings<I, S>,
    ...(options.ownership === undefined ? {} : { ownership: options.ownership as SurfaceOwnership<I, S> }),
  });
}

function firstRequest<I, S>(feature: ScopedFeature<I>, options: ScopedOptions<I, S>): SurfaceRequest<I> {
  if (options.initialRequest !== undefined) return options.initialRequest as SurfaceRequest<I>;
  if (feature.kind === 'data') return { kind: 'browse' } as SurfaceRequest<I>;
  return (options.bindings as CapabilitySurfaceBindings<I, S>).initialIntent as SurfaceRequest<I>;
}

function ownedIsCurrent<I, S>(
  owned: OwnedScopedSurface<I, S> | undefined,
  runtime: VarendoRuntime | undefined,
  scope: ScopeController | undefined,
  feature: ScopedFeature<I> | undefined,
  id: string | undefined,
  epoch: number | undefined,
): owned is OwnedScopedSurface<I, S> {
  if (owned === undefined || scope === undefined) return false;
  return (
    owned.runtime === runtime &&
    owned.scope === scope &&
    owned.feature === feature &&
    owned.id === id &&
    owned.epoch === epoch &&
    owned.controller.address.scopeInstanceId === scope.getSnapshot().scopeInstanceId
  );
}

/**
 * Owns a controller created by an injected factory after commit. It returns
 * `undefined` until that effect runs, so interrupted render cannot leak a
 * runtime registration or request. The hook disposes only controllers it made.
 */
function useInjectedSurface<I, S>(options: UseSurfaceOptions<I, S> | undefined): SurfaceController<I, S> | undefined {
  const [surface, setSurface] = useState<SurfaceController<I, S>>();
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let active = true;
    if (options === undefined) return;
    const controller = options.factory.create();
    const abort = new AbortController();
    setSurface(controller);
    const initial = latest.current?.initialRequest;
    if (initial !== undefined)
      void controller.request(initial, { signal: abort.signal }).then(
        (result) => {
          if (active) latest.current?.onRequestResult?.(result);
        },
        () => undefined,
      );
    return () => {
      active = false;
      abort.abort();
      controller.dispose();
    };
  }, [options?.factory]);
  return surface;
}

function useScopedSurface<I, S>(
  feature: ScopedFeature<I> | undefined,
  options: ScopedOptions<I, S> | undefined,
): SurfaceController<I, S> | undefined {
  const runtime = useOptionalVarendoRuntime();
  const scope = useOptionalVarendoScope();
  const [owned, setOwned] = useState<OwnedScopedSurface<I, S>>();
  const latest = useRef(options);
  latest.current = options;
  if (feature !== undefined && (runtime === undefined || scope === undefined))
    throw new Error('Scoped useSurface requires VarendoProvider and an active VarendoScope.');
  const activation = scope?.getSnapshot();
  const epoch = activation?.status === 'active' && activation.active ? activation.activationEpoch : undefined;
  useEffect(() => {
    if (
      feature === undefined ||
      options === undefined ||
      runtime === undefined ||
      scope === undefined ||
      epoch === undefined
    )
      return;
    if (scope.getSnapshot().activationEpoch !== epoch || !scope.getSnapshot().active) return;
    const controller = createScopedController(runtime, scope, feature, options);
    const abort = new AbortController();
    let active = true;
    setOwned({ controller, runtime, scope, feature, epoch, id: options.id });
    void controller.request(firstRequest(feature, latest.current ?? options), { signal: abort.signal }).then(
      (result) => {
        if (active) latest.current?.onRequestResult?.(result);
      },
      () => undefined,
    );
    return () => {
      active = false;
      abort.abort();
      controller.dispose();
    };
  }, [runtime, scope, feature, options?.id, epoch]);
  return ownedIsCurrent(owned, runtime, scope, feature, options?.id, epoch) ? owned.controller : undefined;
}

export function useSurface<S>(
  feature: DataFeatureDefinition,
  options: ScopedDataSurfaceOptions<S>,
): SurfaceController<Intent, S> | undefined;
export function useSurface<I, S>(
  feature: FeatureDefinition<I> & { readonly kind: 'feature' },
  options: ScopedCapabilitySurfaceOptions<I, S>,
): SurfaceController<I, S> | undefined;
export function useSurface<I, S>(options: UseSurfaceOptions<I, S>): SurfaceController<I, S> | undefined;
export function useSurface<I, S>(
  featureOrOptions: ScopedFeature<I> | UseSurfaceOptions<I, S>,
  options?: ScopedOptions<I, S>,
): SurfaceController<I, S> | undefined {
  const scoped = 'factory' in featureOrOptions ? undefined : featureOrOptions;
  const injected = useInjectedSurface('factory' in featureOrOptions ? featureOrOptions : undefined);
  const owned = useScopedSurface(scoped, scoped === undefined ? undefined : options);
  return scoped === undefined ? injected : owned;
}

/** Providerless data adapter over the same effect-owned controller lifecycle. */
export function useDataSurface<Row extends DataRecord>(options: LocalDataSurfaceOptions<Row>): LocalDataSurface<Row>;
export function useDataSurface<S>(options: UseDataSurfaceOptions<S>): SurfaceController<Intent, S> | undefined;
export function useDataSurface<Row extends DataRecord, S>(
  options: LocalDataSurfaceOptions<Row> | UseDataSurfaceOptions<S>,
): LocalDataSurface<Row> | SurfaceController<Intent, S> | undefined {
  const injected = useInjectedSurface('factory' in options ? options : undefined);
  const local = useLocalDataSurface('data' in options ? options : undefined);
  return 'factory' in options ? injected : local;
}
