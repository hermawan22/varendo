import React, { createContext, useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  AdaptiveSurface,
  AeliqoScope,
  ViewSurface,
  defineReactViews,
  useDataSurface,
  useSurface,
  type ReactViewProps,
} from '../../packages/react/src/surface/index.js';
import { AeliqoProvider, useAeliqoRuntime } from '../../packages/react/src/index.js';
import { createPeopleFixture, type PeopleSurfaceState } from './fixtures/people.js';
import { createScopeFixture } from './fixtures/scope.js';
import type { Intent } from '@varendo/core';
import { z } from 'zod';
import { reactPresentationFixture, listRef, tableRef } from './fixtures/react-presentation.js';
import { createLocalDataSurface, type LocalBrowseState, type SurfaceController } from '@varendo/runtime/surfaces';
import type { PresentationResolverInput } from '@varendo/core/presentation';

const HostContext = createContext('missing-host-context');

function committedPresentation<I, S>(surface: SurfaceController<I, S>): PresentationResolverInput {
  const evidence = surface.presentationEvidence?.();
  if (evidence === undefined) throw new Error('Missing committed presentation evidence.');
  const base = reactPresentationFixture();
  return {
    ...base,
    preconditions: evidence.current,
    context: {
      ...base.context,
      task: evidence.task,
      experience: { ...base.context.experience, revision: evidence.current.experienceRevision },
      results: evidence.results,
      current: evidence.current,
    },
    target: evidence.target,
    candidates: base.candidates.map((candidate) => ({
      ...candidate,
      plan: {
        ...candidate.plan,
        preconditions: evidence.current,
        nodes: candidate.plan.nodes.map((node) => ({ ...node, result: evidence.results[0]!.ref })),
        coverage: evidence.task.needs.map((need) => ({
          needId: need.id,
          nodeIds: [candidate.plan.rootId] as const,
          operations: [need.operation] as const,
        })),
      },
    })),
  };
}

function PeopleNativeView({ snapshot }: ReactViewProps<Intent, PeopleSurfaceState>): React.JSX.Element {
  const hostValue = useContext(HostContext);
  return (
    <section data-host-context={hostValue}>
      {snapshot.state.rows.map((person) => (
        <label key={person.id}>
          {person.team}
          <input aria-label={person.id} value={person.name} readOnly />
        </label>
      ))}
    </section>
  );
}

it('renders a registered native React view from a real headless surface snapshot', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'react-native-people',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  const request = await surface.request({ kind: 'browse' });
  expect(request).toEqual({ status: 'committed', revision: '1' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: 'people.native', revision: '1', render: PeopleNativeView },
  ]);

  const html = renderToStaticMarkup(
    <HostContext.Provider value="existing-host">
      <ViewSurface surface={surface} views={views} view={{ id: 'people.native', revision: '1' }} />
    </HostContext.Provider>,
  );

  expect(html).toContain('data-host-context="existing-host"');
  expect(html).toContain('aria-label="ada"');
  expect(html).toContain('value="Ada Chen"');
  expect(html).toContain('aria-label="sam"');
  fixture.dispose();
});

it('registers a retryable lazy native view without invoking its loader during definition', async () => {
  let loads = 0;
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    {
      id: 'people.lazy',
      revision: '1',
      load: async () => {
        loads += 1;
        return PeopleNativeView;
      },
    },
  ]);

  expect(loads).toBe(0);
  const definition = views.resolve({ id: 'people.lazy', revision: '1' });
  expect(definition).toBeDefined();
  if (definition === undefined || definition.load === undefined) throw new Error('Lazy view was not registered.');
  expect(await definition.load()).toBe(PeopleNativeView);
  expect(loads).toBe(1);
});

it('does not render an unqualified host-selected view and reports an unknown fixed view explicitly', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'react-adaptive-people',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: 'people.native', revision: '1', render: PeopleNativeView },
  ]);

  const adaptive = renderToStaticMarkup(
    <AdaptiveSurface
      surface={surface}
      views={views}
      selectView={(snapshot, available) => {
        expect(snapshot).toBe(surface.getSnapshot());
        expect(available).toHaveLength(1);
        return available[0]?.ref;
      }}
    />,
  );
  const missing = renderToStaticMarkup(
    <ViewSurface surface={surface} views={views} view={{ id: 'unknown.native', revision: '1' }} />,
  );

  expect(adaptive).toContain('No eligible native React view');
  expect(missing).toContain('requested native React view is not registered');
  expect(() =>
    defineReactViews([
      { id: 'people.native', revision: '1', render: PeopleNativeView },
      { id: 'people.native', revision: '1', render: PeopleNativeView },
    ]),
  ).toThrow('already registered');
  fixture.dispose();
});

