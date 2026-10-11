/**
 * DECLARATION-ONLY DESIGN CONSUMER, NOT AELIQO IMPLEMENTATION.
 * This fixture freezes complete consumer shapes; later tasks must execute them
 * through installed package exports and real DOM/runtime assertions.
 */
import type { ReactElement } from 'react';
import type { ActionPort } from '../../../packages/runtime/src/actions/index.js';
import type { DataService } from '../../../packages/runtime/src/data/index.js';
import {
  AeliqoProvider,
  AeliqoScope,
  AdaptiveSurface,
  connectAgent,
  createAeliqoRuntime,
  defineDataFeature,
  defineFeature,
  defineReactViews,
  type AgentClient,
  type AeliqoApp,
  type AeliqoRuntime,
  type CapabilitySurfaceBindings,
  type DataSurfaceBindings,
  type DataServiceSourceBinding,
  type ExternalSurfaceStore,
  type FeatureIntentValue,
  type Intent,
  type ReactViewProps,
  type RuntimeObjectSchema,
  type RuntimeSchema,
  type ScopeBinding,
  type ScopeChangeResult,
  type ScopeController,
  type SurfaceController,
  useAeliqoScope,
  useSurface,
  ViewSurface,
} from '../api-contract.js';

declare const useEffect: typeof import('react').useEffect;

interface Person {
  readonly id: string;
  readonly name: string;
  readonly team: 'Design' | 'Engineering';
}

interface PersonState {
  readonly rows: readonly Person[];
  readonly selection: readonly string[];
}

declare const personSchema: RuntimeObjectSchema<Person>;
declare const localPeopleData: DataService;
declare const remotePeopleData: DataService;
declare const peopleActions: ActionPort;
declare const normalizePeopleResults: DataServiceSourceBinding<PersonState>['normalize'];

const peopleFeature = defineDataFeature({ id: 'people', schema: personSchema, identity: ['id'] });

const PEOPLE_COVERAGE = {
  fields: ['id', 'name', 'team'],
  operators: ['eq', 'contains'],
  pagination: 'keyset',
  stableOrder: ['id'],
  sorting: 'stable-fields-only',
  aggregation: 'unsupported',
  streaming: 'finite',
  updates: 'snapshot-replace',
  unsupported: ['aggregation', 'streaming', 'live-updates'],
} as const;

const BROWSE_PEOPLE = {
  version: '1',
  id: 'browse-people',
  kind: 'browse',
  resource: 'people',
  fields: ['id', 'name', 'team'],
  sort: [{ field: 'id', direction: 'asc' }],
} as const satisfies Intent;

const peopleBindings: DataSurfaceBindings<PersonState> = {
  initialState: { rows: [], selection: [] },
  source: {
    kind: 'data-service',
    service: localPeopleData,
    coverage: PEOPLE_COVERAGE,
    normalize: normalizePeopleResults,
  },
};

