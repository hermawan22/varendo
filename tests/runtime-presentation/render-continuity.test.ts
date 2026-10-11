import { describe, expect, it } from 'vitest';
import type { InteractionState, Result, Task } from '../../packages/core/src/index.js';
import {
  createPresentationRegistry,
  validatePresentationPlan,
  type PresentationManifest,
} from '../../packages/core/src/presentation/index.js';
import { projectInteractionState } from '../../packages/runtime/src/presentation/renderer.js';
import { prepareRenderContinuity } from '../../packages/web/src/app/render-continuity.js';
import { stableDataRecordKey } from '../../packages/web/src/data/shared.js';
import { rowIdentity } from '../../packages/web/src/region/data-registry-selection.js';
import { task, result, presentationPlan, environment, experience } from '../contracts/fixtures.js';

const table: PresentationManifest = {
  ref: { id: 'data.table', revision: '1' },
  configSchema: { id: 'data.table.config', revision: '1' },
  roles: ['table'],
  result: 'required',
  children: { min: 0, max: 0 },
  visibility: 'leaf',
  extension: false,
  operations: [],
  resolveConfig: () => ({
    ok: true,
    value: {
      values: {},
      fields: ['employee.id'],
      ports: [
        {
          id: 'selection',
          direction: 'inout',
          payload: 'selection',
          entity: 'employees',
          identity: ['employee.id'],
          grain: ['employee.id'],
        },
        {
          id: 'filter',
          direction: 'inout',
          payload: 'filter',
          entity: 'employees',
          identity: ['employee.id'],
          grain: ['employee.id'],
        },
      ],
    },
  }),
};
const page: PresentationManifest = {
  ...table,
  ref: { id: 'layout.page', revision: '1' },
  roles: ['structure'],
  result: 'none',
  children: { min: 0, max: 4 },
  visibility: 'simultaneous',
  resolveConfig: () => ({ ok: true, value: { values: {}, fields: [], ports: [] } }),
};
const registry = createPresentationRegistry([table, page]);
if (!registry.ok) throw Error('registry');
const baseContext = {
  task,
  experience: { ...experience, mode: 'composable' as const, allowedRepresentations: [table.ref.id, page.ref.id] },
  environment,
  results: [result],
  current: presentationPlan.preconditions,
  rendererCapabilities: [table.ref, page.ref],
};
const previous = validatePresentationPlan(presentationPlan, baseContext, registry.value);
if (!previous.ok) throw Error(JSON.stringify(previous.diagnostics));
const previousValue = previous.value;
const row = { 'employee.id': 'e-1' };
const identity = rowIdentity(row, result);
if (!identity.ok) throw Error('identity');
const interaction: InteractionState = {
  version: '1',
  drafts: [],
  values: [
    {
      nodeId: 'table-1',
      portId: 'selection',
      payload: {
        kind: 'selection',
        selection: { mode: 'ids', entity: 'employees', keys: [identity.value], result: result.ref },
      },
    },
    { nodeId: 'table-1', portId: 'filter', payload: { kind: 'filter', predicates: [], outputId: 'rows' } },
  ],
};
function input() {
  const nextTask: Task = {
    ...task,
    id: 'overview',
    goal: 'Page overview',
    viewPreference: { representation: 'layout.page', strength: 'preferred' },
  };
  const nextResult: Result = { ...result, taskId: nextTask.id, ref: { ...result.ref, id: 'result-next' } };
  return {
    previousTask: task,
    task: nextTask,
    previous: previousValue,
    interaction,
    current: { ...presentationPlan.preconditions, results: [result.ref, nextResult.ref] },
    results: [nextResult],
    bindings: [{ ref: nextResult.ref, rows: [row] }],
    previousAuthority: 'principal+scope+policy+grants',
    currentAuthority: 'principal+scope+policy+grants',
  };
}

