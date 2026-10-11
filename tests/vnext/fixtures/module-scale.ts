import type { Intent } from '@varendo/core';
import { defineDataFeature } from '@varendo/core/features';
import type { SurfaceController } from '@varendo/runtime';
import { z } from 'zod';
import { createPeopleFixture, type Person, type PeopleFixtureContract, peopleFeature } from './people.js';

const declaredSchema = z.object({ id: z.string(), name: z.string(), team: z.enum(['Design', 'Engineering']) });
const ACTIVE_SURFACE_LIMIT = 5;

export const engineeringIntent = Object.freeze({
  kind: 'browse' as const,
  filter: Object.freeze({ op: 'compare' as const, field: 'team', comparison: 'eq' as const, value: 'Engineering' }),
});

export interface TwoSurfaceFixture {
  readonly left: SurfaceController<Intent, { readonly rows: readonly Person[]; readonly selection: readonly string[] }>;
  readonly right: SurfaceController<
    Intent,
    { readonly rows: readonly Person[]; readonly selection: readonly string[] }
  >;
  readonly engineeringIntent: typeof engineeringIntent;
  readonly dispose: () => Promise<void>;
}

export interface ModuleScaleObservations {
  readonly declaredFeatureCount: number;
  readonly activeSurfaceCount: number;
  readonly liveSurfaceCount: number;
  readonly sourceReads: number;
  readonly normalizations: number;
  readonly listenerNotifications: readonly number[];
}

export interface ModuleScaleFixture {
  readonly definitions: readonly ReturnType<typeof defineDataFeature>[];
  readonly active: ReadonlyArray<
    SurfaceController<Intent, { readonly rows: readonly Person[]; readonly selection: readonly string[] }>
  >;
  readonly engineeringIntent: typeof engineeringIntent;
  readonly observations: () => ModuleScaleObservations;
  readonly changeFirstSurface: () => Promise<void>;
  readonly subscribeActive: () => () => void;
  readonly dispose: () => Promise<void>;
}

function validCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > 1_000)
    throw new TypeError('Module scale count must be an integer from 1 through 1,000.');
}

function definitions(count: number) {
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      defineDataFeature({
        id: `module-feature-${String(index + 1).padStart(4, '0')}`,
        schema: declaredSchema,
        identity: ['id'],
        fields: { team: { role: 'dimension' } },
      }),
    ),
  );
}

function createSurface(
  fixture: PeopleFixtureContract,
  id: string,
): SurfaceController<Intent, { readonly rows: readonly Person[]; readonly selection: readonly string[] }> {
  return fixture.runtime.createSurface({
    scope: fixture.scope,
    id,
    feature: peopleFeature,
    bindings: fixture.bindings,
  });
}

async function disposeFixture(
  fixture: PeopleFixtureContract,
  surfaces: readonly SurfaceController<Intent, unknown>[],
): Promise<void> {
  for (const surface of surfaces) surface.dispose();
  await fixture.dispose();
}

/** Two independently-addressed production controllers, with no mock notification seam. */
export function createTwoSurfaceFixture(): TwoSurfaceFixture {
  const fixture = createPeopleFixture();
  const left = createSurface(fixture, 'module-scale-left');
  const right = createSurface(fixture, 'module-scale-right');
  return {
    left,
    right,
    engineeringIntent,
    dispose: () => disposeFixture(fixture, [left, right]),
  };
}

/**
 * A host-side definition manifest can be large without constructing controllers,
 * regions, source requests, or subscriptions for inactive modules. The active
 * surfaces deliberately use the production People feature and data runtime.
 */
export function createModuleScaleFixture(count: number): ModuleScaleFixture {
  validCount(count);
  const fixture = createPeopleFixture();
  const declared = definitions(count);
  const activeCount = Math.min(ACTIVE_SURFACE_LIMIT, count);
  let sourceReads = 0;
  let normalizations = 0;
  let disposed = false;
  const notifications = Array.from({ length: activeCount }, () => 0);
  const source = fixture.bindings.source.service;
  const counted = {
    describe: (...args: Parameters<typeof source.describe>) => source.describe(...args),
    plan: (...args: Parameters<typeof source.plan>) => source.plan(...args),
    async *execute(...args: Parameters<typeof source.execute>) {
      sourceReads += 1;
      yield* source.execute(...args);
    },
  };
  const countedBindings = {
    ...fixture.bindings,
    source: {
      ...fixture.bindings.source,
      service: counted,
      normalize: async (...args: Parameters<typeof fixture.bindings.source.normalize>) => {
        normalizations += 1;
        return fixture.bindings.source.normalize(...args);
      },
    },
  };
  const first = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'module-scale-active-1',
    feature: peopleFeature,
    bindings: countedBindings,
  });
  const tracked = Object.freeze([
    first,
    ...Array.from({ length: activeCount - 1 }, (_, index) =>
      createSurface(fixture, `module-scale-active-${index + 2}`),
    ),
  ]);

  return {
    definitions: declared,
    active: tracked,
    engineeringIntent,
    observations: () =>
      Object.freeze({
        declaredFeatureCount: declared.length,
        activeSurfaceCount: tracked.length,
        liveSurfaceCount: disposed ? 0 : tracked.filter((surface) => surface.getSnapshot().phase !== 'disposed').length,
        sourceReads,
        normalizations,
        listenerNotifications: Object.freeze([...notifications]),
      }),
    async changeFirstSurface() {
      const result = await first.request(engineeringIntent);
      if (result.status !== 'committed') throw new TypeError(`Module scale intent did not commit: ${result.status}`);
    },
    subscribeActive() {
      const unsubscribers = tracked.map((surface, index) =>
        surface.subscribe(() => {
          notifications[index] = (notifications[index] ?? 0) + 1;
        }),
      );
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await disposeFixture(fixture, tracked);
    },
  };
}
