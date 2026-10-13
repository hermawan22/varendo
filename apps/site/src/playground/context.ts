import type { AgentJsonValue } from '@varendo/agent/capabilities';
import { parseWireValue } from '@varendo/core';
import type { VarendoApp } from '@varendo/web/app';
import type { AppContextPort } from '@varendo/agent/app';
import { z } from 'zod';
import { PLAYGROUND_INTENTS } from './scenario-intents.js';
import { LAYOUT_DISCOVERY } from '../../../../examples/vnext/workspace/page.js';
import { dailyAttendanceIntent } from '../../../../examples/vnext/attendance/data.js';

const definitions = PLAYGROUND_INTENTS.definitions.map((definition) => {
  const schema = parseWireValue(JSON.parse(JSON.stringify(z.toJSONSchema(definition.schema))));
  if (!schema.ok) throw new Error('A registered intent needs a JSON schema.');
  return { ref: definition.ref, inputSchema: schema.value as AgentJsonValue };
});

export function playgroundContext(app: VarendoApp, regionId: string): AppContextPort {
  return {
    read() {
      const current = app.runtime.contexts(regionId);
      if (!current.ok) return current;
      const daily = dailyAttendanceIntent();
      return {
        ok: true,
        value: current.value.map((resource) => {
          if (resource.resource.id === 'attendance')
            return {
              ...resource,
              customIntents: definitions.filter((entry) => entry.ref.id.startsWith('attendance.')),
              patterns: LAYOUT_DISCOVERY,
            };
          if (resource.resource.id === 'articles')
            return {
              ...resource,
              customIntents: definitions.filter((entry) => entry.ref.id === 'demo.knowledge.by-topic'),
            };
          if (resource.resource.id === 'daily-attendance' && daily.kind === 'analyze' && daily.filter !== undefined)
            return {
              ...resource,
              queryConstraint: {
                interpretation: 'Observed local days in September 2026 before 6 September, Asia/Jakarta.',
                requiredFilter: daily.filter as AgentJsonValue,
              },
            };
          return resource;
        }),
      };
    },
  };
}