function PeopleTable({ state }: ReactViewProps<Intent, PersonState>): ReactElement {
  return (
    <table>
      <tbody>
        {state.rows.map((person) => (
          <tr key={person.id}>
            <td>{person.name}</td>
            <td>{person.team}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const peopleViews = defineReactViews(peopleFeature, [{ id: 'people.table', revision: '1', render: PeopleTable }]);

const scopedBindings: DataSurfaceBindings<PersonState> = { ...peopleBindings, views: peopleViews };

const remoteBindings: DataSurfaceBindings<PersonState> = {
  initialState: { rows: [], selection: [] },
  source: {
    kind: 'data-service',
    service: remotePeopleData,
    coverage: PEOPLE_COVERAGE,
    normalize: normalizePeopleResults,
  },
  actions: peopleActions,
  views: peopleViews,
};

const scopeBinding: ScopeBinding = {
  resolve: async (selector) => ({
    status: 'authorized',
    selector,
    scopeInstanceId: `${selector.kind}:${selector.id}`,
  }),
  guard: async () => ({ status: 'clean' }),
};

export interface PeopleComposition {
  readonly runtime: AeliqoRuntime;
  readonly scope: ScopeController;
  dispose(): void;
}

/** Runtime and scope are created, attached, detached, and disposed by the host. */
export function createPeopleComposition(): PeopleComposition {
  const runtime = createAeliqoRuntime({ runtimeId: 'people-runtime' });
  const scope = runtime.createScope({
    binding: scopeBinding,
    initial: { kind: 'workspace', id: 'acme' },
  });
  const detach = scope.attach();
  return {
    runtime,
    scope,
    dispose: () => {
      detach();
      scope.dispose();
      runtime.dispose();
    },
  };
}

export function createHeadlessPeopleSurface(
  runtime: AeliqoRuntime,
  scope: ScopeController,
): SurfaceController<Intent, PersonState> {
  return runtime.createSurface({
    scope,
    id: 'people-headless',
    feature: peopleFeature,
    bindings: scopedBindings,
    ownership: { mode: 'internal', defaultIntent: BROWSE_PEOPLE },
  });
}

export function RemotePeoplePage(): ReactElement {
  const surface = useSurface(peopleFeature, {
    id: 'people-remote',
    bindings: remoteBindings,
    ownership: { mode: 'internal', defaultIntent: BROWSE_PEOPLE },
  });
  return <AdaptiveSurface surface={surface} />;
}

export function changeWorkspace(scope: ScopeController): Promise<ScopeChangeResult> {
  return scope.requestChange({ kind: 'workspace', id: 'globex' });
}

export function WorkspaceSwitcher({ scope }: { readonly scope: ScopeController }): ReactElement {
  return <button onClick={() => void changeWorkspace(scope)}>Switch workspace</button>;
}

export function LogoutButton({ scope }: { readonly scope: ScopeController }): ReactElement {
  return <button onClick={() => scope.invalidate('logout')}>Log out</button>;
}

interface WorkspaceLayoutInput {
  readonly mode: 'single' | 'comparison';
}

interface WorkspaceLayoutState {
  readonly mode: WorkspaceLayoutInput['mode'];
  readonly surfaceIds: readonly string[];
}

declare const workspaceLayoutInputSchema: RuntimeSchema<WorkspaceLayoutInput>;
declare const workspaceLayoutStateSchema: RuntimeSchema<WorkspaceLayoutState>;

const workspaceLayoutFeature = defineFeature({
  id: 'people-workspace-layout',
  capabilities: [
    {
      ref: { id: 'workspace.layout-state', revision: '1' },
      kind: 'output',
      schema: workspaceLayoutStateSchema,
    },
  ],
  intents: [
    {
      ref: { id: 'workspace.choose-layout', revision: '1' },
      schema: workspaceLayoutInputSchema,
      capabilities: [{ id: 'workspace.layout-state', revision: '1' }],
    },
  ],
});

type WorkspaceLayoutIntent = FeatureIntentValue<typeof workspaceLayoutFeature.intents>;

const SINGLE_LAYOUT = {
  intent: { id: 'workspace.choose-layout', revision: '1' },
  input: { mode: 'single' },
} as const satisfies WorkspaceLayoutIntent;

const COMPARISON_LAYOUT = {
  intent: { id: 'workspace.choose-layout', revision: '1' },
  input: { mode: 'comparison' },
} as const satisfies WorkspaceLayoutIntent;

const workspaceLayoutBindings: CapabilitySurfaceBindings<WorkspaceLayoutIntent, WorkspaceLayoutState> = {
  initialIntent: SINGLE_LAYOUT,
  initialState: { mode: 'single', surfaceIds: [] },
  source: {
    kind: 'capability',
    read: async (intent) => ({
      mode: intent.input.mode,
      surfaceIds: intent.input.mode === 'single' ? ['people-main'] : ['people-main', 'people-secondary'],
    }),
  },
};

export function WorkspaceLayoutControls(): ReactElement {
  const layout = useSurface(workspaceLayoutFeature, {
    id: 'people-workspace-layout',
    bindings: workspaceLayoutBindings,
    ownership: { mode: 'internal', defaultIntent: SINGLE_LAYOUT },
  });
  return (
    <AdaptiveSurface
      surface={layout}
      controls={<button onClick={() => void layout.request(COMPARISON_LAYOUT)}>Compare workspaces</button>}
    />
  );
}

/** T01 compiles the SSR consumer; T12 must assert this content from real rendered DOM. */
declare const renderToStaticMarkup: (element: ReactElement) => string;

export function renderPeopleSsr(surface: SurfaceController<Intent, PersonState>): {
  readonly html: string;
  readonly expectedVisibleText: string;
  readonly expectedCellSelector: 'td';
} {
  return {
    html: renderToStaticMarkup(<AdaptiveSurface surface={surface} />),
    expectedVisibleText: 'Ada Chen',
    expectedCellSelector: 'td',
  };
}

function PeopleAgentConnection({ client }: { readonly client: AgentClient }): null {
  const scope = useAeliqoScope();
  useEffect(() => {
    const connection = connectAgent({
      scope,
      client,
      targets: ['people-main', 'people-secondary'],
    });
    return () => connection.disconnect();
  }, [client, scope]);
  return null;
}

export function ControlledPeople({
  store,
}: {
  readonly store: ExternalSurfaceStore<Intent, PersonState>;
}): ReactElement {
  const surface = useSurface(peopleFeature, {
    id: 'people-controlled',
    bindings: scopedBindings,
    ownership: {
      mode: 'external',
      store,
      onProposal: (proposal) => {
        void proposal;
      },
    },
  });
  return <AdaptiveSurface surface={surface} />;
}

export function PeoplePage({ client }: { readonly client: AgentClient }): ReactElement {
  const scope = useAeliqoScope();
  const primary = useSurface(peopleFeature, {
    id: 'people-main',
    bindings: scopedBindings,
    ownership: { mode: 'internal', defaultIntent: BROWSE_PEOPLE },
  });
  const comparison = useSurface(peopleFeature, {
    id: 'people-secondary',
    bindings: scopedBindings,
    ownership: { mode: 'internal', defaultIntent: BROWSE_PEOPLE },
  });
  void scope.getSnapshot();

  return (
    <>
      <AdaptiveSurface surface={primary} />
      <ViewSurface surface={comparison} view="people.table" />
      <WorkspaceLayoutControls />
      <WorkspaceSwitcher scope={scope} />
      <LogoutButton scope={scope} />
      <PeopleAgentConnection client={client} />
    </>
  );
}

export function ScopedPeopleApplication({
  runtime,
  scope,
  client,
}: {
  readonly runtime: AeliqoRuntime;
  readonly scope: ScopeController;
  readonly client: AgentClient;
}): ReactElement {
  return (
    <AeliqoProvider runtime={runtime}>
      <AeliqoScope scope={scope}>
        <PeoplePage client={client} />
      </AeliqoScope>
    </AeliqoProvider>
  );
}

export function ScopedRemotePeopleApplication({
  runtime,
  scope,
}: {
  readonly runtime: AeliqoRuntime;
  readonly scope: ScopeController;
}): ReactElement {
  return (
    <AeliqoProvider runtime={runtime}>
      <AeliqoScope scope={scope}>
        <RemotePeoplePage />
      </AeliqoScope>
    </AeliqoProvider>
  );
}

export function ControlledPeopleApplication({
  runtime,
  scope,
  store,
}: {
  readonly runtime: AeliqoRuntime;
  readonly scope: ScopeController;
  readonly store: ExternalSurfaceStore<Intent, PersonState>;
}): ReactElement {
  return (
    <AeliqoProvider runtime={runtime}>
      <AeliqoScope scope={scope}>
        <ControlledPeople store={store} />
      </AeliqoScope>
    </AeliqoProvider>
  );
}

/** Existing 0.4 consumers keep their real AeliqoApp contract explicitly. */
export function LegacyCompatibleApplication({
  app,
  children,
}: {
  readonly app: AeliqoApp;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <AeliqoProvider mode="legacy-app" app={app}>
      {children}
    </AeliqoProvider>
  );
}
