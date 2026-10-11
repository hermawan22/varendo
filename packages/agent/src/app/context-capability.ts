import type { AgentCapabilityHandlerResult, AgentCapabilityManifest, AgentJsonValue } from '../capabilities/types.js';
import type { RuntimeResourceContext } from '@varendo/runtime/app';
import { exampleIntents, TIME_GRAINS, viewGuide } from './intent-guide.js';
import type { AppToolEndpointOptions } from './types.js';
import { failure, record, wire } from './values.js';

export function createContextCapability(
  options: AppToolEndpointOptions,
): AgentCapabilityManifest<Record<string, never>, AgentJsonValue> {
  return {
    ref: { id: 'aeliqo.app.context', revision: '1' },
    operation: 'catalog.read',
    label: 'Inspect the current Varendo context',
    description:
      'Lists the resources this Region can show: their fields, meanings (measures), views with their purpose (viewGuide), time grains, and examples: ready-to-send intents for aeliqo_render. Call it first. Returns metadata, never records or credentials.',
    parse(input) {
      return record(input) && Object.keys(input).length === 0
        ? { ok: true, value: {} }
        : failure('agent.app.context-input', 'Context accepts an empty object.');
    },
    invoke(): AgentCapabilityHandlerResult<AgentJsonValue> {
      const active = options.runtime.context(options.regionId);
      if (!active.ok) return { state: 'denied', diagnostics: active.diagnostics };
      const current = currentContexts(options, active.value);
      if (!current.ok) return { state: 'denied', diagnostics: current.diagnostics };
      const resources = current.value.map((context) => {
        const { resource, intents, fields, meanings, views, actions, customIntents, patterns, queryConstraint } =
          context;
        return {
          resource,
          intents,
          fields,
          meanings,
          views,
          actions,
          ...(customIntents === undefined ? {} : { customIntents }),
          ...(patterns === undefined ? {} : { patterns }),
          ...(queryConstraint === undefined ? {} : { queryConstraint }),
          viewGuide: viewGuide(views),
          examples: exampleIntents(context),
        };
      });
      const result = wire({ activeResource: active.value.resource.id, timeGrains: [...TIME_GRAINS], resources });
      if (result.ok) return { state: 'accepted', value: result.value };
      return { state: 'failed', diagnostics: result.diagnostics };
    },
  };
}

/** The trusted resource contexts this pairing may route; the active Region context when no port is supplied. */
export function currentContexts(
  options: AppToolEndpointOptions,
  active: RuntimeResourceContext,
): ReturnType<NonNullable<AppToolEndpointOptions['context']>['read']> {
  return options.context?.read() ?? { ok: true, value: [active] };
}
