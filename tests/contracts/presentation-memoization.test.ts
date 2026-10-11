import { describe, expect, it } from 'vitest';
import {
  composePresentation,
  createPresentationRegistry,
  validatePresentationPlan,
} from '../../packages/core/src/presentation/index.js';
import { preparePresentationTree } from '../../packages/core/src/presentation/validation/tree-coverage.js';
import { canonicalJSON } from '../../packages/core/src/contracts/parse.js';
import { parseContract } from '../../packages/core/src/contracts/parse-generic.js';
import {
  preparePresentationContext,
  preparePresentationValidationCache,
  validatePreparedPresentationPlan,
} from '../../packages/core/src/presentation/validate.js';
import type {
  PresentationContext,
  PresentationManifest,
  PresentationPatternManifest,
  PresentationRegistry,
  PresentationValues,
} from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan, ResultRef } from '../../packages/core/src/contracts/types.js';
import { environment, experience, field, presentationPlan, presentationTask, ref, result } from './fixtures.js';

const read = { id: 'data.read', revision: '1' } as const;

function tableManifest(resolveConfig: PresentationManifest['resolveConfig']): PresentationManifest {
  return {
    ref: { id: 'data.memo-table', revision: '1' },
    configSchema: { id: 'data.memo-table.config', revision: '1' },
    roles: ['table'],
    operations: [read],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: false,
    resolveConfig,
    suggestConfig: () => ({ ok: true, value: {} }),
  };
}

function layoutManifest(resolveConfig: PresentationManifest['resolveConfig']): PresentationManifest {
  return {
    ref: { id: 'layout.memo-stack', revision: '1' },
    configSchema: { id: 'layout.memo-stack.config', revision: '1' },
    roles: ['structure'],
    operations: [],
    result: 'none',
    children: { min: 1, max: 32 },
    visibility: 'simultaneous',
    extension: false,
    resolveConfig,
    suggestConfig: () => ({ ok: true, value: {} }),
  };
}

function registry(entries: readonly PresentationManifest[]): PresentationRegistry {
  const installed = createPresentationRegistry(entries);
  if (!installed.ok) throw new Error(JSON.stringify(installed.diagnostics));
  return installed.value;
}

function context(overrides: Partial<PresentationContext> = {}): PresentationContext {
  const current = presentationPlan.preconditions;
  return {
    task: {
      ...presentationTask,
      needs: [{ id: 'browse', operation: read, fields: [field.id], outputId: 'rows', required: true }],
    },
    experience: {
      ...experience,
      mode: 'composable',
      allowedRepresentations: ['data.memo-table', 'layout.memo-stack'],
      composition: { ...experience.composition, maxExpansions: 64 },
    },
    results: [result],
    current,
    environment,
    rendererCapabilities: [
      { id: 'data.memo-table', revision: '1' },
      { id: 'layout.memo-stack', revision: '1' },
    ],
    ...overrides,
  };
}

function basePlan(
  rootId = 'layout-0',
  leafId = 'leaf-0',
  values: Record<string, unknown> = {},
  resultRef: ResultRef = ref,
): PresentationPlan {
  const leaf = {
    id: leafId,
    role: 'table',
    representation: { id: 'data.memo-table', revision: '1' },
    result: resultRef,
    config: { schema: { id: 'data.memo-table.config', revision: '1' }, values },
    children: [],
  };
  const root = {
    id: rootId,
    role: 'structure',
    representation: { id: 'layout.memo-stack', revision: '1' },
    config: { schema: { id: 'layout.memo-stack.config', revision: '1' }, values: {} },
    children: [leafId],
  };
  return {
    ...presentationPlan,
    rootId,
    nodes: [root, leaf],
    coverage: [{ needId: 'browse', nodeIds: [leafId], operations: [read] }],
  };
}

function request(
  plan: PresentationPlan,
  activeContext: PresentationContext,
  candidates?: readonly { readonly source: 'explicit'; readonly plan: PresentationPlan }[],
) {
  return {
    id: 'memo-compose',
    revision: '1',
    preconditions: activeContext.current,
    context: activeContext,
    ...(candidates === undefined ? {} : { candidates }),
  };
}

function twoLeafPlan(first: string, second: string): PresentationPlan {
  const plan = basePlan('layout', first);
  return {
    ...plan,
    nodes: [{ ...plan.nodes[0]!, children: [first, second] }, plan.nodes[1]!, { ...plan.nodes[1]!, id: second }],
  };
}

function portRegistry(
  leaf: PresentationManifest = tableManifest((values) => ({
    ok: true,
    value: {
      values,
      fields: [field.id],
      operations: [read],
      ports: [{ id: 'filter', direction: 'input', payload: 'filter' }],
    },
  })),
): PresentationRegistry {
  return registry([
    leaf,
    layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } })),
  ]);
}