describe('cross-intent render continuity', () => {
  it.each([undefined, { version: '1', values: [], drafts: [] }] as const)(
    'allows ordinary refreshed results without retained state (%j)',
    (empty) => {
      const request = input();
      const refreshed = { ...request.results[0]!, ref: { ...request.results[0]!.ref, revision: 'refreshed' } };
      const next = {
        ...request,
        interaction: empty,
        results: [refreshed],
        bindings: [{ ref: refreshed.ref, rows: [row] }],
        current: { ...request.current, results: [result.ref, refreshed.ref] },
      };
      expect(prepareRenderContinuity(next)).toEqual({ ok: true, value: { kind: 'replace' } });
      expect(prepareRenderContinuity({ ...next, currentAuthority: 'other-principal' }).ok).toBe(false);
      expect(prepareRenderContinuity({ ...next, current: { ...next.current, taskRevision: 'stale' } }).ok).toBe(false);
      expect(prepareRenderContinuity({ ...request, interaction: empty })).toMatchObject({
        ok: true,
        value: { kind: 'retain' },
      });
    },
  );

  it('never drops active drafts or accepts ambiguous owners when refreshing results', () => {
    const request = input();
    const refreshed = { ...request.results[0]!, ref: { ...request.results[0]!.ref, revision: 'refreshed' } };
    const empty: InteractionState = { version: '1', values: [], drafts: [] };
    const next = {
      ...request,
      results: [refreshed],
      current: { ...request.current, results: [result.ref, refreshed.ref] },
    };
    expect(
      prepareRenderContinuity({
        ...next,
        interaction: {
          ...empty,
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
        },
      }).ok,
    ).toBe(false);
    expect(prepareRenderContinuity({ ...next, interaction: empty, results: [refreshed, refreshed] }).ok).toBe(false);
  });
  it('retains layout-compatible tasks and rebases only proven member selections to the exact candidate result', () => {
    const request = input();
    const saved = structuredClone(interaction);
    const outcome = prepareRenderContinuity(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.kind !== 'retain') throw Error('continuity');
    expect(outcome.value.incumbent).toBe(previousValue.plan);
    expect(outcome.value.interaction?.values[0]?.payload).toEqual({
      kind: 'selection',
      selection: { mode: 'ids', entity: 'employees', keys: [identity.value], result: request.results[0]!.ref },
    });
    expect(outcome.value.interaction?.values[1]?.payload).toEqual(interaction.values[1]!.payload);
    expect(interaction).toEqual(saved);
  });
  it('proves actual table/card record keys and rejects another entity or malformed candidate identities', () => {
    const request = input();
    const selection = {
      mode: 'ids' as const,
      entity: 'employees',
      keys: [stableDataRecordKey(row, result.identity)!] as const,
      result: result.ref,
    };
    const state: InteractionState = {
      ...interaction,
      values: [{ nodeId: 'table-1', portId: 'selection', payload: { kind: 'selection', selection } }],
    };
    expect(prepareRenderContinuity({ ...request, interaction: state }).ok).toBe(true);
    expect(
      prepareRenderContinuity({
        ...request,
        interaction: {
          ...state,
          values: [
            { ...state.values[0]!, payload: { kind: 'selection', selection: { ...selection, entity: 'private' } } },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(prepareRenderContinuity({ ...request, bindings: [{ ...request.bindings[0]!, rows: [row, row] }] }).ok).toBe(
      false,
    );
    expect(
      prepareRenderContinuity({ ...request, bindings: [{ ...request.bindings[0]!, rows: [{ 'employee.id': 123 }] }] })
        .ok,
    ).toBe(false);
  });
  it('uses the existing validated projector for page/header/sidebar structural additions with stable child ids', () => {
    const request = input();
    const outcome = prepareRenderContinuity(request);
    if (!outcome.ok || outcome.value.kind !== 'retain') throw Error('continuity');
    const layout = (id: string, children: string[]) => ({
      id,
      role: 'structure',
      representation: page.ref,
      config: { schema: table.configSchema, values: {} },
      children,
    });
    const next = validatePresentationPlan(
      {
        ...presentationPlan,
        rootId: 'page',
        preconditions: request.current,
        nodes: [
          layout('page', ['header', 'sidebar', 'table-1']),
          layout('header', []),
          layout('sidebar', []),
          { ...presentationPlan.nodes[0], result: request.results[0]!.ref },
        ],
        stateTransfer: [
          { fromNode: 'table-1', toNode: 'table-1', mapping: { id: 'aeliqo.state.identity', revision: '1' } },
        ],
      },
      {
        ...baseContext,
        task: request.task,
        current: request.current,
        results: request.results,
        incumbent: outcome.value.incumbent,
      },
      registry.value,
    );
    expect(next.ok, JSON.stringify(next)).toBe(true);
    if (!next.ok) return;
    expect(projectInteractionState(previousValue, next.value, outcome.value.interaction)).toEqual({
      ok: true,
      value: outcome.value.interaction,
    });
  });
  it('rejects new authority, stale incarnation and missing old refs even when query is unchanged', () => {
    const request = input();
    expect(prepareRenderContinuity({ ...request, currentAuthority: 'other-principal' }).ok).toBe(false);
    expect(prepareRenderContinuity({ ...request, current: { ...request.current, taskRevision: 'stale' } }).ok).toBe(
      false,
    );
    expect(
      prepareRenderContinuity({ ...request, current: { ...request.current, results: [request.results[0]!.ref] } }).ok,
    ).toBe(false);
  });
  it('rejects missing selected members, ambiguous outputs, changed result scope/revision/lineage/shape', () => {
    const request = input();
    expect(
      prepareRenderContinuity({ ...request, bindings: [{ ...request.bindings[0]!, rows: [{ 'employee.id': 'e-2' }] }] })
        .ok,
    ).toBe(false);
    expect(prepareRenderContinuity({ ...request, results: [...request.results, request.results[0]!] }).ok).toBe(false);
    for (const patch of [
      { scopeDigest: 'other' },
      { revision: 'new' },
      { sourceLineage: 'other' },
      { queryDigest: 'other' },
    ]) {
      expect(
        prepareRenderContinuity({
          ...request,
          results: [{ ...request.results[0]!, ref: { ...request.results[0]!.ref, ...patch } }],
        }).ok,
      ).toBe(false);
    }
    expect(prepareRenderContinuity({ ...request, results: [{ ...request.results[0]!, identity: [] }] }).ok).toBe(false);
  });
  it('rejects unknown ownership and cohort rebasing rather than dropping state on layout transitions', () => {
    const request = input();
    expect(
      prepareRenderContinuity({
        ...request,
        interaction: { ...interaction, values: [{ ...interaction.values[0]!, nodeId: 'unknown' }] },
      }).ok,
    ).toBe(false);
    expect(
      prepareRenderContinuity({
        ...request,
        interaction: {
          ...interaction,
          values: [
            {
              nodeId: 'table-1',
              portId: 'selection',
              payload: {
                kind: 'selection',
                selection: {
                  mode: 'predicate',
                  entity: 'employees',
                  predicate: { op: 'is-null', field: 'employee.id', negate: false },
                  queryDigest: result.ref.queryDigest,
                  populationDigest: 'population-1',
                },
              },
            },
          ],
        },
      }).ok,
    ).toBe(false);
  });
  it('classifies an explicitly different query as new-task replacement', () => {
    const request = input();
    expect(
      prepareRenderContinuity({
        ...request,
        task: {
          ...task,
          id: 'new-goal',
          outputs: [
            {
              ...task.outputs[0],
              query: { ...task.outputs[0].query, order: [{ field: 'employee.id', direction: 'desc', nulls: 'last' }] },
            },
          ],
        },
      }),
    ).toEqual({ ok: true, value: { kind: 'replace' } });
  });
});
