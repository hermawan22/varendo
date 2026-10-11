import { createAppToolEndpoint } from '@varendo/agent/app';
import type { createTutorialApp } from './app.js';

type TutorialApp = ReturnType<typeof createTutorialApp>;

export function createPeopleAgentSession(app: TutorialApp) {
  const endpoint = createAppToolEndpoint({
    runtime: app.runtime,
    render: app,
    regionId: 'people-main',
    goalEpoch: crypto.randomUUID(),
    transport: 'mcp',
    expiresAt: Date.now() + 15 * 60_000,
    maxPending: 2,
    maxMilliseconds: 15_000,
    maxInputBytes: 32_000,
    maxOutputBytes: 64_000,
  });
  if (!endpoint.ok) throw new Error(endpoint.diagnostics[0].message);
  return endpoint.value;
}
