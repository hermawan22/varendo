import React, { createContext, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { Intent } from '@varendo/core';
import {
  createPresentationRegistry,
  type PresentationManifest,
  type PresentationResolverInput,
} from '@varendo/core/presentation';
import { AdaptiveSurface, ViewSurface, defineReactViews } from '../../../packages/react/src/surface/index.js';
import { createPeopleFixture, type PeopleSurfaceState } from '../../../tests/vnext/fixtures/people.js';
import { reactPresentationFixture, listRef, tableRef } from '../../../tests/vnext/fixtures/react-presentation.js';

const fixture = createPeopleFixture();
const surface = fixture.runtime.createSurface({
  scope: fixture.scope,
  id: 'region-1',
  feature: fixture.feature,
  bindings: fixture.bindings,
});
let activeListeners = 0;
const subscribeToSurface = surface.subscribe.bind(surface);
surface.subscribe = (listener) => {
  activeListeners += 1;
  document.getElementById('listener-count')!.textContent = String(activeListeners);
  const release = subscribeToSurface(listener);
  return () => {
    release();
    activeListeners -= 1;
    document.getElementById('listener-count')!.textContent = String(activeListeners);
  };
};
await surface.request({ kind: 'browse' });

const quality = (wide: boolean) => ({
  ok: true as const,
  value: { taskFit: wide ? 90 : 20, informationDensity: 0, interactionEffort: 0, legibilityPenalty: 0 },
});
const inlineSize = (environment: { inlineSize: { state: 'unknown' } | { state: 'known'; value: number } }) =>
  environment.inlineSize.state === 'known' ? environment.inlineSize.value : 0;
const base = reactPresentationFixture();
const tableBase = base.registry.manifests.find((manifest) => manifest.ref.id === tableRef.id);
const listBase = base.registry.manifests.find((manifest) => manifest.ref.id === listRef.id);
if (tableBase === undefined || listBase === undefined) throw new Error('Native fixture manifests are missing.');
const table: PresentationManifest = {
  ...tableBase,
  assess: (_config, _result, environment) => quality(inlineSize(environment) >= 500),
};
const list: PresentationManifest = {
  ...listBase,
  assess: (_config, _result, environment) => quality(inlineSize(environment) < 500),
};
const installed = createPresentationRegistry([table, list]);
if (!installed.ok) throw new Error(installed.diagnostics[0].message);
const HostContext = createContext('missing-host');
let failNextViewLoad = false;
let holdViewLoads = false;
let loadCount = 0;
const pendingLoads: Array<() => void> = [];
function WideView(): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const context = useContext(HostContext);
  return (
    <section>
      <p data-testid="native-choice">wide table</p>
      <input aria-label="Native draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      {createPortal(<span data-testid="native-portal">{context}</span>, document.getElementById('portal-target')!)}
    </section>
  );
}
function loadList() {
  loadCount += 1;
  document.getElementById('load-count')!.textContent = String(loadCount);
  if (failNextViewLoad) {
    failNextViewLoad = false;
    throw new Error('Synthetic lazy view load failure');
  }
  return (async () => {
    if (holdViewLoads) await new Promise<void>((resolve) => pendingLoads.push(resolve));
    return (await import('./lazy-list.js')).default;
  })();
}
function makeViews(includeWide = true) {
  return defineReactViews<Intent, PeopleSurfaceState>([
    ...(includeWide ? [{ ...tableRef, render: () => <WideView /> }] : []),
    { ...listRef, load: () => loadList() },
  ]);
}
let includeWide = true;
let views = makeViews();
const evidence = surface.presentationEvidence?.();
if (evidence === undefined) throw new Error('The native fixture needs a committed runtime evaluation.');
const presentation: PresentationResolverInput = {
  ...base,
  registry: installed.value,
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

const root = createRoot(document.getElementById('root')!);
function renderHost() {
  root.render(
    <React.StrictMode>
      <HostContext.Provider value="existing-host">
        <AdaptiveSurface surface={surface} views={views} presentation={presentation} />
      </HostContext.Provider>
    </React.StrictMode>,
  );
}
renderHost();
document.getElementById('narrow')!.addEventListener('click', () => {
  document.getElementById('host')!.style.width = '360px';
});
document.getElementById('fail-next')!.addEventListener('click', () => {
  failNextViewLoad = true;
});
document.getElementById('remove-wide')!.addEventListener('click', () => {
  includeWide = false;
  views = makeViews(includeWide);
  renderHost();
});
document.getElementById('hold-loads')!.addEventListener('click', () => {
  holdViewLoads = true;
});
document.getElementById('rerender')!.addEventListener('click', () => {
  views = makeViews(includeWide);
  renderHost();
});
document.getElementById('release-load')!.addEventListener('click', () => {
  pendingLoads.shift()?.();
});
document.getElementById('mount-initial-lazy')!.addEventListener('click', () => {
  let initialLoadCount = 0;
  const initialViews = defineReactViews<Intent, PeopleSurfaceState>([
    {
      ...listRef,
      load: async () => {
        initialLoadCount += 1;
        document.getElementById('initial-load-count')!.textContent = String(initialLoadCount);
        return () => <p data-testid="initial-lazy-view">initial lazy view</p>;
      },
    },
  ]);
  createRoot(document.getElementById('initial-lazy-root')!).render(
    <React.StrictMode>
      <ViewSurface surface={surface} views={initialViews} view={listRef} />
    </React.StrictMode>,
  );
});
document.getElementById('unmount-host')!.addEventListener('click', () => {
  root.unmount();
});