it('does not treat the first standalone native view as automatically eligible', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'react-unqualified-people',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: 'people.native', revision: '1', render: PeopleNativeView },
  ]);

  const html = renderToStaticMarkup(<AdaptiveSurface surface={surface} views={views} />);

  expect(html).toContain('No eligible native React view');
  expect(html).not.toContain('Ada Chen');
  fixture.dispose();
});

it('uses the shared resolver to select an eligible native view independent of registry order', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'region-1',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: tableRef.id, revision: tableRef.revision, render: () => <p>table view</p> },
    { id: listRef.id, revision: listRef.revision, render: PeopleNativeView },
  ]);
  const resolution = committedPresentation(surface);

  const html = renderToStaticMarkup(<AdaptiveSurface surface={surface} views={views} presentation={resolution} />);

  expect(html).toContain('Ada Chen');
  expect(html).not.toContain('table view');
  fixture.dispose();
});

it('preserves the committed internal region target for an advanced native resolver', async () => {
  const owned = createLocalDataSurface({ data: [{ id: 'ada', name: 'Ada Chen' }], getRowId: (row) => row.id });
  await owned.surface.request({ kind: 'browse' });
  const evidence = owned.surface.presentationEvidence?.();
  expect(evidence).toBeDefined();
  if (evidence === undefined) throw new Error('Missing committed presentation evidence.');
  expect(evidence.target.address.surfaceId).not.toBe(owned.surface.address.surfaceId);
  const presentation = committedPresentation(owned.surface);
  const views = defineReactViews<Intent, LocalBrowseState>([
    { ...listRef, render: () => <p>authorized native list</p> },
  ]);

  const html = renderToStaticMarkup(
    <AdaptiveSurface surface={owned.surface} views={views} presentation={presentation} />,
  );

  expect(html).toContain('authorized native list');
  owned.dispose();
});

it('rejects advanced presentation evidence from another runtime owner', async () => {
  const owned = createLocalDataSurface({ data: [{ id: 'ada', name: 'Ada Chen' }], getRowId: (row) => row.id });
  await owned.surface.request({ kind: 'browse' });
  const committed = committedPresentation(owned.surface);
  const foreign: PresentationResolverInput = {
    ...committed,
    target: { ...committed.target, address: { ...committed.target.address, runtimeId: 'another-runtime' } },
  };
  const views = defineReactViews<Intent, LocalBrowseState>([{ ...listRef, render: () => <p>private native list</p> }]);

  const html = renderToStaticMarkup(<AdaptiveSurface surface={owned.surface} views={views} presentation={foreign} />);

  expect(html).toContain('No eligible native React view');
  expect(html).not.toContain('private native list');
  owned.dispose();
});

it('does not render an authorized descriptor after the surface is denied', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'region-1',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const presentation = committedPresentation(surface);
  fixture.scope.setFeaturePermission('people', false);
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([{ ...listRef, render: PeopleNativeView }]);

  const html = renderToStaticMarkup(<AdaptiveSurface surface={surface} views={views} presentation={presentation} />);

  expect(html).toContain('No eligible native React view');
  expect(html).not.toContain('Ada Chen');
  fixture.dispose();
});

it('does not render a fixed native view from a retained disposed controller', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'react-disposed-people',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: 'people.native', revision: '1', render: PeopleNativeView },
  ]);
  surface.dispose();

  const html = renderToStaticMarkup(
    <ViewSurface surface={surface} views={views} view={{ id: 'people.native', revision: '1' }} />,
  );

  expect(html).toContain('No eligible native React view');
  expect(html).not.toContain('Ada Chen');
  fixture.dispose();
});

