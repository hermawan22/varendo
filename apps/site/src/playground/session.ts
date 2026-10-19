import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { type Intent, type Outcome } from '@varendo/core';
import { createVarendoApp, type VarendoAppActionEvent, type WebRenderReceipt } from '@varendo/web/app';
import { STANDARD_RECIPES } from '@varendo/web/recipes';
import type { WebMcpEvidence } from '@varendo/agent/webmcp';
import { customIntentRecipe, knowledgeArticleView, PLAYGROUND_INTENTS } from './scenarios.js';
import { createPlaygroundData, readPlaygroundFormState } from './session-data.js';
import { createPlaygroundAgentConnections, type BrowserToolState } from './session-agents.js';

import { dailyAttendanceIntent } from '../../../../examples/vnext/attendance/data.js';
import { LAYOUT_STATE_MAPPINGS, LAYOUT_PATTERNS, LAYOUT_VIEWS } from '../../../../examples/vnext/workspace/page.js';

const REGION_ID = 'playground-main';
const PRINCIPAL = 'public-demo';
const SCOPE = 'synthetic-local';

export interface PlaygroundSession {
  readonly regionId: string;
  render(target: HTMLElement, intent: Intent, signal?: AbortSignal): Promise<WebRenderReceipt>;
  context(): ReturnType<ReturnType<typeof createVarendoApp>['runtime']['context']>;
  connectWebMcp(
    onState?: (state: BrowserToolState) => void,
  ): Promise<Outcome<{ readonly registrations: number; readonly evidence: WebMcpEvidence }>>;
  disconnectWebMcp(): void;
  dispose(): void;
}

function createSessionApp(
  data: ReturnType<typeof createPlaygroundData>,
  agentEgress: { enabled: boolean },
  onActionEvent: PlaygroundSessionActionHandler,
  onPresentation?: (receipt: WebRenderReceipt) => void,
) {
  const authority = {
    read: () => ({
      ok: true as const,
      value: {
        principalKey: PRINCIPAL,
        scopeDigest: SCOPE,
        policyRevision: 'policy-1',
        experienceRevision: 'web-1',
        grants: [
          'catalog.read',
          'task.propose',
          'task.evaluate',
          'result.inspect',
          'experience.commit',
          'action.propose',
          'action.execute',
          ...(agentEgress.enabled ? ['model.egress'] : []),
        ],
        readContext: { principal: PRINCIPAL },
      },
    }),
  };
  return createVarendoApp({
    resources: data.resources.map((resource) => ({ resource, data: data.services.get(resource.id)! })),
    authority,
    intents: PLAYGROUND_INTENTS,
    actionPort: data.actionPort,
    recipes: [...STANDARD_RECIPES, customIntentRecipe],
    views: [knowledgeArticleView, ...LAYOUT_VIEWS],
    patterns: LAYOUT_PATTERNS,
    stateMappings: LAYOUT_STATE_MAPPINGS,
    onActionEvent,
    ...(onPresentation === undefined ? {} : { onPresentation }),
    formState: {
      read: ({ resource, intent }) => readPlaygroundFormState(data.records, data.revisions, resource, intent),
    },
  });
}

type PlaygroundSessionActionHandler = (event: VarendoAppActionEvent) => void | Promise<void>;
type SessionApp = ReturnType<typeof createVarendoApp>;

function siteTheme(): 'light' | 'dark' {
  const applied = document.documentElement.dataset.theme;
  if (applied === 'light' || applied === 'dark') return applied;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createSessionRenderer(app: SessionApp) {
  let mountedResource: string | undefined;
  let mountedTarget: HTMLElement | undefined;
  const render = async (target: HTMLElement, intent: Intent, signal?: AbortSignal): Promise<WebRenderReceipt> => {
    if (mountedResource !== intent.resource || mountedTarget !== target) {
      if (mountedResource !== undefined) app.unmount(REGION_ID);
      const mounted = app.mount({ target, regionId: REGION_ID, resourceId: intent.resource });
      if (!mounted.ok)
        return {
          status: 'failed',
          requestId: 'playground-mount',
          regionId: REGION_ID,
          diagnostics: mounted.diagnostics,
        };
      mounted.value.setAttribute('data-varendo-theme', siteTheme());
      mountedResource = intent.resource;
      mountedTarget = target;
    }
    const daily = dailyAttendanceIntent();
    const bounded =
      intent.resource === 'daily-attendance' && intent.kind === 'analyze' && daily.kind === 'analyze'
        ? {
            ...intent,
            filter:
              intent.filter === undefined
                ? daily.filter
                : {
                    op: 'and' as const,
                    predicates: [daily.filter!, intent.filter],
                  },
          }
        : intent;
    return app.render({ regionId: REGION_ID, intent: bounded, ...(signal === undefined ? {} : { signal }) });
  };
  return {
    render,
    target: () => mountedTarget,
    reset() {
      mountedResource = undefined;
      mountedTarget = undefined;
    },
  };
}

export function createPlaygroundSession(
  onActionEvent: PlaygroundSessionActionHandler,
  onAgentRender?: (intent: Intent, receipt: WebRenderReceipt) => void | Promise<void>,
  onPresentation?: (receipt: WebRenderReceipt) => void,
): PlaygroundSession {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const data = createPlaygroundData(functions.value);
  const agentEgress = { enabled: false };
  const app = createSessionApp(data, agentEgress, onActionEvent, onPresentation);
  const renderer = createSessionRenderer(app);
  const connections = createPlaygroundAgentConnections({
    app,
    regionId: REGION_ID,
    getTarget: renderer.target,
    render: renderer.render,
    ...(onAgentRender === undefined ? {} : { onAgentRender }),
    state: agentEgress,
  });
  return Object.freeze({
    regionId: REGION_ID,
    render: renderer.render,
    context: () => app.runtime.context(REGION_ID),
    connectWebMcp: connections.connectWebMcp,
    disconnectWebMcp: connections.disconnectWebMcp,
    dispose() {
      connections.dispose();
      app.dispose();
      data.actionPort.dispose();
      renderer.reset();
    },
  });
}
