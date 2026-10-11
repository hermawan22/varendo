import { describe, expect, it } from 'vitest';
import {
  composePresentation,
  createPresentationRegistry,
  validatePresentationPlan,
} from '../../packages/core/src/presentation/index.js';
import { stateMappingFor } from '../../packages/core/src/presentation/state.js';
import type {
  PresentationContext,
  PresentationManifest,
  PresentationPatternManifest,
  PresentationRegistry,
} from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/types.js';
import { environment, experience, presentationPlan, presentationTask, result } from './fixtures.js';

const read = { id: 'data.read', revision: '1' };
const table: PresentationManifest = {
  ref: { id: 'data.table', revision: '1' },
  configSchema: { id: 'data.table.config', revision: '1' },
  roles: ['table'],
  operations: [read],
  result: 'required',
  children: { min: 0, max: 0 },
  visibility: 'leaf',
  extension: false,
  resolveConfig: (values, descriptor) =>
    Object.keys(values).length === 0 && descriptor !== undefined
      ? { ok: true, value: { values: {}, fields: descriptor.fields.map((f) => f.id), ports: [] } }
      : {
          ok: false,
          diagnostics: [
            {
              code: 'table.config',
              message: 'Only the registered empty table config is supported here.',
              retryable: false,
            },
          ],
        },
  suggestConfig: () => ({ ok: true, value: {} }),
};
const stack: PresentationManifest = {
  ref: { id: 'layout.stack', revision: '1' },
  configSchema: { id: 'layout.stack.config', revision: '1' },
  roles: ['structure'],
  operations: [],
  result: 'none',
  children: { min: 0, max: 32 },
  visibility: 'simultaneous',
  extension: false,
  resolveConfig: (values) =>
    Object.keys(values).length === 0
      ? { ok: true, value: { values: {}, fields: [], ports: [] } }
      : { ok: false, diagnostics: [{ code: 'layout.config', message: 'Invalid layout config.', retryable: false }] },
  suggestConfig: () => ({ ok: true, value: {} }),
};
function registry(entries: readonly PresentationManifest[] = [table, stack]): PresentationRegistry {
  const r = createPresentationRegistry(entries);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
const context = (): PresentationContext => ({
  task: {
    ...presentationTask,
    needs: [{ id: 'browse', operation: read, fields: ['employee.id'], outputId: 'rows', required: true }],
  },
  experience: { ...experience, mode: 'composable', allowedRepresentations: ['data.table', 'layout.stack'] },
  results: [result],
  current: presentationPlan.preconditions,
  environment,
  rendererCapabilities: [table.ref, stack.ref],
});
const plan = (): PresentationPlan => ({
  ...presentationPlan,
  coverage: [{ needId: 'browse', nodeIds: ['table-1'], operations: [read] }],
});
const checked = (p: unknown, ctx = context(), r = registry()) => validatePresentationPlan(p, ctx, r);

describe('registered presentation feasibility', () => {
  it('resolves actual field coverage, freezes owned values and preserves unknown SSR measurements', () => {
    const p = plan();
    const c = context();
    const parsed = checked(p, c);
    expect(parsed).toMatchObject({
      ok: true,
      value: { environment: { inlineSize: { state: 'unknown' } }, nodes: [{ config: { fields: ['employee.id'] } }] },
    });
    if (!parsed.ok) return;
    expect(parsed.value.plan).not.toBe(p);
    expect(Object.isFrozen(parsed.value.plan.nodes[0]!.config.values)).toBe(true);
    expect(parsed.value.nodes[0]!.result).not.toBe(c.results[0]);
  });
  it('rejects arbitrary configuration, unknown renderer versions, and forged approval', () => {
    expect(checked({ ...plan(), approved: true }).ok).toBe(false);
    expect(
      checked({
        ...plan(),
        nodes: [
          { ...plan().nodes[0]!, config: { ...plan().nodes[0]!.config, values: { html: '<script>bad</script>' } } },
        ],
      }).ok,
    ).toBe(false);
    expect(
      checked({ ...plan(), nodes: [{ ...plan().nodes[0]!, representation: { ...table.ref, revision: '2' } }] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.renderer' }] });
    expect(checked(plan(), { ...context(), rendererCapabilities: [] }).ok).toBe(false);
  });
  it('rejects descriptor, read-set and task/profile staleness', () => {
    expect(checked(plan(), { ...context(), results: [] }).ok).toBe(false);
    const unauthorized = { ...context(), current: { ...context().current, results: [] } };
    expect(
      composePresentation(
        { id: 'unauthorized', revision: '1', context: unauthorized, preconditions: unauthorized.current },
        registry(),
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.results' }] });
    expect(checked(plan(), { ...context(), current: { ...context().current, regionRevision: 'new' } })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'commit.stale' }],
    });
    expect(checked(plan(), { ...context(), task: { ...context().task, revision: 'new' } }).ok).toBe(false);
    expect(checked({ ...plan(), preconditions: { ...plan().preconditions, results: [] } }).ok).toBe(false);
  });
  it('enforces actual operations and information coverage rather than trusting the coverage annotation', () => {
    expect(checked({ ...plan(), coverage: [] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.coverage' }],
    });
    expect(
      checked(plan(), {
        ...context(),
        task: { ...context().task, needs: [{ ...context().task.needs[0]!, fields: ['not-displayed'] }] },
      }).ok,
    ).toBe(false);
    expect(checked(plan(), context(), registry([{ ...table, operations: [] }, stack])).ok).toBe(false);
    expect(checked({ ...plan(), coverage: [{ ...plan().coverage[0]!, nodeIds: ['missing'] }] }).ok).toBe(false);
    expect(checked({ ...plan(), coverage: [...plan().coverage, ...plan().coverage] }).ok).toBe(false);
  });
  it('rejects cycles, unreachable nodes, duplicated child ownership and wrong root', () => {
    const child = { ...plan().nodes[0]!, id: 'child' };
    for (const p of [
      { ...plan(), rootId: 'missing' },
      { ...plan(), nodes: [plan().nodes[0]!, child] },
      { ...plan(), nodes: [{ ...plan().nodes[0]!, children: ['child', 'child'] }, child] },
      {
        ...plan(),
        nodes: [
          { ...plan().nodes[0]!, children: ['child'] },
          { ...child, children: ['table-1'] },
        ],
      },
    ])
      expect(checked(p).ok).toBe(false);
  });
  it('requires the claimed operation to be enabled by the resolved configuration', () => {
    const configured = (operations: readonly { id: string; revision: string }[]): PresentationManifest => ({
      ...table,
      resolveConfig: (values, descriptor) => ({
        ok: true,
        value: { values, fields: descriptor!.fields.map((f) => f.id), ports: [], operations },
      }),
    });
    expect(checked(plan(), context(), registry([configured([]), stack]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.coverage' }],
    });
    expect(checked(plan(), context(), registry([configured([read]), stack])).ok).toBe(true);
    expect(
      checked(plan(), context(), registry([configured([{ id: 'undeclared', revision: '1' }]), stack])),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.configuration' }] });
    expect(checked(plan(), context(), registry([configured([read, read]), stack]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.configuration' }],
    });
    const composed = composePresentation(
      { id: 'disabled-read', revision: '1', preconditions: plan().preconditions, context: context() },
      registry([configured([]), stack]),
    );
    expect(composed).toMatchObject({ ok: true, value: { status: 'conflict' } });
  });
  it('intersects profile and explicit restrictions, including no-preset prohibition', () => {
    expect(
      checked(plan(), { ...context(), experience: { ...context().experience, allowedRepresentations: [] } }).ok,
    ).toBe(false);
    expect(checked(plan(), { ...context(), restrictions: [{ id: 'deny-read', allowedOperations: [] }] }).ok).toBe(
      false,
    );
    expect(
      checked(plan(), {
        ...context(),
        experience: {
          ...context().experience,
          composition: { ...context().experience.composition, allowWithoutPreset: false },
        },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.pattern-required' }] });
  });
  it('does not let exclusive panels conceal a required simultaneous comparison', () => {
    const second = { ...plan().nodes[0]!, id: 'second' };
    const p: PresentationPlan = {
      ...plan(),
      rootId: 'layout',
      nodes: [
        {
          id: 'layout',
          role: 'structure',
          representation: stack.ref,
          config: { schema: stack.configSchema, values: {} },
          children: ['table-1', 'second'],
        },
        ...plan().nodes,
        second,
      ],
      coverage: [...plan().coverage, { needId: 'compare', nodeIds: ['second'], operations: [read] }],
    };
    const c: PresentationContext = {
      ...context(),
      task: {
        ...context().task,
        needs: [
          { ...context().task.needs[0]!, simultaneousGroup: 'comparison' },
          { ...context().task.needs[0]!, id: 'compare', simultaneousGroup: 'comparison' },
        ],
      },
    };
    expect(checked(p, c).ok).toBe(true);
    expect(checked(p, c, registry([table, { ...stack, visibility: 'exclusive' }]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.simultaneous' }],
    });
  });
  it('keeps fixed layouts and active focus/draft transitions stable', () => {
    const p: PresentationPlan = {
      ...plan(),
      nodes: [{ ...plan().nodes[0]!, id: 'new' }],
      rootId: 'new',
      coverage: [{ ...plan().coverage[0]!, nodeIds: ['new'] }],
    };
    expect(
      checked(p, { ...context(), incumbent: plan(), experience: { ...context().experience, mode: 'fixed' } }).ok,
    ).toBe(false);
    expect(checked(p, { ...context(), incumbent: plan(), transitionBlocked: true }).ok).toBe(false);
    expect(
      checked(p, {
        ...context(),
        incumbent: plan(),
        experience: { ...context().experience, transitionPolicy: 'explicit-only' },
      }).ok,
    ).toBe(false);
    expect(
      checked(p, {
        ...context(),
        incumbent: plan(),
        experience: { ...context().experience, transitionPolicy: 'explicit-only' },
        explicitTransition: true,
      }).ok,
    ).toBe(false);
  });
  it('retains installed mappings and validates real linked selection ports', () => {
    const shape = {
      payload: 'selection' as const,
      entity: 'employees',
      identity: ['employee.id'],
      grain: ['employee.id'],
    };
    const mapped = createPresentationRegistry(
      [
        {
          ...table,
          resolveConfig: (values, descriptor) => ({
            ok: true,
            value: {
              values,
              fields: descriptor!.fields.map((f) => f.id),
              ports: [{ ...shape, id: 'selection', direction: 'inout' }],
            },
          }),
        },
        stack,
      ],
      [{ ref: { id: 'selection.identity', revision: '1' }, source: shape, target: shape, kind: 'identity' }],
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.value.mappings).toHaveLength(1);
    const p: PresentationPlan = {
      ...plan(),
      rootId: 'layout',
      nodes: [
        {
          id: 'layout',
          role: 'structure',
          representation: stack.ref,
          config: { schema: stack.configSchema, values: {} },
          children: ['table-1', 'second'],
        },
        ...plan().nodes,
        { ...plan().nodes[0]!, id: 'second' },
      ],
      links: [
        {
          id: 'linked',
          source: { node: 'table-1', port: 'selection' },
          target: { node: 'second', port: 'selection' },
          mapping: { id: 'selection.identity', revision: '1' },
          propagation: 'identity-equivalence',
        },
      ],
    };
    expect(checked(p, context(), mapped.value)).toMatchObject({
      ok: true,
      value: { graph: { links: [{ id: 'linked' }] } },
    });
  });
  it('requires explicit identity transfers while adding a layout around a stable view', () => {
    const p: PresentationPlan = {
      ...plan(),
      rootId: 'layout',
      nodes: [
        {
          id: 'layout',
          role: 'structure',
          representation: stack.ref,
          config: { schema: stack.configSchema, values: {} },
          children: ['table-1'],
        },
        ...plan().nodes,
      ],
    };
    const c = { ...context(), incumbent: plan() };
    expect(checked(p, c)).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.state-transfer' }] });
    const transfer = {
      fromNode: 'table-1',
      toNode: 'table-1',
      mapping: { id: 'aeliqo.state.identity', revision: '1' },
    };
    expect(checked({ ...p, stateTransfer: [transfer] }, c).ok).toBe(true);
    expect(checked({ ...p, stateTransfer: [transfer, transfer] }, c).ok).toBe(false);
  });
  it('rejects unsupported state transfers and asynchronous/malformed configuration validators', () => {
    expect(
      checked(
        {
          ...plan(),
          stateTransfer: [{ fromNode: 'table-1', toNode: 'table-1', mapping: { id: 'fake', revision: '1' } }],
        },
        { ...context(), incumbent: plan() },
      ).ok,
    ).toBe(false);
    expect(
      checked(
        plan(),
        context(),
        registry([
          {
            ...table,
            resolveConfig: (() => Promise.resolve({ ok: true, value: { values: {}, fields: [], ports: [] } })) as never,
          },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      checked(
        plan(),
        context(),
        registry([
          { ...table, resolveConfig: () => ({ ok: true, value: { values: {}, fields: ['invented'], ports: [] } }) },
        ]),
      ).ok,
    ).toBe(false);
  });
  it('keeps registered patterns bounded, version-unique, frozen and behind shared validation', () => {
    let callbackSawFrozenContext = false;
    const preset: PresentationPatternManifest = {
      ref: { id: 'preset.table', revision: '1' },
      expand: ({ context: patternContext }) => {
        callbackSawFrozenContext =
          Object.isFrozen(patternContext) &&
          Object.isFrozen(patternContext.task) &&
          Object.isFrozen(patternContext.results);
        return { ok: true, value: plan() };
      },
      matches: (candidate, patternContext) => {
        callbackSawFrozenContext =
          callbackSawFrozenContext && Object.isFrozen(patternContext) && Object.isFrozen(candidate);
        return candidate.nodes.length === 1 && candidate.nodes[0]!.representation.id === table.ref.id;
      },
    };
    const installed = createPresentationRegistry([table, stack], [], [preset]);
    expect(installed).toMatchObject({ ok: true, value: { patterns: [{ ref: preset.ref }] } });
    if (!installed.ok) return;
    expect(Object.isFrozen(installed.value.patterns)).toBe(true);
    expect(Object.isFrozen(installed.value.patterns![0])).toBe(true);
    const c: PresentationContext = {
      ...context(),
      experience: {
        ...context().experience,
        allowedPatterns: [preset.ref.id],
        composition: { ...context().experience.composition, allowWithoutPreset: false },
      },
    };
    const composed = composePresentation(
      {
        id: 'pattern-compose',
        revision: '1',
        context: c,
        preconditions: c.current,
        candidates: [{ source: 'pattern', pattern: preset.ref, plan: plan() }],
      },
      installed.value,
    );
    expect(composed).toMatchObject({
      ok: true,
      value: { status: 'composed', presentation: { plan: { id: 'pattern-compose' } } },
    });
    expect(callbackSawFrozenContext).toBe(true);
    expect(
      createPresentationRegistry([table, stack], [], [preset, { ...preset, ref: { id: preset.ref.id, revision: '2' } }])
        .ok,
    ).toBe(false);

    const forged = composePresentation(
      {
        id: 'forged-pattern',
        revision: '1',
        context: c,
        preconditions: c.current,
        candidates: [{ source: 'pattern', pattern: { ...preset.ref, revision: '2' }, plan: plan() }],
      },
      installed.value,
    );
    expect(forged).toMatchObject({
      ok: true,
      value: {
        status: 'composed',
        rejected: [{ candidate: 'candidate.0', diagnostics: [{ code: 'presentation.pattern-required' }] }],
      },
    });
  });
  it('supplies patterns an owned, current incumbent for explicit state transfers', () => {
    const previous = plan();
    let seen: PresentationPlan | undefined;
    const preset: PresentationPatternManifest = {
      ref: { id: 'preset.incumbent', revision: '1' },
      expand(request) {
        seen = request.context.incumbent;
        return { ok: true, value: plan() };
      },
      matches: () => true,
    };
    const installed = createPresentationRegistry([table, stack], [], [preset]);
    if (!installed.ok) throw new Error('fixture');
    const c = {
      ...context(),
      incumbent: previous,
      experience: { ...context().experience, allowedPatterns: [preset.ref.id] },
    };
    const composed = composePresentation(
      {
        id: 'owned-incumbent',
        revision: '1',
        context: c,
        preconditions: c.current,
        candidates: [{ source: 'pattern', pattern: preset.ref, plan: plan() }],
      },
      installed.value,
    );
    expect(composed.ok).toBe(true);
    expect(seen).toEqual(previous);
    expect(seen).not.toBe(previous);
    expect(Object.isFrozen(seen?.nodes)).toBe(true);
    seen = undefined;
    const stale = { ...previous, preconditions: { ...previous.preconditions, scopeDigest: 'another-scope' } };
    const rejected = composePresentation(
      {
        id: 'stale-incumbent',
        revision: '1',
        context: { ...c, incumbent: stale },
        preconditions: c.current,
        candidates: [{ source: 'pattern', pattern: preset.ref, plan: plan() }],
      },
      installed.value,
    );
    expect(rejected.ok).toBe(false);
    expect(seen).toBeUndefined();
  });
  it('rejects asynchronous or invalid assessors and ranks bounded measured quality deterministically', () => {
    const badQuality = {
      ...table,
      assess: () => ({
        ok: true as const,
        value: { taskFit: 101, informationDensity: 0, interactionEffort: 0, legibilityPenalty: 0 },
      }),
    };
    expect(checked(plan(), context(), registry([badQuality, stack]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.quality' }],
    });
    const asyncQuality = {
      ...table,
      assess: (() =>
        Promise.resolve({
          ok: true,
          value: { taskFit: 50, informationDensity: 50, interactionEffort: 0, legibilityPenalty: 0 },
        })) as never,
    };
    expect(checked(plan(), context(), registry([asyncQuality, stack]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.quality' }],
    });

    const low: PresentationManifest = {
      ...table,
      ref: { id: 'data.low', revision: '1' },
      configSchema: { id: 'data.low.config', revision: '1' },
      assess: () => ({
        ok: true,
        value: {
          taskFit: 10,
          informationDensity: 10,
          interactionEffort: 90,
          legibilityPenalty: 90,
          cost: { microseconds: 900_000_000, measurement: { id: 'measure.low', revision: '1' } },
        },
      }),
    };
    const high: PresentationManifest = {
      ...table,
      ref: { id: 'data.high', revision: '1' },
      configSchema: { id: 'data.high.config', revision: '1' },
      assess: () => ({
        ok: true,
        value: {
          taskFit: 90,
          informationDensity: 80,
          interactionEffort: 10,
          legibilityPenalty: 0,
          cost: { microseconds: 1, measurement: { id: 'measure.high', revision: '1' } },
        },
      }),
    };
    const r = registry([low, high]);
    const c: PresentationContext = {
      ...context(),
      experience: {
        ...context().experience,
        allowedRepresentations: [low.ref.id, high.ref.id],
        composition: { ...context().experience.composition, maxExpansions: 8 },
      },
      rendererCapabilities: [low.ref, high.ref],
    };
    const composed = composePresentation(
      { id: 'quality-compose', revision: '1', context: c, preconditions: c.current },
      r,
    );
    expect(composed).toMatchObject({
      ok: true,
      value: { status: 'composed', presentation: { plan: { nodes: [{ representation: high.ref }] } } },
    });
    if (!composed.ok || composed.value.presentation === undefined) return;
    expect(Object.isFrozen(composed.value.presentation.nodes[0]!.quality)).toBe(true);
    expect(composed.value.presentation.nodes[0]!.quality?.cost?.measurement).toEqual({
      id: 'measure.high',
      revision: '1',
    });
  });
  it('composes multiple required needs under one simultaneous layout without a Cartesian search', () => {
    const baseNeed = context().task.needs[0]!;
    const c: PresentationContext = {
      ...context(),
      task: { ...context().task, needs: [baseNeed, { ...baseNeed, id: 'compare', simultaneousGroup: 'comparison' }] },
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 8 } },
    };
    const composed = composePresentation(
      { id: 'multi-compose', revision: '1', context: c, preconditions: c.current },
      registry(),
    );
    expect(composed).toMatchObject({
      ok: true,
      value: {
        status: 'composed',
        expansions: 1,
        presentation: {
          plan: { rootId: 'layout', nodes: [{ id: 'layout' }, { id: 'view.browse' }, { id: 'view.compare' }] },
        },
      },
    });
    if (!composed.ok || composed.value.presentation === undefined) return;
    expect(validatePresentationPlan(composed.value.presentation.plan, c, registry()).ok).toBe(true);
  });
  it('constructs a complete no-preset candidate within a one-expansion budget', () => {
    const c: PresentationContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 1 } },
    };
    const composed = composePresentation(
      { id: 'composed', revision: '1', preconditions: c.current, context: c },
      registry(),
    );
    expect(composed).toMatchObject({
      ok: true,
      value: { status: 'composed', expansions: 1, presentation: { plan: { rootId: 'view.browse' } } },
    });
    if (!composed.ok || composed.value.presentation === undefined) return;
    expect(checked(composed.value.presentation.plan, c).ok).toBe(true);
    expect(composed.value.presentation.plan.coverage).toEqual([
      { needId: 'browse', nodeIds: ['view.browse'], operations: [read] },
    ]);
  });
  it('uses the same validator for explicit candidates and retains a feasible incumbent', () => {
    const r = registry();
    const c = { ...context(), incumbent: plan() };
    expect(
      composePresentation({ id: 'compose', revision: '1', context: c, preconditions: c.current }, r),
    ).toMatchObject({
      ok: true,
      value: { status: 'composed', expansions: 2, presentation: { plan: { id: 'compose' } } },
    });
    const explicit = composePresentation(
      {
        id: 'compose',
        revision: '1',
        context: context(),
        preconditions: c.current,
        candidates: [{ source: 'explicit', plan: { ...plan(), coverage: [] } }],
      },
      r,
    );
    expect(explicit).toMatchObject({
      ok: true,
      value: { status: 'composed', expansions: 2, rejected: [{ candidate: 'candidate.0' }] },
    });
  });
  it('rejects stale or invalid composition requests even with a feasible incumbent', () => {
    const c = { ...context(), incumbent: plan() };
    expect(
      composePresentation(
        { id: 'compose', revision: '1', context: c, preconditions: { ...c.current, regionRevision: 'stale' } },
        registry(),
      ).ok,
    ).toBe(false);
    expect(composePresentation({ id: '', revision: '1', context: c, preconditions: c.current }, registry()).ok).toBe(
      false,
    );
  });
  it('refuses ambiguous generated output revisions and results outside the Task inputs', () => {
    const other = { ...result, ref: { ...result.ref, revision: 'other' } };
    const c: PresentationContext = {
      ...context(),
      results: [other, result],
      current: { ...context().current, results: [other.ref, result.ref] },
    };
    expect(
      composePresentation({ id: 'compose', revision: '1', context: c, preconditions: c.current }, registry()),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.ambiguous-result' }] });
    expect(
      checked({ ...plan(), preconditions: c.current, nodes: [{ ...plan().nodes[0]!, result: other.ref }] }, c),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.binding' }] });
  });
  it('guards changes to operation coverage while an interaction owns the active view', () => {
    const c = { ...context(), incumbent: plan(), transitionBlocked: true };
    const p = { ...plan(), coverage: [{ ...plan().coverage[0]!, operations: [read, { id: 'other', revision: '1' }] }] };
    expect(
      checked(p, c, registry([{ ...table, operations: [read, { id: 'other', revision: '1' }] }, stack])),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.transition' }] });
  });
  it('reports exhausted search separately from impossibility and does not exceed its bound', () => {
    const r = registry();
    const c: PresentationContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 1 } },
    };
    expect(
      composePresentation(
        {
          id: 'compose',
          revision: '1',
          context: c,
          preconditions: c.current,
          candidates: [{ source: 'explicit', plan: plan() }],
        },
        r,
      ),
    ).toMatchObject({
      ok: true,
      value: { status: 'search-exhausted', expansions: 1, presentation: { plan: { coverage: plan().coverage } } },
    });
    expect(createPresentationRegistry([table, table]).ok).toBe(false);
  });
  it('finalizes an explicit incumbent immediately when it consumes the exact search budget', () => {
    const c: PresentationContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 1 } },
    };
    const installed = registry();
    let fallbackFilterReads = 0;
    const manifests = new Proxy(installed.manifests, {
      get(target, property, receiver) {
        if (property === 'filter') fallbackFilterReads++;
        return Reflect.get(target, property, receiver);
      },
    });
    const composed = composePresentation(
      {
        id: 'exact-budget',
        revision: '1',
        context: c,
        preconditions: c.current,
        candidates: [{ source: 'explicit', plan: plan() }],
      },
      { ...installed, manifests },
    );
    expect(composed).toMatchObject({
      ok: true,
      value: { status: 'search-exhausted', expansions: 1, presentation: { plan: { id: 'exact-budget' } } },
    });
    expect(fallbackFilterReads).toBe(0);
  });
});

describe('configuration-dependent child layout', () => {
  it('passes parsed node structure to registered resolvers before accepting coverage', () => {
    const r = registry([
      table,
      {
        ...stack,
        resolveConfig: (values, result, node) =>
          node?.children.length === 1
            ? { ok: true, value: { values: {}, fields: [], ports: [] } }
            : {
                ok: false,
                diagnostics: [{ code: 'slots', message: 'One registered slot is available.', retryable: false }],
              },
      },
    ]);
    const leaf = plan().nodes[0]!;
    const p = {
      ...plan(),
      rootId: 'container',
      nodes: [
        {
          id: 'container',
          role: 'structure',
          representation: stack.ref,
          config: { schema: stack.configSchema, values: {} },
          children: [leaf.id],
        },
        leaf,
      ],
    };
    expect(checked(p, context(), r).ok).toBe(true);
    expect(
      checked(
        { ...p, nodes: [{ ...p.nodes[0]!, children: [leaf.id, 'extra'] }, leaf, { ...leaf, id: 'extra' }] },
        context(),
        r,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.configuration' }] });
  });
});

it('rejects forbidden enabled operations even when coverage only claims an allowed read', () => {
  const write = { id: 'data.write', revision: '1' };
  const c = { ...context(), restrictions: [{ id: 'read-only', allowedOperations: [read] }] };
  expect(checked(plan(), c, registry([{ ...table, operations: [read, write] }, stack]))).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'presentation.restricted' }],
  });
});
it('composes a registered no-result root for a queryless task without required needs', () => {
  const c = { ...context(), task: { ...presentationTask, needs: [] } };
  const composed = composePresentation(
    { id: 'queryless', revision: '1', preconditions: c.current, context: c },
    registry(),
  );
  expect(composed).toMatchObject({
    ok: true,
    value: { status: 'composed', presentation: { plan: { coverage: [], nodes: [{ representation: stack.ref }] } } },
  });
});
it('requires an exact renderer-implemented mapping for equivalent representation replacement', () => {
  const list: PresentationManifest = {
    ...table,
    ref: { id: 'data.list', revision: '1' },
    assess: () => ({
      ok: true,
      value: { taskFit: 100, informationDensity: 50, interactionEffort: 0, legibilityPenalty: 0 },
    }),
  };
  const mapping = {
    ref: { id: 'state.table-list', revision: '1' },
    from: table.ref,
    to: list.ref,
    fromRole: 'table',
    toRole: 'table',
    kind: 'transfer' as const,
  };
  const installed = createPresentationRegistry([table, list, stack], [], [], [mapping]);
  expect(installed.ok).toBe(true);
  if (!installed.ok) return;
  const c: PresentationContext = {
    ...context(),
    incumbent: plan(),
    experience: {
      ...context().experience,
      mode: 'adaptive',
      allowedRepresentations: ['data.table', 'data.list', 'layout.stack'],
    },
    rendererCapabilities: [table.ref, list.ref, stack.ref],
    stateMappingCapabilities: [mapping.ref],
  };
  const candidate: PresentationPlan = {
    ...plan(),
    nodes: [{ ...plan().nodes[0]!, representation: list.ref }],
    stateTransfer: [{ fromNode: 'table-1', toNode: 'table-1', mapping: mapping.ref }],
  };
  expect(checked(candidate, c, installed.value).ok).toBe(true);
  expect(checked(candidate, { ...c, stateMappingCapabilities: [] }, installed.value)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'presentation.state-transfer' }],
  });
  expect(checked(candidate, { ...c, transitionBlocked: true }, installed.value).ok).toBe(false);
  expect(
    checked(
      {
        ...candidate,
        stateTransfer: [{ ...candidate.stateTransfer[0]!, mapping: { ...mapping.ref, revision: 'stale' } }],
      },
      c,
      installed.value,
    ).ok,
  ).toBe(false);
  const composed = composePresentation(
    { id: 'replacement', revision: '2', preconditions: c.current, context: c },
    installed.value,
  );
  expect(composed).toMatchObject({
    ok: true,
    value: {
      presentation: {
        plan: { nodes: [{ id: 'table-1', representation: list.ref }], stateTransfer: [{ mapping: mapping.ref }] },
      },
    },
  });
});
it('allows an explicit renderer mapping to preserve state across different adaptive roles', () => {
  const cards: PresentationManifest = { ...table, ref: { id: 'data.cards', revision: '1' }, roles: ['cardCollection'] };
  const mapping = {
    ref: { id: 'state.table-cards', revision: '1' },
    from: table.ref,
    to: cards.ref,
    fromRole: 'table',
    toRole: 'cardCollection',
    kind: 'transfer' as const,
  };
  const installed = createPresentationRegistry([table, cards, stack], [], [], [mapping]);
  expect(installed.ok).toBe(true);
  if (!installed.ok) return;
  expect(installed.value.stateMappings).toEqual([mapping]);
  const adaptive: PresentationContext = {
    ...context(),
    incumbent: plan(),
    experience: { ...context().experience, mode: 'adaptive', allowedRepresentations: ['data.table', 'data.cards'] },
    rendererCapabilities: [table.ref, cards.ref, stack.ref],
    stateMappingCapabilities: [mapping.ref],
  };
  const candidate: PresentationPlan = {
    ...plan(),
    nodes: [{ ...plan().nodes[0]!, role: 'cardCollection', representation: cards.ref }],
    stateTransfer: [{ fromNode: 'table-1', toNode: 'table-1', mapping: mapping.ref }],
  };
  expect(checked(candidate, adaptive, installed.value).ok).toBe(true);
  expect(
    checked(candidate, { ...adaptive, experience: { ...adaptive.experience, mode: 'fixed' } }, installed.value),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.transition' }] });
});
it('rejects ambiguous semantic state-mapping edges and does not infer unsupported mappings', () => {
  const cards: PresentationManifest = { ...table, ref: { id: 'data.cards', revision: '1' }, roles: ['cardCollection'] };
  const mapping = {
    ref: { id: 'state.table-cards', revision: '1' },
    from: table.ref,
    to: cards.ref,
    fromRole: 'table',
    toRole: 'cardCollection',
    kind: 'transfer' as const,
  };
  const duplicate = { ...mapping, ref: { id: 'state.table-cards-alternate', revision: '1' } };

  expect(createPresentationRegistry([table, cards, stack], [], [], [mapping, duplicate])).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'presentation.registry' }],
  });

  const installed = createPresentationRegistry([table, cards, stack], [], [], [mapping]);
  expect(installed.ok).toBe(true);
  if (!installed.ok) return;
  const from = plan().nodes[0]!;
  const to = { ...from, role: 'cardCollection', representation: cards.ref };
  const supported = stateMappingFor(
    from,
    to,
    installed.value,
    { ...context(), stateMappingCapabilities: [mapping.ref] },
    'transfer',
  );
  const unsupported = stateMappingFor(
    from,
    to,
    installed.value,
    { ...context(), stateMappingCapabilities: [] },
    'transfer',
  );
  const ambiguous = stateMappingFor(
    from,
    to,
    { ...installed.value, stateMappings: [mapping, duplicate] },
    { ...context(), stateMappingCapabilities: [mapping.ref, duplicate.ref] },
    'transfer',
  );

  expect(supported).toEqual(mapping);
  expect(unsupported).toBeUndefined();
  expect(ambiguous).toBeUndefined();
});
it('requires a registered archival owner before removing a composable view', () => {
  const archive = {
    ref: { id: 'state.archive-table', revision: '1' },
    from: table.ref,
    to: stack.ref,
    fromRole: 'table',
    toRole: 'structure',
    kind: 'archive' as const,
  };
  const installed = createPresentationRegistry([table, stack], [], [], [archive]);
  expect(installed.ok).toBe(true);
  if (!installed.ok) return;
  const root = {
    id: 'layout',
    role: 'structure',
    representation: stack.ref,
    config: { schema: stack.configSchema, values: {} },
    children: ['table-1', 'secondary'],
  };
  const incumbent: PresentationPlan = {
    ...plan(),
    rootId: 'layout',
    nodes: [root, ...plan().nodes, { ...plan().nodes[0]!, id: 'secondary' }],
  };
  const c = { ...context(), incumbent, stateMappingCapabilities: [archive.ref] };
  const candidate: PresentationPlan = {
    ...incumbent,
    nodes: [{ ...root, children: ['table-1'] }, ...plan().nodes],
    stateTransfer: [
      { fromNode: 'layout', toNode: 'layout', mapping: { id: 'aeliqo.state.identity', revision: '1' } },
      { fromNode: 'table-1', toNode: 'table-1', mapping: { id: 'aeliqo.state.identity', revision: '1' } },
      { fromNode: 'secondary', toNode: 'layout', mapping: archive.ref },
    ],
  };
  expect(checked(candidate, c, installed.value).ok).toBe(true);
  const retained = composePresentation(
    { id: 'retained', revision: '2', preconditions: c.current, context: { ...c, incumbent: candidate } },
    installed.value,
  );
  expect(retained).toMatchObject({
    ok: true,
    value: { presentation: { plan: { nodes: candidate.nodes, stateTransfer: [] } } },
  });
  expect(checked(candidate, { ...c, stateMappingCapabilities: [] }, installed.value).ok).toBe(false);
  expect(checked({ ...candidate, stateTransfer: candidate.stateTransfer.slice(0, 2) }, c, installed.value).ok).toBe(
    false,
  );
});
it('preserves a custom root identity when generated layouts use a registered transfer', () => {
  const alternate: PresentationManifest = {
    ...stack,
    ref: { id: 'layout.alternate', revision: '1' },
    assess: () => ({
      ok: true,
      value: { taskFit: 100, informationDensity: 100, interactionEffort: 0, legibilityPenalty: 0 },
    }),
  };
  const mapping = {
    ref: { id: 'state.layout-layout', revision: '1' },
    from: stack.ref,
    to: alternate.ref,
    fromRole: 'structure',
    toRole: 'structure',
    kind: 'transfer' as const,
  };
  const installed = createPresentationRegistry([table, stack, alternate], [], [], [mapping]);
  expect(installed.ok).toBe(true);
  if (!installed.ok) return;
  const old: PresentationPlan = {
    ...plan(),
    rootId: 'custom-root',
    nodes: [
      {
        id: 'custom-root',
        role: 'structure',
        representation: stack.ref,
        config: { schema: stack.configSchema, values: {} },
        children: ['table-1', 'second'],
      },
      ...plan().nodes,
      { ...plan().nodes[0]!, id: 'second' },
    ],
    coverage: [...plan().coverage, { needId: 'other', nodeIds: ['second'], operations: [read] }],
  };
  const c: PresentationContext = {
    ...context(),
    task: { ...context().task, needs: [...context().task.needs, { ...context().task.needs[0]!, id: 'other' }] },
    incumbent: old,
    experience: { ...context().experience, allowedRepresentations: ['data.table', 'layout.stack', 'layout.alternate'] },
    rendererCapabilities: [table.ref, stack.ref, alternate.ref],
    stateMappingCapabilities: [mapping.ref],
  };
  const composed = composePresentation(
    { id: 'root-replacement', revision: '2', preconditions: c.current, context: c },
    installed.value,
  );
  expect(composed).toMatchObject({
    ok: true,
    value: {
      presentation: {
        plan: {
          rootId: 'custom-root',
          stateTransfer: expect.arrayContaining([
            { fromNode: 'custom-root', toNode: 'custom-root', mapping: mapping.ref },
          ]),
        },
      },
    },
  });
});
it('finishes a feasible first candidate within one expansion instead of spending the budget on preparation', () => {
  const c = {
    ...context(),
    experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 1 } },
  };
  const composed = composePresentation(
    { id: 'one-expansion', revision: '1', preconditions: c.current, context: c },
    registry(),
  );
  expect(composed).toMatchObject({
    ok: true,
    value: { status: 'composed', expansions: 1, presentation: { plan: { coverage: [{ needId: 'browse' }] } } },
  });
});
it('reaches combined alternatives lazily and reports unvisited assignments as exhaustion', () => {
  const bad: PresentationManifest = {
    ...table,
    ref: { id: 'data.a-bad', revision: '1' },
    resolveConfig: (values) => ({ ok: true, value: { values, fields: [], ports: [] } }),
  };
  const good: PresentationManifest = { ...table, ref: { id: 'data.b-good', revision: '1' } };
  const r = registry([bad, good, stack]);
  const base = context();
  const c: PresentationContext = {
    ...base,
    task: { ...base.task, needs: [...base.task.needs, { ...base.task.needs[0]!, id: 'second' }] },
    experience: {
      ...base.experience,
      allowedRepresentations: [bad.ref.id, good.ref.id, stack.ref.id],
      composition: { ...base.experience.composition, maxExpansions: 4 },
    },
    rendererCapabilities: [bad.ref, good.ref, stack.ref],
  };
  expect(composePresentation({ id: 'combined', revision: '1', context: c, preconditions: c.current }, r)).toMatchObject(
    {
      ok: true,
      value: {
        status: 'composed',
        expansions: 4,
        presentation: {
          plan: { nodes: [{ representation: stack.ref }, { representation: good.ref }, { representation: good.ref }] },
        },
      },
    },
  );
  const bounded = {
    ...c,
    experience: { ...c.experience, composition: { ...c.experience.composition, maxExpansions: 3 } },
  };
  expect(
    composePresentation({ id: 'combined', revision: '1', context: bounded, preconditions: c.current }, r),
  ).toMatchObject({ ok: true, value: { status: 'search-exhausted', expansions: 3 } });
});