it('does not let selectView bypass renderer eligibility without resolver evidence', async () => {
  const fixture = createPeopleFixture();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'react-unvalidated-pin',
    feature: fixture.feature,
    bindings: fixture.bindings,
  });
  await surface.request({ kind: 'browse' });
  const views = defineReactViews<Intent, PeopleSurfaceState>([
    { id: 'people.native', revision: '1', render: PeopleNativeView },
  ]);

  const html = renderToStaticMarkup(
    <AdaptiveSurface surface={surface} views={views} selectView={(_snapshot, available) => available[0]?.ref} />,
  );

  expect(html).toContain('No eligible native React view');
  expect(html).not.toContain('Ada Chen');
  fixture.dispose();
});

it('keeps an injected scope inert during server rendering and never disposes it', async () => {
  const fixture = await createScopeFixture();
  expect(fixture.scope.getSnapshot()).toMatchObject({ status: 'idle', active: false });

  const html = renderToStaticMarkup(
    <AeliqoScope scope={fixture.scope}>
      <span>host child</span>
    </AeliqoScope>,
  );

  expect(html).not.toContain('host child');
  expect(html).toContain('scope');
  expect(fixture.scope.getSnapshot()).toMatchObject({ status: 'idle', active: false });
  await fixture.dispose();
});

it('keeps the active subtree on A while a voluntary leave guard is pending and hides it after revocation', async () => {
  const fixture = await createScopeFixture();
  await fixture.activate('acme');
  const render = () =>
    renderToStaticMarkup(
      <AeliqoScope scope={fixture.scope}>
        <span>private {fixture.scope.getSnapshot().selector?.id}</span>
      </AeliqoScope>,
    );
  const guard = fixture.host.deferGuard();
  fixture.host.setDirty(true);
  const leaving = fixture.scope.requestChange({ kind: 'workspace', id: 'globex' });
  await guard.started;

  expect(render()).toContain('private acme');
  expect(render()).not.toContain('private globex');
  guard.resolve({ status: 'stay' });
  await leaving;
  fixture.scope.invalidate('logout');
  expect(render()).not.toContain('private acme');
  await fixture.dispose();
});

it('does not server-render scoped children after initial denial or disposal', async () => {
  const denied = await createScopeFixture();
  denied.host.deny('acme');
  const deniedState = new Promise<void>((resolve) => {
    const unsubscribe = denied.scope.subscribe(() => {
      if (denied.scope.getSnapshot().status !== 'denied') return;
      unsubscribe();
      resolve();
    });
  });
  const detach = denied.scope.attach();
  await deniedState;
  const render = () =>
    renderToStaticMarkup(
      <AeliqoScope scope={denied.scope}>
        <span>private data</span>
      </AeliqoScope>,
    );
  expect(render()).toContain('no longer available');
  expect(render()).not.toContain('private data');
  detach();
  denied.scope.dispose();
  expect(render()).toContain('scope has closed');
  expect(render()).not.toContain('private data');
  await denied.dispose();
});

it('defers a scoped declarative surface and its data request during server rendering', async () => {
  const fixture = await createScopeFixture();
  await fixture.activate('acme');
  const bindings = fixture.bindingsFor('acme');
  function Orders(): React.JSX.Element {
    const surface = useSurface(fixture.feature, { id: 'react-orders', bindings });
    return <p>{surface === undefined ? 'pending scoped surface' : 'unexpected controller'}</p>;
  }

  const html = renderToStaticMarkup(
    <AeliqoProvider runtime={fixture.runtime}>
      <AeliqoScope scope={fixture.scope}>
        <Orders />
      </AeliqoScope>
    </AeliqoProvider>,
  );

  expect(html).toContain('pending scoped surface');
  expect(fixture.source.callsFor('acme')).toBe(0);
  await fixture.dispose();
});

it('exposes an injected runtime without taking ownership of it', () => {
  const fixture = createPeopleFixture();
  function RuntimeProbe(): React.JSX.Element {
    const runtime = useAeliqoRuntime();
    return <p>{runtime === fixture.runtime ? 'same-runtime' : 'wrong-runtime'}</p>;
  }

  expect(
    renderToStaticMarkup(
      <AeliqoProvider runtime={fixture.runtime}>
        <RuntimeProbe />
      </AeliqoProvider>,
    ),
  ).toBe('<p>same-runtime</p>');
  expect(fixture.runtime.snapshot('missing-region')).toBeUndefined();
  fixture.dispose();
});

