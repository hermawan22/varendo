import type { Intent } from '@varendo/core';
import type { ToolModelPort, ToolModelRequest, ToolModelResponse } from '../../../packages/agent/src/model/types.js';
import {
  connectAgent,
  type AgentClient,
  type AgentConnection,
  type AgentSurfaceRenderResult,
  type AgentSurfaceTarget,
} from '../../../packages/agent/src/browser/index.js';
import type { ScopeController } from '../../../packages/runtime/src/scopes/types.js';
import { createPeopleFixture, type PeopleSurfaceState } from './people.js';
import type { SurfaceController } from '../../../packages/runtime/src/surfaces/types.js';

const DEFAULT_RESPONSE: ToolModelResponse = Object.freeze({
  text: 'Done',
  calls: Object.freeze([]),
  usage: Object.freeze({ inputTokens: 10, outputTokens: 5 }),
});

export interface AgentFixtureOptions {
  readonly modelResponse?: ToolModelResponse;
  readonly modelResponses?: readonly ToolModelResponse[];
  readonly onComplete?: (request: ToolModelRequest) => void;
  readonly render?: AgentSurfaceTarget['render'];
}

export interface AgentFixtureContract {
  readonly surface: SurfaceController<Intent, PeopleSurfaceState>;
  readonly scope: ReturnType<typeof createPeopleFixture>['scope'];
  readonly connection: AgentConnection;
  readonly initialSnapshot: ReturnType<AgentFixtureContract['surface']['getSnapshot']>;
  readonly requests: readonly ToolModelRequest[];
  readonly runExperience: (prompt: string) => ReturnType<AgentConnection['runExperience']>;
  readonly dispose: () => Promise<void>;
}

function renderResult(status: string, diagnosticCode?: string): AgentSurfaceRenderResult {
  if (
    status === 'unsupported' ||
    status === 'denied' ||
    status === 'stale' ||
    status === 'cancelled' ||
    status === 'failed'
  )
    return { status, diagnosticCode: diagnosticCode ?? `surface.${status}` };
  return { status: 'failed', diagnosticCode: diagnosticCode ?? 'surface.invalid' };
}

export function createAgentFixture(options: AgentFixtureOptions = {}): AgentFixtureContract {
  const people = createPeopleFixture();
  const surface = people.runtime.createSurface({
    scope: people.scope,
    id: 'people-main',
    feature: people.feature,
    bindings: people.bindings,
  });
  const requests: ToolModelRequest[] = [];
  const responses = options.modelResponses ?? [options.modelResponse ?? DEFAULT_RESPONSE];
  let responseIndex = 0;
  const model: ToolModelPort = {
    estimateInputTokens: () => 10,
    complete: async (request) => {
      requests.push(request);
      options.onComplete?.(request);
      const response = responses[Math.min(responseIndex++, responses.length - 1)];
      if (response === undefined) throw new TypeError('The fake model response list is empty.');
      return response;
    },
  };
  const target: AgentSurfaceTarget = {
    id: 'people-main',
    surface,
    render:
      options.render ??
      (async ({ intent, signal }) => {
        const result = await surface.request(intent as Intent, { signal, expectedAddress: surface.address });
        if (result.status === 'committed') return { status: 'renderer-ready' as const, revision: result.revision };
        if (result.status === 'proposed' || result.status === 'needs-input')
          return { status: 'needs-input' as const, diagnosticCode: result.status };
        return renderResult(result.status, result.diagnosticCode);
      }),
  };
  const client: AgentClient = { kind: 'host-agent-client', model, registeredTargets: [target] };
  const bridgeScope = Object.freeze({
    ...people.scope,
    subscribe: (_listener: () => void) => () => undefined,
  }) as unknown as ScopeController;
  const connection = connectAgent({ scope: bridgeScope, client, targets: ['people-main'] });
  const initialSnapshot = surface.getSnapshot();
  return {
    surface,
    scope: people.scope,
    connection,
    initialSnapshot,
    requests,
    runExperience: (prompt) => connection.runExperience(prompt),
    dispose: async () => {
      connection.disconnect();
      surface.dispose();
      await people.dispose();
    },
  };
}