describe('presentation plan replay', () => {
  it('retains wire bindings separately from trusted resolved configuration', () => {
    const manifest: PresentationManifest = {
      ...table,
      resolveConfig: (values, descriptor) =>
        Object.keys(values).length === 1 && values.bindingRef === 'employees' && descriptor !== undefined
          ? {
              ok: true,
              value: {
                values: {
                  bindingRef: 'employees',
                  label: 'Trusted host label',
                  columns: descriptor.fields.map((f) => f.id),
                },
                fields: descriptor.fields.map((f) => f.id),
                ports: [],
              },
            }
          : {
              ok: false,
              diagnostics: [
                {
                  code: 'binding.invalid',
                  message: 'Only the registered reference may be proposed.',
                  retryable: false,
                },
              ],
            },
    };
    const r = registry([manifest]);
    const p = {
      ...plan(),
      nodes: plan().nodes.map((n) => ({ ...n, config: { ...n.config, values: { bindingRef: 'employees' } } })),
    };
    const first = checked(p, context(), r);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.plan.nodes[0]!.config.values).toEqual({ bindingRef: 'employees' });
    expect(first.value.nodes[0]!.config.values.label).toBe('Trusted host label');
    const replay = checked(JSON.parse(JSON.stringify(first.value.plan)), context(), r);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value).toEqual(first.value);
    const forged = {
      ...p,
      nodes: p.nodes.map((n) => ({ ...n, config: { ...n.config, values: first.value.nodes[0]!.config.values } })),
    };
    expect(checked(forged, context(), r).ok).toBe(false);
  });
});