it('defers injected controller creation and initial data requests until committed lifecycle', () => {
  const fixture = createPeopleFixture();
  let creations = 0;
  const factory = {
    create: () => {
      creations += 1;
      return fixture.runtime.createSurface({
        scope: fixture.scope,
        id: 'react-effect-owned-people',
        feature: fixture.feature,
        bindings: fixture.bindings,
      });
    },
  };
  const dataFactory = {
    create: () => {
      creations += 1;
      return fixture.runtime.createSurface({
        scope: fixture.scope,
        id: 'react-effect-owned-data',
        feature: fixture.feature,
        bindings: fixture.bindings,
      });
    },
  };

  function SurfaceProbe(): React.JSX.Element {
    const surface = useSurface({ factory, initialRequest: { kind: 'browse' } });
    return <p>{surface === undefined ? 'pending' : 'ready'}</p>;
  }

  function DataSurfaceProbe(): React.JSX.Element {
    const surface = useDataSurface({ factory: dataFactory, initialRequest: { kind: 'browse' } });
    return <p>{surface === undefined ? 'pending-data' : 'ready-data'}</p>;
  }

  expect(
    renderToStaticMarkup(
      <>
        <SurfaceProbe />
        <DataSurfaceProbe />
      </>,
    ),
  ).toBe('<p>pending</p><p>pending-data</p>');
  expect(creations).toBe(0);
  expect(fixture.source.sourceRevision).toBe('people-source-1');
  fixture.dispose();
});

it('renders meaningful initial local browse HTML through the beginner API', () => {
  const rows = [
    { id: 'ada', name: 'Ada Chen', team: 'Design' },
    { id: 'sam', name: 'Sam Rivera', team: 'Engineering' },
  ];
  function People(): React.JSX.Element {
    const surface = useDataSurface({ data: rows, getRowId: (row) => row.id });
    return <AdaptiveSurface surface={surface} />;
  }

  const html = renderToStaticMarkup(<People />);

  expect(html).toContain('Ada Chen');
  expect(html).toContain('Sam Rivera');
  expect(html).toContain('<table');
});

it('renders honest empty guidance and a schema-backed empty state', () => {
  const schema = z.object({ id: z.string(), name: z.string() });
  type Person = z.infer<typeof schema>;
  function Empty({ identity }: { readonly identity?: string }): React.JSX.Element {
    const surface = useDataSurface({
      data: [] as readonly Person[],
      schema,
      ...(identity === undefined ? {} : { identity }),
      getRowId: (row) => row.id,
    });
    return <AdaptiveSurface surface={surface} />;
  }

  expect(renderToStaticMarkup(<Empty />)).toContain('Add an identity field');
  expect(renderToStaticMarkup(<Empty identity="id" />)).toContain('No records to show.');
});

it('does not expose duplicate identities in a local SSR preview', () => {
  function Duplicate(): React.JSX.Element {
    const surface = useDataSurface({
      data: [
        { id: 'same', name: 'First' },
        { id: 'same', name: 'Second' },
      ],
      getRowId: (row) => row.id,
    });
    return <AdaptiveSurface surface={surface} />;
  }

  const html = renderToStaticMarkup(<Duplicate />);

  expect(html).toContain('data.identity-duplicate');
  expect(html).not.toContain('First');
  expect(html).not.toContain('Second');
});

it('rejects a declared local SSR identity that disagrees with getRowId', () => {
  function Mismatch(): React.JSX.Element {
    const surface = useDataSurface({
      data: [{ id: 'ada', externalId: 'ext-ada' }],
      identity: 'externalId',
      getRowId: (row) => row.id,
    });
    return <AdaptiveSurface surface={surface} />;
  }

  const html = renderToStaticMarkup(<Mismatch />);

  expect(html).toContain('data.identity-ambiguous');
  expect(html).not.toContain('ext-ada');
});

it('rejects an implicit local authority inside an application-owned scope', async () => {
  const fixture = await createScopeFixture();
  await fixture.activate('acme');
  function ScopedLocal(): React.JSX.Element {
    const surface = useDataSurface({ data: [{ id: 'ada', name: 'Ada Chen' }], getRowId: (row) => row.id });
    return <AdaptiveSurface surface={surface} />;
  }

  const html = renderToStaticMarkup(
    <AeliqoScope scope={fixture.scope}>
      <ScopedLocal />
    </AeliqoScope>,
  );

  expect(html).toContain('data.scope-incompatible');
  expect(html).not.toContain('Ada Chen');
  await fixture.dispose();
});
