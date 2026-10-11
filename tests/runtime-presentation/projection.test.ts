import { projectAppInteraction, retainAppInteraction } from '../../packages/web/src/app/interaction-projection.js';
import type { WebRegion } from '../../packages/web/src/app/context.js';
import { describe, it, expect } from 'vitest';
import type { InteractionState } from '../../packages/core/src/contracts/index.js';
import type { PresentationManifest } from '../../packages/core/src/presentation/index.js';
import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { projectInteractionState, projectNavigationState } from '../../packages/runtime/src/presentation/renderer.js';
import { presentationPlan, presentationTask, experience, environment, result, ref } from '../contracts/fixtures.js';
const manifest: PresentationManifest = {
  ref: { id: 'data.table', revision: '1' },
  configSchema: { id: 'data.table.config', revision: '1' },
  roles: ['table'],
  result: 'required',
  children: { min: 0, max: 0 },
  visibility: 'leaf',
  extension: false,
  operations: [],
  resolveConfig: (values) => ({
    ok: true,
    value: {
      values,
      fields: ['employee.id'],
      ports: [
        {
          id: values.port === 'chosen' ? 'chosen' : 'selection',
          direction: 'inout',
          payload: 'selection',
          entity: 'employees',
          identity: ['employee.id'],
          grain: ['employee.id'],
        },
      ],
    },
  }),
};
const registry = createPresentationRegistry([manifest]);
if (!registry.ok) throw Error('registry');
const context = {
  task: presentationTask,
  experience,
  environment,
  results: [result],
  current: presentationPlan.preconditions,
  rendererCapabilities: [manifest.ref],
};
const previous = validatePresentationPlan(presentationPlan, context, registry.value);
if (!previous.ok) throw Error('previous');
const next = validatePresentationPlan(
  {
    ...presentationPlan,
    nodes: presentationPlan.nodes.map((node) => ({ ...node, config: { ...node.config, values: { port: 'chosen' } } })),
    stateTransfer: [
      { fromNode: 'table-1', toNode: 'table-1', mapping: { id: 'aeliqo.state.identity', revision: '1' } },
    ],
  },
  { ...context, incumbent: presentationPlan },
  registry.value,
);
if (!next.ok) throw Error('next');
const state: InteractionState = {
  version: '1',
  values: [
    {
      nodeId: 'table-1',
      portId: 'selection',
      payload: { kind: 'selection', selection: { mode: 'ids', entity: 'employees', keys: ['e-1'], result: ref } },
    },
  ],
  drafts: [
    { domain: 'profile', entity: 'employees', key: 'e-1', field: 'name', value: 'Unfinished', entityRevision: '1' },
  ],
};

function tableToCardsProjection() {
  const cards: PresentationManifest = {
    ...manifest,
    ref: { id: 'data.cards', revision: '1' },
    configSchema: { id: 'data.cards.config', revision: '1' },
    roles: ['cardCollection'],
  };
  const mapping = {
    ref: { id: 'state.table-cards', revision: '1' },
    from: manifest.ref,
    to: cards.ref,
    fromRole: 'table',
    toRole: 'cardCollection',
    kind: 'archive' as const,
  };
  const installed = createPresentationRegistry([manifest, cards], [], [], [mapping]);
  if (!installed.ok) throw Error('table-to-cards registry');
  const previousPlan = presentationPlan;
  const nextPlan = {
    ...presentationPlan,
    rootId: 'cards-1',
    nodes: [
      {
        ...presentationPlan.nodes[0]!,
        id: 'cards-1',
        role: 'cardCollection',
        representation: cards.ref,
        config: { schema: cards.configSchema, values: {} },
      },
    ],
    stateTransfer: [{ fromNode: 'table-1', toNode: 'cards-1', mapping: mapping.ref }],
  };
  const transitionContext = {
    ...context,
    experience: { ...experience, mode: 'composable' as const, allowedRepresentations: [manifest.ref.id, cards.ref.id] },
    rendererCapabilities: [manifest.ref, cards.ref],
    stateMappingCapabilities: [mapping.ref],
  };
  const previous = validatePresentationPlan(previousPlan, transitionContext, installed.value);
  const next = validatePresentationPlan(nextPlan, { ...transitionContext, incumbent: previousPlan }, installed.value);
  if (!previous.ok || !next.ok) throw Error('table-to-cards plan');
  return { installed: installed.value, mapping, previous, next, nextPlan, transitionContext };
}