describe('presentation validation memoization', () => {
  it.each(['owned', 'structural', 'frozen structural', 'inherited', 'proxy'] as const)(
    'shares ID-independent port validation only for an %s registry',
    (ownership) => {
      const leaf = tableManifest((values) => ({
        ok: true,
        value: {
          values,
          fields: [field.id],
          operations: [read],
          ports: [{ id: 'filter', direction: 'input', payload: 'filter' }],
        },
      }));
      const layout = layoutManifest((values) => ({
        ok: true,
        value: { values, fields: [], ports: [], operations: [] },
      }));
      const owned = registry([leaf, layout]);
      const active: PresentationRegistry = {
        owned,
        structural: { ...owned },
        'frozen structural': Object.freeze({ ...owned }),
        inherited: Object.create(owned) as PresentationRegistry,
        proxy: new Proxy(owned, {}),
      }[ownership];
      const plan = basePlan('layout', 'leaf-a');
      const checked = validatePresentationPlan(
        {
          ...plan,
          nodes: [
            { ...plan.nodes[0]!, children: ['leaf-a', 'leaf-b'] },
            plan.nodes[1]!,
            { ...plan.nodes[1]!, id: 'leaf-b' },
          ],
        },
        context(),
        active,
      );
      expect(checked.ok).toBe(true);
      if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
      const first = checked.value.nodes.find((node) => node.node.id === 'leaf-a')!;
      const second = checked.value.nodes.find((node) => node.node.id === 'leaf-b')!;
      expect(first.config.ports).toEqual(second.config.ports);
      expect(first.config.ports === second.config.ports).toBe(ownership === 'owned');
      expect(checked.value.graph.nodes.map((node) => node.id)).toEqual(['layout', 'leaf-a', 'leaf-b']);
    },
  );

  it.each([
    { ids: ['quote"A', 'quote"B'], shared: true },
    { ids: ['back\\A', 'back\\B'], shared: true },
    { ids: ['éA', 'éB'], shared: true },
    { ids: ['😀A', '😀B'], shared: true },
    { ids: ['A'.repeat(160), 'B'.repeat(160)], shared: true },
    { ids: ['a', 'bb'], shared: false },
    { ids: ['a', 'é'], shared: false },
    { ids: ['a"', 'ab'], shared: false },
    { ids: ['a\\', 'ab'], shared: false },
  ])('preserves public IDs and port-cache byte distinctions for $ids', ({ ids, shared }) => {
    const checked = validatePresentationPlan(twoLeafPlan(ids[0]!, ids[1]!), context(), portRegistry());
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const [first, second] = checked.value.nodes.slice(1);
    expect(first!.config.ports).toEqual(second!.config.ports);
    expect(first!.config.ports === second!.config.ports).toBe(shared);
    expect(checked.value.plan.nodes.map((node) => node.id)).toEqual(['layout', ...ids]);
    expect(checked.value.graph.nodes.map((node) => node.id)).toEqual(['layout', ...ids]);
    const byteCounts = ids.map((id) => new TextEncoder().encode(JSON.stringify(id)).length);
    expect(byteCounts[0] === byteCounts[1]).toBe(shared);
  });

  it('rejects a structural mapping swap before assessing a second equivalent node', () => {
    let calls = 0;
    let assessments = 0;
    const mapping = {
      ref: { id: 'filter.identity', revision: '1' },
      source: { payload: 'filter' as const },
      target: { payload: 'filter' as const },
      kind: 'identity' as const,
    };
    const leaf: PresentationManifest = {
      ...tableManifest((values) => {
        calls++;
        if (calls === 2) active.mappings = [mapping, mapping];
        return {
          ok: true,
          value: {
            values,
            fields: [field.id],
            operations: [read],
            ports: [{ id: 'filter', direction: 'input', payload: 'filter' }],
          },
        };
      }),
      assess: () => {
        assessments++;
        // If a stale port cache bypassed validation, this would hide the invalid mappings from the final graph.
        active.mappings = installed.mappings;
        return { ok: true, value: { taskFit: 100, informationDensity: 0, interactionEffort: 0, legibilityPenalty: 0 } };
      },
    };
    const installed = portRegistry(leaf);
    const active = { ...installed };
    const checked = validatePresentationPlan(twoLeafPlan('leaf-a', 'leaf-b'), context(), active);
    expect(checked).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'interaction.duplicate-mapping',
          message: 'A mapping version can be registered only once.',
          retryable: false,
        },
      ],
    });
    expect(calls).toBe(2);
    expect(assessments).toBe(1);
  });

  it('keeps port validation and parsed port objects local to each composition', () => {
    let duplicate = false;
    const leaf = tableManifest((values) => {
      const port = { id: 'filter', direction: 'input' as const, payload: 'filter' as const };
      return {
        ok: true,
        value: { values, fields: [field.id], operations: [read], ports: duplicate ? [port, port] : [port] },
      };
    });
    const installed = portRegistry(leaf);
    const plan = twoLeafPlan('leaf-a', 'leaf-b');
    const active = context();
    const compose = () =>
      composePresentation(
        {
          ...request(plan, active, [{ source: 'explicit', plan }]),
          searchRegistered: false,
        },
        installed,
      );
    const first = compose();
    const second = compose();
    if (!first.ok || !second.ok || !first.value.presentation || !second.value.presentation)
      throw new Error('Both initial compositions must produce a presentation.');
    const firstPorts = first.value.presentation.nodes[1]!.config.ports;
    const secondPorts = second.value.presentation.nodes[1]!.config.ports;
    expect(firstPorts).toEqual(secondPorts);
    expect(firstPorts).not.toBe(secondPorts);
    duplicate = true;
    const rejected = compose();
    expect(rejected).toMatchObject({
      ok: true,
      value: { rejected: [{ diagnostics: [{ code: 'interaction.duplicate-port' }] }] },
    });
    if (rejected.ok) expect(rejected.value.presentation).toBeUndefined();
    expect(firstPorts).toHaveLength(1);
  });

  it('keeps structurally memoized nodes bound to their exact result source lineage', () => {
    const nextRef = { ...ref, sourceLineage: 'source-r2' };
    const nextResult = { ...result, ref: nextRef };
    const seen: (string | undefined)[] = [];
    const leaf = tableManifest((values, descriptor) => {
      seen.push(descriptor?.ref.sourceLineage);
      return {
        ok: true,
        value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [], operations: [read] },
      };
    });
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const activeContext = context({
      task: {
        ...presentationTask,
        inputs: [ref, nextRef],
        needs: [{ id: 'browse', operation: read, fields: [field.id], required: true }],
      },
      results: [result, nextResult],
      current: { ...presentationPlan.preconditions, results: [ref, nextRef] },
    });
    const first = basePlan('z-layout', 'leaf', {}, ref);
    const next = basePlan('a-layout', 'leaf', {}, nextRef);
    const composed = composePresentation(
      {
        ...request(first, activeContext, [
          { source: 'explicit', plan: first },
          { source: 'explicit', plan: next },
        ]),
        searchRegistered: false,
      },
      registry([leaf, root]),
    );
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.value.presentation?.plan.rootId).toBe('a-layout');
    expect(seen).toEqual(['source-r1', 'source-r2']);
    expect(composed.value.presentation?.nodes.find((node) => node.node.id === 'leaf')?.result?.ref).toEqual(nextRef);
    expect(composed.value.presentation?.plan.nodes.find((node) => node.id === 'leaf')?.result).toEqual(nextRef);
  });

  it('does not authorize a new lineage through an otherwise equal cached node', () => {
    const seen: (string | undefined)[] = [];
    const leaf = tableManifest((values, descriptor) => {
      seen.push(descriptor?.ref.sourceLineage);
      return { ok: true, value: { values, fields: [field.id], ports: [], operations: [read] } };
    });
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const first = basePlan('z-layout', 'leaf');
    const unauthorized = basePlan('a-layout', 'leaf', {}, { ...ref, sourceLineage: 'unavailable' });
    const composed = composePresentation(
      {
        ...request(first, context(), [
          { source: 'explicit', plan: first },
          { source: 'explicit', plan: unauthorized },
        ]),
        searchRegistered: false,
      },
      registry([leaf, root]),
    );
    expect(composed).toMatchObject({
      ok: true,
      value: { rejected: [{ diagnostics: [{ code: 'commit.missing-dependency' }] }] },
    });
    expect(seen).toEqual(['source-r1']);
  });

  it('reparses caller result lineage on a later composition without freezing caller input', () => {
    const mutableRef = { ...ref, sourceLineage: 'first-source' };
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: {
        values: { lineage: descriptor!.ref.sourceLineage ?? '' },
        fields: [field.id],
        ports: [],
        operations: [read],
      },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const installed = registry([leaf, root]);
    const active = context({
      task: {
        ...presentationTask,
        inputs: [mutableRef],
        needs: [{ id: 'browse', operation: read, fields: [field.id], required: true }],
      },
      results: [{ ...result, ref: mutableRef }],
      current: { ...presentationPlan.preconditions, results: [mutableRef] },
    });
    const plan = basePlan('layout', 'leaf', {}, mutableRef);
    const first = composePresentation(
      { ...request(plan, active, [{ source: 'explicit', plan }]), searchRegistered: false },
      installed,
    );
    expect(first.ok).toBe(true);
    mutableRef.sourceLineage = 'second-source';
    const next = composePresentation(
      { ...request(plan, active, [{ source: 'explicit', plan }]), searchRegistered: false },
      installed,
    );
    expect(next.ok).toBe(true);
    if (!first.ok || !next.ok) return;
    expect(first.value.presentation?.nodes[1]?.result?.ref.sourceLineage).toBe('first-source');
    expect(next.value.presentation?.nodes[1]?.result?.ref.sourceLineage).toBe('second-source');
  });

  it('compares cached topology against every ordered node and retains dependency order and duplicates', () => {
    const nextRef = { ...ref, sourceLineage: 'source-r2' };
    const leaf = tableManifest((values) => ({
      ok: true,
      value: { values, fields: [field.id], ports: [], operations: [read] },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const installed = registry([leaf, root]);
    const active = context({
      task: {
        ...presentationTask,
        inputs: [nextRef, ref],
        needs: [{ id: 'browse', operation: read, fields: [field.id], required: true }],
      },
      results: [result, { ...result, ref: nextRef }],
      current: { ...presentationPlan.preconditions, results: [ref, nextRef] },
    });
    const base = basePlan('layout', 'leaf-a');
    const plan = {
      ...base,
      preconditions: active.current,
      nodes: [
        { ...base.nodes[0]!, children: ['leaf-a', 'leaf-b'] },
        base.nodes[1]!,
        { ...base.nodes[1]!, id: 'leaf-b', result: nextRef },
      ],
    };
    const parsed = parseContract('presentation-plan', plan);
    const prepared = preparePresentationContext(active);
    if (!parsed.ok || !prepared.ok) throw Error('fixture parse failed');
    const cache = preparePresentationValidationCache(prepared.value, installed);
    if (!cache.ok) throw Error('fixture cache failed');
    const validated = validatePreparedPresentationPlan(
      Object.freeze({ ...parsed.value, preconditions: Object.freeze(parsed.value.preconditions) }),
      active,
      installed,
      prepared.value,
      {},
      new Map(),
      new WeakMap(),
      undefined,
      cache.value,
      true,
    );
    expect(validated.ok).toBe(true);
    const firstTree = preparePresentationTree(parsed.value, cache.value);
    expect(firstTree.ok).toBe(true);
    if (!firstTree.ok) return;
    expect(preparePresentationTree({ ...parsed.value, nodes: [...parsed.value.nodes] }, cache.value)).toEqual(
      firstTree,
    );
    const reordered = preparePresentationTree(
      { ...parsed.value, nodes: [parsed.value.nodes[0]!, parsed.value.nodes[2]!, parsed.value.nodes[1]!] },
      cache.value,
    );
    expect(reordered.ok).toBe(true);
    if (reordered.ok) expect(reordered.value.nodeIndexes.get('leaf-a')).toBe(2);
    const invalid = {
      ...parsed.value,
      nodes: [{ ...parsed.value.nodes[0]!, children: ['leaf-a', 'leaf-a'] }, ...parsed.value.nodes.slice(1)],
    };
    expect(preparePresentationTree(invalid, cache.value)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.tree' }],
    });
    const entry = cache.value.readSetOutcomes.get(parsed.value.preconditions)?.[0];
    expect(entry?.references.map((item) => item.sourceLineage)).toEqual([
      'source-r2',
      'source-r1',
      'source-r1',
      'source-r2',
    ]);
  });

  it('reuses an owned link-free graph only while ordered node identities and resolved ports remain identical', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: {
        values,
        fields: descriptor!.fields.map((item) => item.id),
        ports:
          values.selectable === true
            ? [
                {
                  id: 'selection',
                  direction: 'output',
                  payload: 'selection',
                  entity: 'employees',
                  identity: [field.id],
                  grain: [field.id],
                },
              ]
            : [],
      },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const installed = registry([leaf, root]);
    const activeContext = context();
    const prepared = preparePresentationContext(activeContext);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const cache = preparePresentationValidationCache(prepared.value, installed);
    expect(cache.ok).toBe(true);
    if (!cache.ok) return;
    const check = (plan: PresentationPlan) => {
      const parsed = parseContract('presentation-plan', plan);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('fixture did not parse');
      const checked = validatePreparedPresentationPlan(
        parsed.value,
        activeContext,
        installed,
        prepared.value,
        {},
        undefined,
        undefined,
        undefined,
        cache.value,
      );
      expect(checked.ok).toBe(true);
      if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
      return checked.value.graph;
    };
    const first = check(basePlan('layout', 'leaf', { density: 'compact' }));
    const samePorts = check(basePlan('layout', 'leaf', { density: 'roomy' }));
    expect(samePorts).toBe(first);
    const changedPorts = check(basePlan('layout', 'leaf', { selectable: true }));
    expect(changedPorts).not.toBe(first);
    expect(changedPorts.nodes[1]!.ports).toHaveLength(1);
    expect(first.nodes[1]!.ports).toHaveLength(0);
    const renamed = check(basePlan('layout', 'different-leaf'));
    expect(renamed).not.toBe(first);
    expect(renamed.nodes[1]!.id).toBe('different-leaf');
    const originalOrder = basePlan('layout', 'leaf');
    const reordered = check({ ...originalOrder, nodes: [...originalOrder.nodes].reverse() });
    expect(reordered).not.toBe(first);
    expect(reordered.nodes[0]!.id).toBe('leaf');
    const nested = basePlan('layout', 'leaf');
    const secondLeaf = { ...nested.nodes[1]!, id: 'second-leaf' };
    const nestedLayout = { ...nested.nodes[0]!, id: 'nested-layout', children: ['leaf', 'second-leaf'] };
    const firstTopology = check({
      ...nested,
      nodes: [{ ...nested.nodes[0]!, children: ['nested-layout'] }, nestedLayout, nested.nodes[1]!, secondLeaf],
    });
    const changedTopology = check({
      ...nested,
      nodes: [
        { ...nested.nodes[0]!, children: ['nested-layout', 'second-leaf'] },
        { ...nestedLayout, children: ['leaf'] },
        nested.nodes[1]!,
        secondLeaf,
      ],
    });
    expect(changedTopology).not.toBe(firstTopology);
    expect(Object.isFrozen(first.nodes[1]!.ports)).toBe(true);
    expect(check(basePlan('layout', 'leaf'))).toBe(first);
  });

  it('keeps read-set and coverage cache entries isolated by their exact frozen dependencies', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: {
        values,
        fields: values.hideField === true ? [] : descriptor!.fields.map((item) => item.id),
        ports: [],
      },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const installed = registry([leaf, root]);
    const activeContext = context();
    const prepared = preparePresentationContext(activeContext);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const cache = preparePresentationValidationCache(prepared.value, installed);
    expect(cache.ok).toBe(true);
    if (!cache.ok) return;
    const parse = (candidate: PresentationPlan) => {
      const parsed = parseContract('presentation-plan', candidate);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('fixture did not parse');
      return parsed.value;
    };
    const validate = (candidate: ReturnType<typeof parse>) =>
      validatePreparedPresentationPlan(
        candidate,
        activeContext,
        installed,
        prepared.value,
        {},
        new Map(),
        new WeakMap(),
        undefined,
        cache.value,
        true,
      );

    const accepted = parse(basePlan('layout', 'leaf'));
    expect(validate(accepted).ok).toBe(true);

    const hidden = parse(basePlan('layout', 'leaf', { hideField: true }));
    const hiddenWithSharedCoverage = Object.freeze({
      ...hidden,
      coverage: accepted.coverage,
      preconditions: accepted.preconditions,
    });
    expect(validate(hiddenWithSharedCoverage)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.coverage' }],
    });

    const reorderedCoverage = parse({
      ...basePlan('layout', 'leaf'),
      coverage: [{ needId: 'browse', nodeIds: ['layout', 'leaf'], operations: [read] }],
    });
    expect(validate(reorderedCoverage)).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.coverage' }] });
    const missingCoverage = parse({
      ...basePlan('layout', 'leaf'),
      coverage: [{ needId: 'browse', nodeIds: ['missing'], operations: [read] }],
    });
    expect(validate(missingCoverage)).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.coverage' }] });

    const staleRef = { ...ref, revision: 'stale-result' };
    const stale = parse(basePlan('layout', 'leaf', {}, staleRef));
    const staleWithSharedReadSet = Object.freeze({ ...stale, preconditions: accepted.preconditions });
    expect(validate(staleWithSharedReadSet)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'commit.missing-dependency' }],
    });
  });

  it('keeps omitted and explicit empty operations equivalent', () => {
    const ordinary = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const explicit = layoutManifest((values) => ({
      ok: true,
      value: { values, fields: [], ports: [], operations: [] },
    }));
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] },
    }));
    const acceptedOrdinary = validatePresentationPlan(basePlan(), context(), registry([leaf, ordinary]));
    const acceptedExplicit = validatePresentationPlan(basePlan(), context(), registry([leaf, explicit]));
    expect(acceptedOrdinary.ok).toBe(true);
    expect(acceptedExplicit.ok).toBe(true);
    if (acceptedOrdinary.ok && acceptedExplicit.ok) {
      expect(acceptedExplicit.value.nodes[0]!.config).toEqual(acceptedOrdinary.value.nodes[0]!.config);
    }
  });

  it('rejects accessor and decorated empty resolver results without invoking getters', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] },
    }));
    let accessorCalls = 0;
    const accessor = layoutManifest(
      (values) =>
        Object.defineProperty({ ok: true }, 'value', {
          enumerable: true,
          get() {
            accessorCalls++;
            return { values, fields: [], ports: [], operations: [] };
          },
        }) as never,
    );
    expect(validatePresentationPlan(basePlan(), context(), registry([leaf, accessor]))).toMatchObject({ ok: false });
    expect(accessorCalls).toBe(0);

    const hidden = Symbol('hidden');
    const symbolKey = layoutManifest(
      (values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [], [hidden]: true } }) as never,
    );
    expect(validatePresentationPlan(basePlan(), context(), registry([leaf, symbolKey]))).toMatchObject({ ok: false });

    for (const key of ['fields', 'ports', 'operations'] as const) {
      const decoratedArray = layoutManifest((values) => {
        const lists = { fields: [] as unknown[], ports: [] as unknown[], operations: [] as unknown[] };
        Object.defineProperty(lists[key], 'metadata', { value: true, enumerable: true });
        return { ok: true, value: { values, ...lists } } as never;
      });
      expect(validatePresentationPlan(basePlan(), context(), registry([leaf, decoratedArray]))).toMatchObject({
        ok: false,
      });
    }
  });

  it('reparses a shallow-frozen callback outcome after its mutable config changes', () => {
    const fields: string[] = [];
    const operations: { id: string; revision: string }[] = [];
    const sharedConfig: {
      values: PresentationValues;
      fields: string[];
      ports: never[];
      operations: { id: string; revision: string }[];
    } = {
      values: {},
      fields,
      ports: [],
      operations,
    };
    const sharedOutcome = Object.freeze({ ok: true as const, value: sharedConfig });
    const leaf = tableManifest((values, _descriptor, node) => {
      sharedConfig.values = values;
      fields.splice(0, fields.length, ...(node?.id === 'first' ? [field.id] : []));
      operations.splice(0, operations.length, ...(node?.id === 'first' ? [read] : []));
      return sharedOutcome as never;
    });
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const candidate = basePlan('layout', 'first');
    const second = { ...candidate.nodes[1]!, id: 'second' };
    const twoLeaves: PresentationPlan = {
      ...candidate,
      nodes: [{ ...candidate.nodes[0]!, children: ['first', 'second'] }, candidate.nodes[1]!, second],
    };
    const checked = validatePresentationPlan(twoLeaves, context(), registry([leaf, root]));

    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.nodes.find((node) => node.node.id === 'first')?.config).toMatchObject({
      fields: [field.id],
      operations: [read],
    });
    expect(checked.value.nodes.find((node) => node.node.id === 'second')?.config).toMatchObject({
      fields: [],
      operations: [],
    });
  });

  it('accepts one deeply frozen callback outcome shared by multiple compatible nodes', () => {
    const calls: string[] = [];
    const ownedRead = Object.freeze({ ...read });
    const sharedOutcome = Object.freeze({
      ok: true as const,
      value: Object.freeze({
        values: Object.freeze({}),
        fields: Object.freeze([field.id]),
        ports: Object.freeze([]),
        operations: Object.freeze([ownedRead]),
      }),
    });
    const leaf = tableManifest((_values, _result, node) => {
      calls.push(node?.id ?? 'missing-node');
      return sharedOutcome;
    });
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const candidate = basePlan('layout', 'first');
    const second = { ...candidate.nodes[1]!, id: 'second' };
    const twoLeaves: PresentationPlan = {
      ...candidate,
      nodes: [{ ...candidate.nodes[0]!, children: ['first', 'second'] }, candidate.nodes[1]!, second],
    };
    const checked = validatePresentationPlan(twoLeaves, context(), registry([leaf, root]));

    expect(calls).toEqual(['first', 'second']);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.nodes.find((node) => node.node.id === 'first')?.config).toEqual(
      checked.value.nodes.find((node) => node.node.id === 'second')?.config,
    );
  });

  it('does not reuse bound result fields for another node without an optional result', () => {
    const sharedOutcome = Object.freeze({
      ok: true as const,
      value: Object.freeze({
        values: Object.freeze({}),
        fields: Object.freeze([field.id]),
        ports: Object.freeze([]),
        operations: Object.freeze([Object.freeze({ ...read })]),
      }),
    });
    const calls: string[] = [];
    const leaf: PresentationManifest = {
      ...tableManifest((_values, descriptor, node) => {
        calls.push(`${node?.id}:${descriptor === undefined ? 'unbound' : 'bound'}`);
        return sharedOutcome;
      }),
      result: 'optional',
    };
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const candidate = basePlan('layout', 'first');
    const unbound = {
      id: 'second',
      role: 'table',
      representation: leaf.ref,
      config: candidate.nodes[1]!.config,
      children: [],
    };
    const twoLeaves: PresentationPlan = {
      ...candidate,
      nodes: [{ ...candidate.nodes[0]!, children: ['first', 'second'] }, candidate.nodes[1]!, unbound],
    };
    expect(validatePresentationPlan(twoLeaves, context(), registry([leaf, root]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.field' }],
    });
    expect(calls).toEqual(['first:bound', 'second:unbound']);
  });

  it.each(['mutable array', 'shallow-frozen array'] as const)(
    'rechecks changed operation declarations in a public registry with a %s',
    (shape) => {
      const declaredRead = { id: 'data.read', revision: '1' };
      const declarations = [declaredRead];
      if (shape === 'shallow-frozen array') Object.freeze(declarations);
      const sharedOutcome = Object.freeze({
        ok: true as const,
        value: Object.freeze({
          values: Object.freeze({}),
          fields: Object.freeze([field.id]),
          ports: Object.freeze([]),
          operations: Object.freeze([Object.freeze({ ...read })]),
        }),
      });
      const calls: string[] = [];
      const leaf: PresentationManifest = {
        ...tableManifest((_values, _result, node) => {
          calls.push(node?.id ?? 'missing-node');
          if (calls.length === 2) {
            if (shape === 'mutable array') declarations.length = 0;
            else declaredRead.id = 'data.other';
          }
          return sharedOutcome;
        }),
        operations: declarations,
      };
      const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
      const candidate = basePlan('layout', 'first');
      const twoLeaves: PresentationPlan = {
        ...candidate,
        nodes: [
          { ...candidate.nodes[0]!, children: ['first', 'second'] },
          candidate.nodes[1]!,
          { ...candidate.nodes[1]!, id: 'second' },
        ],
      };
      // Public registries are structural; only the factory owns and freezes declarations.
      const customRegistry: PresentationRegistry = { manifests: [leaf, root], mappings: [] };
      const checked = validatePresentationPlan(twoLeaves, context(), customRegistry);
      expect(calls).toEqual(['first', 'second']);
      expect(checked).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.configuration' }] });
    },
  );

  it.each(['inherited data', 'prototype getters', 'inherited array entry'] as const)(
    'rechecks frozen declarations backed by mutable %s',
    (shape) => {
      const backing = { id: 'data.read', revision: '1' };
      class DynamicOperation {
        get id() {
          return backing.id;
        }
        get revision() {
          return backing.revision;
        }
      }
      const declaration: Readonly<typeof backing> =
        shape === 'prototype getters' ? Object.freeze(new DynamicOperation()) : Object.freeze(Object.create(backing));
      const inherited = Object.create(Array.prototype) as Record<number, typeof read>;
      inherited[0] = Object.freeze({ ...read });
      const sparse: (typeof read)[] = [];
      sparse.length = 1;
      Object.setPrototypeOf(sparse, inherited);
      const declarations = Object.freeze(shape === 'inherited array entry' ? sparse : [declaration]);
      const sharedOutcome = Object.freeze({
        ok: true as const,
        value: Object.freeze({
          values: Object.freeze({}),
          fields: Object.freeze([field.id]),
          ports: Object.freeze([]),
          operations: Object.freeze([Object.freeze({ ...read })]),
        }),
      });
      const calls: string[] = [];
      const leaf: PresentationManifest = {
        ...tableManifest((_values, _result, node) => {
          calls.push(node?.id ?? 'missing-node');
          if (calls.length === 2) {
            backing.id = 'data.other';
            // The frozen array owns only its length; its inherited entry remains replaceable.
            Object.defineProperty(inherited, '0', { value: Object.freeze({ id: 'data.other', revision: '1' }) });
          }
          return sharedOutcome;
        }),
        operations: declarations,
      };
      const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
      const candidate = basePlan('layout', 'first');
      const twoLeaves: PresentationPlan = {
        ...candidate,
        nodes: [
          { ...candidate.nodes[0]!, children: ['first', 'second'] },
          candidate.nodes[1]!,
          { ...candidate.nodes[1]!, id: 'second' },
        ],
      };
      const checked = validatePresentationPlan(twoLeaves, context(), { manifests: [leaf, root], mappings: [] });
      expect(calls).toEqual(['first', 'second']);
      expect(checked).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.configuration' }] });
    },
  );

  it('rechecks permissions in a new composition with the same registered declarations and frozen config', () => {
    const extra = Object.freeze({ id: 'data.extra', revision: '1' });
    const sharedOutcome = Object.freeze({
      ok: true as const,
      value: Object.freeze({
        values: Object.freeze({}),
        fields: Object.freeze([field.id]),
        ports: Object.freeze([]),
        operations: Object.freeze([Object.freeze({ ...read }), extra]),
      }),
    });
    let calls = 0;
    const leaf = {
      ...tableManifest(() => {
        calls++;
        return sharedOutcome;
      }),
      operations: [read, extra],
    };
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const registered = registry([leaf, root]);
    const candidate = basePlan();
    expect(validatePresentationPlan(candidate, context(), registered).ok).toBe(true);
    expect(
      validatePresentationPlan(
        candidate,
        {
          ...context(),
          restrictions: [{ id: 'read-only', allowedOperations: [read] }],
        },
        registered,
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.restricted' }] });
    expect(calls).toBe(2);
  });

  it('rechecks manifest operation constraints for a shared deeply frozen callback outcome', () => {
    const sharedOutcome = Object.freeze({
      ok: true as const,
      value: Object.freeze({
        values: Object.freeze({}),
        fields: Object.freeze([field.id]),
        ports: Object.freeze([]),
        operations: Object.freeze([read]),
      }),
    });
    const first = tableManifest(() => sharedOutcome);
    const restricted: PresentationManifest = {
      ...tableManifest(() => sharedOutcome),
      ref: { id: 'data.restricted-table', revision: '1' },
      configSchema: { id: 'data.restricted-table.config', revision: '1' },
      operations: [],
    };
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [], operations: [] } }));
    const candidate = basePlan('layout', 'first');
    const second = {
      ...candidate.nodes[1]!,
      id: 'second',
      representation: restricted.ref,
      config: { ...candidate.nodes[1]!.config, schema: restricted.configSchema },
    };
    const twoLeaves: PresentationPlan = {
      ...candidate,
      nodes: [{ ...candidate.nodes[0]!, children: ['first', 'second'] }, candidate.nodes[1]!, second],
    };
    const activeContext = {
      ...context(),
      experience: {
        ...context().experience,
        allowedRepresentations: [...context().experience.allowedRepresentations, restricted.ref.id],
      },
      rendererCapabilities: [...context().rendererCapabilities, restricted.ref],
    };

    expect(validatePresentationPlan(twoLeaves, activeContext, registry([first, restricted, root]))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.configuration' }],
    });
  });

  it('reuses structurally identical leaves across all 64 complete candidate plans while validating each distinct root', () => {
    let leafCalls = 0;
    let rootCalls = 0;
    const leaf = tableManifest((values, descriptor) => {
      leafCalls++;
      return { ok: true, value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] } };
    });
    const root = layoutManifest((values) => {
      rootCalls++;
      return { ok: true, value: { values, fields: [], ports: [] } };
    });
    const activeContext = context();
    const candidates = Array.from({ length: 64 }, (_, index) => ({
      source: 'explicit' as const,
      plan: basePlan(`layout-${index}`, 'shared-leaf'),
    }));
    const composed = composePresentation(request(basePlan(), activeContext, candidates), registry([leaf, root]));

    expect(composed).toMatchObject({ ok: true, value: { status: 'search-exhausted', expansions: 64 } });
    expect(leafCalls).toBe(1);
    expect(rootCalls).toBe(64);
  });

  it('invokes a pure resolver once for each identical node/result/config key within one compose call', () => {
    let leafCalls = 0;
    let rootCalls = 0;
    const leaf = tableManifest((values, descriptor) => {
      leafCalls++;
      return { ok: true, value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] } };
    });
    const root = layoutManifest((values) => {
      rootCalls++;
      return { ok: true, value: { values, fields: [], ports: [] } };
    });
    const activeContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 2 } },
    };
    const candidate = basePlan('same-root', 'same-leaf');
    const composed = composePresentation(
      request(candidate, activeContext, [
        { source: 'explicit', plan: candidate },
        { source: 'explicit', plan: candidate },
      ]),
      registry([leaf, root]),
    );

    expect(composed).toMatchObject({ ok: true, value: { status: 'search-exhausted', expansions: 2 } });
    expect(leafCalls).toBe(1);
    expect(rootCalls).toBe(1);
  });

  it('validates changed contents and length in one shared pattern child list', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: {
        values,
        fields: descriptor!.fields.map((item) => item.id),
        ports: [],
      },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const sharedChildren: string[] = ['leaf'];
    let expansions = 0;
    const pattern: PresentationPatternManifest = {
      ref: { id: 'preset.shared-children', revision: '1' },
      expand: () => {
        expansions++;
        if (expansions === 2) sharedChildren.splice(0, sharedChildren.length, 'renamed-leaf');
        if (expansions === 3) sharedChildren.push('second-leaf');
        const primaryId = expansions === 1 ? 'leaf' : 'renamed-leaf';
        const candidate = basePlan('layout', primaryId);
        const nodes = [{ ...candidate.nodes[0]!, children: sharedChildren }, candidate.nodes[1]!];
        if (expansions === 3) nodes.push({ ...candidate.nodes[1]!, id: 'second-leaf' });
        return { ok: true, value: { ...candidate, nodes } };
      },
      matches: () => true,
    };
    const installed = createPresentationRegistry([leaf, root], [], [pattern]);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    const ordinary = context();
    const activeContext = {
      ...ordinary,
      experience: {
        ...ordinary.experience,
        allowedPatterns: [pattern.ref.id],
        composition: { ...ordinary.experience.composition, maxExpansions: 3 },
      },
    };
    const placeholder = basePlan();
    const composed = composePresentation(
      {
        id: 'shared-children',
        revision: '1',
        preconditions: activeContext.current,
        context: activeContext,
        candidates: Array.from({ length: 3 }, () => ({
          source: 'pattern' as const,
          pattern: pattern.ref,
          plan: placeholder,
        })),
      },
      installed.value,
    );

    expect(expansions).toBe(3);
    expect(composed).toMatchObject({ ok: true, value: { status: 'search-exhausted', expansions: 3, rejected: [] } });
    if (!composed.ok || composed.value.presentation === undefined) return;
    expect(Object.isFrozen(composed.value.presentation.plan)).toBe(true);
    expect(Object.isFrozen(composed.value.presentation.plan.nodes)).toBe(true);
  });

  it('still rejects an unknown node key when a validated child list is reused', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: {
        values,
        fields: descriptor!.fields.map((item) => item.id),
        ports: [],
      },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const sharedChildren = ['leaf-0'];
    let expansions = 0;
    const pattern: PresentationPatternManifest = {
      ref: { id: 'preset.strict-shared-children', revision: '1' },
      expand: () => {
        expansions++;
        const candidate = basePlan();
        const rootNode = {
          ...candidate.nodes[0]!,
          children: sharedChildren,
          ...(expansions === 2 ? { unknownNodeKey: true } : {}),
        };
        return { ok: true, value: { ...candidate, nodes: [rootNode, candidate.nodes[1]!] } } as never;
      },
      matches: () => true,
    };
    const installed = createPresentationRegistry([leaf, root], [], [pattern]);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    const ordinary = context();
    const activeContext = {
      ...ordinary,
      experience: {
        ...ordinary.experience,
        allowedPatterns: [pattern.ref.id],
        composition: { ...ordinary.experience.composition, maxExpansions: 2 },
      },
    };
    const placeholder = basePlan();
    const composed = composePresentation(
      {
        id: 'strict-shared-children',
        revision: '1',
        preconditions: activeContext.current,
        context: activeContext,
        candidates: Array.from({ length: 2 }, () => ({
          source: 'pattern' as const,
          pattern: pattern.ref,
          plan: placeholder,
        })),
      },
      installed.value,
    );

    expect(expansions).toBe(2);
    expect(composed).toMatchObject({
      ok: true,
      value: {
        status: 'search-exhausted',
        expansions: 2,
        rejected: [{ candidate: 'pattern.preset.strict-shared-children' }],
        presentation: expect.any(Object),
      },
    });
    if (composed.ok) expect(composed.value.rejected).toHaveLength(1);
  });

  it('reevaluates when node identity, configuration, or result reference changes', () => {
    const alternateRef = { ...ref, outputId: 'alternate' as const };
    const alternateResult = { ...result, ref: alternateRef };
    let leafCalls = 0;
    let rootCalls = 0;
    const leaf = tableManifest((values, descriptor) => {
      leafCalls++;
      return { ok: true, value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] } };
    });
    const root = layoutManifest((values) => {
      rootCalls++;
      return { ok: true, value: { values, fields: [], ports: [] } };
    });
    const activeContext: PresentationContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 4 } },
      task: {
        ...presentationTask,
        inputs: [ref, alternateRef],
        needs: [{ id: 'browse', operation: read, fields: [field.id], required: true }],
      },
      results: [result, alternateResult],
      current: { ...presentationPlan.preconditions, results: [ref, alternateRef] },
    };
    const candidates = [
      { source: 'explicit' as const, plan: basePlan('same-root', 'same-leaf', {}) },
      { source: 'explicit' as const, plan: basePlan('same-root', 'same-leaf', { density: 'compact' }) },
      { source: 'explicit' as const, plan: basePlan('same-root', 'renamed-leaf', {}) },
      { source: 'explicit' as const, plan: basePlan('same-root', 'renamed-leaf', {}, alternateRef) },
      { source: 'explicit' as const, plan: basePlan('same-root', 'renamed-leaf', {}, alternateRef) },
    ];
    const composed = composePresentation(
      request(candidates[0]!.plan, activeContext, candidates),
      registry([leaf, root]),
    );

    expect(composed).toMatchObject({ ok: true, value: { status: 'search-exhausted', expansions: 4 } });
    expect(leafCalls).toBe(4);
    expect(rootCalls).toBe(2);
  });

  it('keeps signed-zero configuration values distinct and ranks the correctly resolved candidate', () => {
    let leafCalls = 0;
    const leaf = tableManifest((values, descriptor) => {
      leafCalls++;
      return { ok: true, value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] } };
    });
    const assessedLeaf: PresentationManifest = {
      ...leaf,
      assess: (config) => ({
        ok: true,
        value: {
          taskFit: Object.is(config.values.signedZero, 0) && !Object.is(config.values.signedZero, -0) ? 100 : 0,
          informationDensity: 0,
          interactionEffort: 0,
          legibilityPenalty: 0,
        },
      }),
    };
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const activeContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 2 } },
    };
    const negative = basePlan('signed-root', 'signed-leaf', { signedZero: -0 });
    const positive = basePlan('signed-root', 'signed-leaf', { signedZero: 0 });
    const composed = composePresentation(
      request(negative, activeContext, [
        { source: 'explicit', plan: negative },
        { source: 'explicit', plan: positive },
      ]),
      registry([assessedLeaf, root]),
    );

    expect(composed).toMatchObject({
      ok: true,
      value: {
        status: 'search-exhausted',
        expansions: 2,
        presentation: {
          plan: { nodes: [{ id: 'signed-root' }, { id: 'signed-leaf', config: { values: { signedZero: 0 } } }] },
        },
      },
    });
    expect(leafCalls).toBe(2);
    if (!composed.ok || composed.value.presentation === undefined) return;
    const resolved = composed.value.presentation.nodes.find((node) => node.node.id === 'signed-leaf');
    expect(resolved).toBeDefined();
    expect(Object.is(resolved?.config.values.signedZero, 0)).toBe(true);
    expect(Object.is(resolved?.config.values.signedZero, -0)).toBe(false);
  });

  it('keeps canonical equal-score tie ordering for shared candidate plans', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const activeContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 2 } },
    };
    const shorter = basePlan('same-root', 'same-leaf', { order: [1] });
    const longer = basePlan('same-root', 'same-leaf', { order: [1, 2] });
    const composed = composePresentation(
      request(shorter, activeContext, [
        { source: 'explicit', plan: shorter },
        { source: 'explicit', plan: longer },
      ]),
      registry([leaf, root]),
    );

    expect(composed).toMatchObject({
      ok: true,
      value: {
        status: 'search-exhausted',
        presentation: {
          plan: { nodes: [{ id: 'same-root' }, { id: 'same-leaf', config: { values: { order: [1, 2] } } }] },
        },
      },
    });
  });

  it('matches canonical ordering across nested JSON value and prefix boundaries', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const activeContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 2 } },
    };
    const values: unknown[] = [
      [],
      [{}],
      [1],
      [10],
      [1, 2],
      {},
      { a: 1 },
      { a: 1, b: 2 },
      '',
      'a',
      false,
      true,
      null,
      -1,
      -10,
      0,
    ];
    for (let left = 0; left < values.length; left++)
      for (let right = left + 1; right < values.length; right++) {
        const first = basePlan('same-root', 'same-leaf', { order: values[left] });
        const second = basePlan('same-root', 'same-leaf', { order: values[right] });
        const composed = composePresentation(
          request(first, activeContext, [
            { source: 'explicit', plan: first },
            { source: 'explicit', plan: second },
          ]),
          registry([leaf, root]),
        );
        expect(composed.ok).toBe(true);
        if (!composed.ok || composed.value.presentation === undefined) continue;
        const expected = canonicalJSON(first) < canonicalJSON(second) ? values[left] : values[right];
        expect(composed.value.presentation.plan.nodes[1]!.config.values).toEqual({ order: expected });
      }
  });

  it('does not carry acceptance across compose calls when policy, result fields, or experience changes', () => {
    let leafCalls = 0;
    const leaf = tableManifest((values, descriptor) => {
      leafCalls++;
      return { ok: true, value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] } };
    });
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const installed = registry([leaf, root]);
    const candidate = basePlan();
    const firstContext = {
      ...context(),
      experience: { ...context().experience, composition: { ...context().experience.composition, maxExpansions: 1 } },
    };
    const first = composePresentation(
      request(candidate, firstContext, [{ source: 'explicit', plan: candidate }]),
      installed,
    );
    expect(first).toMatchObject({ ok: true, value: { status: 'search-exhausted', presentation: expect.any(Object) } });

    const denied = { ...firstContext, restrictions: [{ id: 'preset-policy', allowWithoutPreset: false as const }] };
    const policyChanged = composePresentation(
      request(candidate, denied, [{ source: 'explicit', plan: candidate }]),
      installed,
    );
    expect(policyChanged).toMatchObject({
      ok: true,
      value: { status: 'search-exhausted', rejected: [{ diagnostics: [{ code: 'presentation.pattern-required' }] }] },
    });
    if (policyChanged.ok) expect(policyChanged.value.presentation).toBeUndefined();

    const missingFieldResult = {
      ...result,
      fields: [{ ...field, id: 'employee.name', label: 'Employee name', role: 'attribute' as const }],
    };
    const resultChanged: PresentationContext = {
      ...firstContext,
      results: [missingFieldResult],
      current: { ...firstContext.current, results: [missingFieldResult.ref] },
    };
    const resultFieldsChanged = composePresentation(
      request(candidate, resultChanged, [{ source: 'explicit', plan: candidate }]),
      installed,
    );
    expect(resultFieldsChanged).toMatchObject({
      ok: true,
      value: { status: 'search-exhausted', rejected: [{ diagnostics: [{ code: 'presentation.coverage' }] }] },
    });
    if (resultFieldsChanged.ok) expect(resultFieldsChanged.value.presentation).toBeUndefined();

    const experienceChanged: PresentationContext = {
      ...firstContext,
      experience: {
        ...firstContext.experience,
        composition: { ...firstContext.experience.composition, allowWithoutPreset: false },
      },
    };
    const experienceChangedResult = composePresentation(
      request(candidate, experienceChanged, [{ source: 'explicit', plan: candidate }]),
      installed,
    );
    expect(experienceChangedResult).toMatchObject({
      ok: true,
      value: { status: 'search-exhausted', rejected: [{ diagnostics: [{ code: 'presentation.pattern-required' }] }] },
    });
    if (experienceChangedResult.ok) expect(experienceChangedResult.value.presentation).toBeUndefined();
    expect(leafCalls).toBe(4);
  });

  it('parses every public raw plan before memo lookup and exposes frozen parsed descendants', () => {
    const leaf = tableManifest((values, descriptor) => ({
      ok: true,
      value: { values, fields: descriptor!.fields.map((item) => item.id), ports: [] },
    }));
    const root = layoutManifest((values) => ({ ok: true, value: { values, fields: [], ports: [] } }));
    const activeContext = context();
    const installed = registry([leaf, root]);
    const valid = basePlan();
    const accepted = validatePresentationPlan(valid, activeContext, installed);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(Object.isFrozen(accepted.value.plan)).toBe(true);
    expect(Object.isFrozen(accepted.value.plan.nodes)).toBe(true);
    expect(Object.isFrozen(accepted.value.plan.nodes[0])).toBe(true);
    expect(Object.isFrozen(accepted.value.plan.nodes[0]!.config)).toBe(true);
    expect(Object.isFrozen(accepted.value.plan.nodes[0]!.config.values)).toBe(true);

    const prepared = preparePresentationContext(activeContext);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const cache = preparePresentationValidationCache(prepared.value, installed);
    expect(cache.ok).toBe(true);
    if (!cache.ok) return;
    const replayed = validatePreparedPresentationPlan(
      accepted.value.plan,
      activeContext,
      installed,
      prepared.value,
      {},
      new Map(),
      new WeakMap(),
      undefined,
      cache.value,
      true,
    );
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.value.plan).toBe(accepted.value.plan);
      expect(Object.isFrozen(replayed.value.plan)).toBe(true);
      expect(Object.isFrozen(replayed.value.plan.nodes)).toBe(true);
    }

    const malformed = { ...valid, unexpected: true, nodes: valid.nodes.map((node) => ({ ...node })) } as unknown;
    expect(validatePresentationPlan(malformed, activeContext, installed).ok).toBe(false);
    expect(validatePresentationPlan(malformed, activeContext, installed).ok).toBe(false);

    const malformedNode = { ...valid, nodes: valid.nodes.map((node) => ({ ...node, unexpected: 'raw' })) } as unknown;
    expect(validatePresentationPlan(malformedNode, activeContext, installed).ok).toBe(false);
    expect(validatePresentationPlan(malformedNode, activeContext, installed).ok).toBe(false);
  });
});
