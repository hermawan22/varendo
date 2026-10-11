import { createAppToolEndpoint } from '@varendo/agent/app';
import type { AgentToolTransport } from '@varendo/agent/protocol';
import { mountPeople } from './app.js';

const records = [
  { id: 'ada', name: 'Ada Lovelace', team: 'Research' },
  { id: 'grace', name: 'Grace Hopper', team: 'Platform' },
  { id: 'margaret', name: 'Margaret Hamilton', team: 'Platform' },
];

export function createLocalSession(target: HTMLElement, expiresAt: number) {
  const mounted = mountPeople(target, records);
  return {
    render: mounted.render,
    dispose: mounted.dispose,
    connectAgent: (transport: AgentToolTransport, goalEpoch: string) =>
      createAppToolEndpoint({
        runtime: mounted.app.runtime,
        render: mounted.app,
        regionId: 'people-main',
        goalEpoch,
        transport,
        expiresAt,
        maxPending: 2,
        maxMilliseconds: 15_000,
        maxInputBytes: 32_000,
        maxOutputBytes: 64_000,
      }),
  };
}

export type LocalSession = ReturnType<typeof createLocalSession>;
