import { defineDataFeature, defineFeature, inferLocalDataShape } from '@varendo/core/features';
import { createLocalDataBinding, createLocalDataSurface } from '@varendo/runtime/surfaces';
import type { ScopeController } from '@varendo/runtime/scopes';
import type { AeliqoRuntime } from '@varendo/runtime/app';
import type { DataSurfaceBindings } from '@varendo/runtime/surfaces';
import type { DataFeatureDefinition } from '@varendo/core/features';
import { AeliqoProvider } from '@varendo/react/app';
import {
  AdaptiveSurface,
  AeliqoScope,
  ViewSurface,
  defineReactViews,
  useSurface,
  useSurfaceState,
} from '@varendo/react/surface';
import { connectAgent, createScopedSurfaceEndpoint } from '@varendo/agent/browser';
import { useDataSurface } from '@varendo/react/surface';

export function LocalPeople({ rows }: { readonly rows: readonly { readonly id: string; readonly name: string }[] }) {
  const surface = useDataSurface({ data: rows, getRowId: (row) => row.id });
  return <AdaptiveSurface surface={surface} />;
}

export function ScopedPeople({
  runtime,
  scope,
  feature,
  bindings,
}: {
  readonly runtime: AeliqoRuntime;
  readonly scope: ScopeController;
  readonly feature: DataFeatureDefinition;
  readonly bindings: DataSurfaceBindings<{ readonly rows: readonly unknown[] }>;
}) {
  function Child() {
    const surface = useSurface(feature, { id: 'people-main', bindings });
    return <p>{surface === undefined ? 'Preparing people' : surface.getSnapshot().phase}</p>;
  }
  return (
    <AeliqoProvider runtime={runtime}>
      <AeliqoScope scope={scope}>
        <Child />
      </AeliqoScope>
    </AeliqoProvider>
  );
}

export const vNextEntries = [
  defineDataFeature,
  defineFeature,
  inferLocalDataShape,
  createLocalDataBinding,
  createLocalDataSurface,
  AdaptiveSurface,
  AeliqoScope,
  ViewSurface,
  defineReactViews,
  useSurfaceState,
  useSurface,
  connectAgent,
  createScopedSurfaceEndpoint,
  LocalPeople,
  ScopedPeople,
];

export type VNextScope = ScopeController;