it('mutating caller incumbent cannot erase required state transfers after snapshot', () => {
  const previous = structuredClone(plan());
  const candidate: PresentationPlan = {
    ...plan(),
    rootId: 'replacement',
    nodes: [{ ...plan().nodes[0]!, id: 'replacement' }],
    coverage: [{ needId: 'browse', nodeIds: ['replacement'], operations: [read] }],
    stateTransfer: [],
  };
  let seen: PresentationPlan | undefined;
  const preset: PresentationPatternManifest = {
    ref: { id: 'preset.review', revision: '1' },
    expand(request) {
      seen = request.context.incumbent;
      Object.assign(previous, candidate);
      return { ok: true, value: candidate };
    },
    matches: (value) => value.rootId === 'replacement',
  };
  const installed = createPresentationRegistry([table, stack], [], [preset]);
  if (!installed.ok) throw Error('fixture');
  const c = {
    ...context(),
    incumbent: previous,
    experience: {
      ...context().experience,
      allowedPatterns: [preset.ref.id],
      composition: { ...context().experience.composition, allowWithoutPreset: false },
    },
  };
  const result = composePresentation(
    {
      id: 'review',
      revision: '1',
      context: c,
      preconditions: c.current,
      candidates: [{ source: 'pattern', pattern: preset.ref, plan: candidate }],
    },
    installed.value,
  );
  expect(seen?.rootId).toBe('table-1');
  expect(result).toMatchObject({ ok: true, value: { status: 'conflict' } });
});