describe('adaptation state projection', () => {
  it('preserves exact selection scope and domain drafts while transferring a compatible port', () => {
    const projected = projectInteractionState(previous.value, next.value, state);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.value).toEqual({ ...state, values: [{ ...state.values[0]!, portId: 'chosen' }] });
    const navigation = { route: { id: 'employee', revision: '1' }, params: { id: 'e-1' }, nodeId: 'table-1' };
    expect(projectNavigationState(previous.value, next.value, navigation)).toEqual({ ok: true, value: navigation });
  });
  it('rejects missing state owners and incompatible entity/grain instead of dropping state', () => {
    expect(
      projectInteractionState(previous.value, { ...next.value, plan: { ...next.value.plan, stateTransfer: [] } }, state)
        .ok,
    ).toBe(false);
    const incompatible = {
      ...next.value,
      nodes: next.value.nodes.map((node) => ({
        ...node,
        config: { ...node.config, ports: node.config.ports.map((port) => ({ ...port, entity: 'other' })) },
      })),
    };
    expect(projectInteractionState(previous.value, incompatible, state).ok).toBe(false);
    expect(
      projectNavigationState(
        previous.value,
        { ...next.value, plan: { ...next.value.plan, stateTransfer: [] } },
        { route: { id: 'employee', revision: '1' }, params: {}, nodeId: 'table-1' },
      ).ok,
    ).toBe(false);
  });
  it('preserves selection, focus ownership, and domain drafts across a registered table-to-cards transfer', () => {
    const transition = tableToCardsProjection();
    const projected = projectInteractionState(transition.previous.value, transition.next.value, state);
    const focused = projectNavigationState(transition.previous.value, transition.next.value, {
      route: { id: 'employee', revision: '1' },
      params: { id: 'e-1' },
      nodeId: 'table-1',
    });

    expect(projected).toEqual({ ok: true, value: { ...state, values: [{ ...state.values[0]!, nodeId: 'cards-1' }] } });
    expect(focused).toEqual({
      ok: true,
      value: { route: { id: 'employee', revision: '1' }, params: { id: 'e-1' }, nodeId: 'cards-1' },
    });
    expect(
      validatePresentationPlan(
        transition.nextPlan,
        { ...transition.transitionContext, incumbent: presentationPlan, stateMappingCapabilities: [] },
        transition.installed,
      ).ok,
    ).toBe(false);
  });
  it('rejects missing, incompatible, and ambiguous target ports without changing retained state', () => {
    const transition = tableToCardsProjection();
    const missing = { ...transition.next.value, plan: { ...transition.next.value.plan, stateTransfer: [] } };
    const incompatible = {
      ...transition.next.value,
      nodes: transition.next.value.nodes.map((node) => ({
        ...node,
        config: { ...node.config, ports: node.config.ports.map((port) => ({ ...port, entity: 'other' })) },
      })),
    };
    const ambiguous = {
      ...transition.next.value,
      nodes: transition.next.value.nodes.map((node) => ({
        ...node,
        config: {
          ...node.config,
          ports: node.config.ports.flatMap((port) => [
            { ...port, id: 'cards-first' },
            { ...port, id: 'cards-second' },
          ]),
        },
      })),
    };

    for (const candidate of [missing, incompatible, ambiguous]) {
      expect(projectInteractionState(transition.previous.value, candidate, state).ok).toBe(false);
      expect(state).toEqual({
        version: '1',
        values: [
          {
            nodeId: 'table-1',
            portId: 'selection',
            payload: { kind: 'selection', selection: { mode: 'ids', entity: 'employees', keys: ['e-1'], result: ref } },
          },
        ],
        drafts: [
          {
            domain: 'profile',
            entity: 'employees',
            key: 'e-1',
            field: 'name',
            value: 'Unfinished',
            entityRevision: '1',
          },
        ],
      });
    }
  });
});

describe('app facade interaction projection', () => {
  it('retains a compatible renamed port in the backing map after publication', () => {
    if (!previous.ok || !next.ok) throw Error('fixture');
    const region = {
      element: { presentation: previous.value, interaction: state },
      values: new Map(state.values.map((value) => [JSON.stringify([value.nodeId, value.portId]), value])),
    } as unknown as WebRegion;
    const projection = projectAppInteraction(region, next.value);
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect([...region.values.values()][0]?.portId).toBe('selection');
    retainAppInteraction(region, projection.value);
    expect([...region.values.values()][0]?.portId).toBe('chosen');
    expect([...region.values.keys()]).toEqual([JSON.stringify(['table-1', 'chosen'])]);
    expect([...region.values.values()][0]?.payload).toEqual(state.values[0]!.payload);
    expect(projection.value?.drafts).toEqual(state.drafts);
  });
});

it('retains interaction for an unchanged validated incumbent with no transfer operations', () => {
  if (!previous.ok) throw Error('previous');
  const region = { element: { presentation: previous.value, interaction: state } } as unknown as WebRegion;
  const unchanged = { ...previous.value, plan: { ...previous.value.plan, stateTransfer: [] } };
  expect(projectAppInteraction(region, unchanged)).toEqual({ ok: true, value: state });
  const changedPort = {
    ...unchanged,
    nodes: unchanged.nodes.map((node) => ({
      ...node,
      config: { ...node.config, ports: node.config.ports.map((port) => ({ ...port, entity: 'other' })) },
    })),
  };
  expect(projectAppInteraction(region, changedPort).ok).toBe(false);
  const changedScope = {
    ...unchanged,
    plan: { ...unchanged.plan, preconditions: { ...unchanged.plan.preconditions, scopeDigest: 'other' } },
  };
  expect(projectAppInteraction(region, changedScope).ok).toBe(false);
});
