import { describe, expect, it } from 'vitest';
import {
  createPresentationRegistry,
  type PresentationManifest,
  type PresentationEnvironment,
  type PresentationPatternManifest,
} from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/types.js';
import { createRegionStore } from '../../packages/runtime/src/regions/index.js';
import {
  createCallbackPresentationRenderer,
  createPresentationAdaptationController,
  type PresentationAdaptationContext,
  type PresentationProjectionState,
} from '../../packages/runtime/src/presentation/index.js';
import type { RegionHandle } from '../../packages/runtime/src/regions/index.js';
import { resolverCandidates } from '../../packages/runtime/src/presentation/adaptation-resolver.js';
import { presentationTask, ref, result } from '../contracts/fixtures.js';

const read = { id: 'data.read', revision: '1' } as const;
const environment = (inlineSize: number, textScale = 1): PresentationEnvironment => ({
  inlineSize: { state: 'known', value: inlineSize },
  blockSize: { state: 'known', value: 400 },
  textScale: { state: 'known', value: textScale },
  pointer: 'fine',
  hover: 'available',
  keyboard: 'available',
  locale: 'en-US',
  direction: 'ltr',
  reducedMotion: false,
  forcedColors: false,
});

function manifest(id: string, taskFit: (env: PresentationEnvironment) => number): PresentationManifest {
  const ref = { id, revision: '1' } as const;
  return {
    ref,
    configSchema: { id: `${id}.config`, revision: '1' },
    roles: ['view'],
    operations: [],
    result: 'none',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: false,
    resolveConfig: (values) => ({ ok: true, value: { values, fields: [], ports: [] } }),
    suggestConfig: () => ({ ok: true, value: {} }),
    assess: (_config, _result, env) => ({
      ok: true,
      value: {
        taskFit: taskFit(env),
        informationDensity: 100,
        interactionEffort: 0,
        legibilityPenalty: 0,
      },
    }),
  };
}

function planFor(ref: PresentationManifest['ref'], preconditions: PresentationPlan['preconditions']): PresentationPlan {
  return {
    id: 'legacy-candidate',
    revision: '1',
    preconditions,
    rootId: 'legacy-root',
    nodes: [
      {
        id: 'legacy-root',
        role: 'view',
        representation: ref,
        config: { schema: { id: ref.id + '.config', revision: '1' }, values: {} },
        children: [],
      },
    ],
    links: [],
    coverage: [],
    stateTransfer: [],
    diagnostics: [],
  };
}

function setup(
  initialPresentation?: PresentationPlan,
  withPattern = false,
): {
  region: RegionHandle;
  registry: any;
  wide: PresentationManifest;
  narrow: PresentationManifest;
  pattern?: PresentationPatternManifest;
} {
  const wide = manifest('layout.wide', (env) =>
    env.inlineSize.state === 'known' && env.inlineSize.value >= 500 ? 100 : 10,
  );
  const narrow = manifest('layout.narrow', (env) =>
    env.inlineSize.state === 'known' && env.inlineSize.value < 500 ? 100 : 10,
  );
  const mapping = {
    ref: { id: 'state.wide-narrow', revision: '1' },
    from: wide.ref,
    to: narrow.ref,
    fromRole: 'view',
    toRole: 'view',
    kind: 'transfer' as const,
  };
  const reverse = {
    ref: { id: 'state.narrow-wide', revision: '1' },
    from: narrow.ref,
    to: wide.ref,
    fromRole: 'view',
    toRole: 'view',
    kind: 'transfer' as const,
  };
  const pattern: PresentationPatternManifest | undefined = withPattern
    ? {
        ref: { id: 'preset.legacy', revision: '1' },
        expand: ({ preconditions }) => ({ ok: true, value: planFor(wide.ref, preconditions) }),
        matches: (plan) => plan.nodes[0]?.representation.id === wide.ref.id,
      }
    : undefined;
  const registryResult = createPresentationRegistry([wide, narrow], [], pattern === undefined ? [] : [pattern], [
    mapping,
    reverse,
  ]);
  if (!registryResult.ok) throw new Error(registryResult.diagnostics[0]!.message);
  const authority = {
    principalKey: 'principal',
    scopeDigest: 'scope-1',
    policyRevision: 'policy-1',
    catalogRevision: 'catalog-1',
    experienceRevision: 'experience-r1',
    functionRegistryDigest: 'functions-1',
    results: [ref],
  };
  const store = createRegionStore({
    readAuthority: () => ({ ok: true, value: authority }),
    authorizeCommit: () => ({ ok: true, value: undefined }),
  });
  const created = store.create({
    id: 'region-1',
    state: {
      task: presentationTask,
      ...(initialPresentation === undefined ? {} : { presentation: initialPresentation }),
    },
  });
  if (!created.ok) throw new Error(created.diagnostics[0]!.message);
  return {
    region: created.value,
    registry: registryResult.value,
    wide,
    narrow,
    ...(pattern === undefined ? {} : { pattern }),
  };
}

function baseContext(): PresentationAdaptationContext {
  return {
    experience: {
      version: '1',
      id: 'experience-1',
      revision: 'experience-r1',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: ['layout.wide', 'layout.narrow'],
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 4, maxExpansions: 8 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens.default', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [result],
    rendererCapabilities: [
      { id: 'layout.wide', revision: '1' },
      { id: 'layout.narrow', revision: '1' },
    ],
    stateMappingCapabilities: [
      { id: 'state.wide-narrow', revision: '1' },
      { id: 'state.narrow-wide', revision: '1' },
    ],
  };
}

describe('presentation adaptation runtime', () => {
  it('composes and commits a wide/narrow transition with no model path', async () => {
    const { region, registry } = setup();
    const applied: PresentationProjectionState[] = [];
    const renderer = createCallbackPresentationRenderer({
      apply: (next) => {
        applied.push(next);
      },
    });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer,
      dwellMs: 0,
    });
    const first = await controller.request(environment(800));
    expect(first).toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(region.snapshot().state?.presentation?.nodes[0]?.representation.id).toBe('layout.wide');
    const second = await controller.request(environment(320));
    expect(second).toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(region.snapshot().state?.presentation?.nodes[0]?.representation.id).toBe('layout.narrow');
    expect(applied.map((state) => state.presentation.plan.nodes[0]!.representation.id)).toEqual([
      'layout.wide',
      'layout.narrow',
    ]);
    expect(applied[1]!.presentation.plan.preconditions).toEqual(region.snapshot().state!.presentation!.preconditions);
    const third = await controller.request(environment(800));
    expect(third).toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(region.snapshot().state?.presentation?.nodes[0]?.representation.id).toBe('layout.wide');
    controller.dispose();
  });

  it('does not stage or render when the core resolver rejects stale target evidence', async () => {
    const { region, registry } = setup();
    const applied: PresentationProjectionState[] = [];
    const controller = createPresentationAdaptationController({
      region,
      registry,
      target: {
        address: {
          runtimeId: 'runtime-1',
          scopeInstanceId: 'scope-1',
          activationEpoch: 1,
          surfaceId: 'region-1',
          surfaceGeneration: 1,
        },
        read: () => ({
          address: {
            runtimeId: 'runtime-1',
            scopeInstanceId: 'scope-1',
            activationEpoch: 1,
            surfaceId: 'region-1',
            surfaceGeneration: 1,
          },
          state: 'stale',
        }),
      },
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({
        apply: (next) => {
          applied.push(next);
        },
      }),
      dwellMs: 0,
    });

    const outcome = await controller.request(environment(800));

    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.target-inactive' }] });
    expect(region.snapshot().state?.presentation).toBeUndefined();
    expect(applied).toEqual([]);
    controller.dispose();
  });

  it('does not stage or render for an active target belonging to another Region address', async () => {
    const { region, registry } = setup();
    let stageCalls = 0;
    const stagedRegion = Object.create(region) as RegionHandle;
    stagedRegion.stage = async (input) => {
      stageCalls++;
      return region.stage(input);
    };
    const applied: PresentationProjectionState[] = [];
    const controller = createPresentationAdaptationController({
      region: stagedRegion,
      registry,
      target: {
        address: {
          runtimeId: 'runtime-local',
          scopeInstanceId: 'scope-local',
          activationEpoch: 1,
          surfaceId: region.id,
          surfaceGeneration: 1,
        },
        read: () => ({
          address: {
            runtimeId: 'runtime-foreign',
            scopeInstanceId: 'scope-foreign',
            activationEpoch: 7,
            surfaceId: region.id,
            surfaceGeneration: 7,
          },
          state: 'active',
        }),
      },
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({
        apply: (next) => {
          applied.push(next);
        },
      }),
      dwellMs: 0,
    });

    const outcome = await controller.request(environment(800), { force: true });

    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.target-inactive' }] });
    expect(stageCalls).toBe(0);
    expect(applied).toEqual([]);
    expect(region.snapshot().state?.presentation).toBeUndefined();
    controller.dispose();
  });

  it('rechecks the exact target address at commit and rejects a late activation change', async () => {
    const { region, registry } = setup();
    const address = {
      runtimeId: 'runtime-local',
      scopeInstanceId: 'scope-local',
      activationEpoch: 1,
      surfaceId: region.id,
      surfaceGeneration: 1,
    } as const;
    let reads = 0;
    let applied = 0;
    const controller = createPresentationAdaptationController({
      region,
      registry,
      target: {
        address,
        read: () => ({
          address: reads++ === 0 ? address : { ...address, activationEpoch: 2 },
          state: 'active',
        }),
      },
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({
        apply: () => {
          applied++;
        },
      }),
      dwellMs: 0,
    });

    const outcome = await controller.request(environment(800), { force: true });

    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.target-inactive' }] });
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(applied).toBe(0);
    expect(region.snapshot().state?.presentation).toBeUndefined();
    controller.dispose();
  });

  it('accepts duplicate legacy candidates, including repeated placeholder pattern shapes', async () => {
    const { region, registry, wide, pattern } = setup(undefined, true);
    if (pattern === undefined) throw new Error('The duplicate-candidate fixture requires a registered pattern.');
    const applied: PresentationProjectionState[] = [];
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: ({ snapshot }) => {
        if (snapshot.readSet === undefined) throw new Error('The duplicate-candidate fixture needs a read set.');
        const { dataRevision: _dataRevision, ...preconditions } = snapshot.readSet;
        const placeholder = planFor(wide.ref, preconditions);
        return {
          ...baseContext(),
          experience: {
            ...baseContext().experience,
            allowedPatterns: [pattern.ref.id],
          },
          candidates: [
            { source: 'explicit', plan: placeholder },
            { source: 'explicit', plan: placeholder },
            { source: 'pattern', pattern: pattern.ref, plan: placeholder },
            { source: 'pattern', pattern: pattern.ref, plan: placeholder },
          ],
        };
      },
      renderer: createCallbackPresentationRenderer({
        apply: (next) => {
          applied.push(next);
        },
      }),
      dwellMs: 0,
    });

    const outcome = await controller.request(environment(800), { force: true });

    expect(outcome).toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(applied).toHaveLength(1);
    expect(region.snapshot().state?.presentation?.nodes[0]?.representation.id).toBe(wide.ref.id);
    controller.dispose();
  });

  it('derives order-independent IDs and removes exact duplicate legacy candidates', () => {
    const readSet = setup().region.snapshot().readSet;
    if (readSet === undefined) throw new Error('The deterministic candidate fixture needs a read set.');
    const { dataRevision: _dataRevision, ...preconditions } = readSet;
    const wide = { source: 'explicit' as const, plan: planFor({ id: 'layout.wide', revision: '1' }, preconditions) };
    const narrow = {
      source: 'explicit' as const,
      plan: planFor({ id: 'layout.narrow', revision: '1' }, preconditions),
    };

    const first = resolverCandidates([wide, narrow, wide]);
    const reversed = resolverCandidates([wide, narrow, wide].reverse());

    expect(reversed).toEqual(first);
    expect(first).toHaveLength(2);
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(2);
    expect(first.every((candidate) => candidate.id.startsWith('legacy.'))).toBe(true);
  });

  it('rejects proxied legacy candidates without invoking value traps', () => {
    let reads = 0;
    const hostile = new Proxy(
      { source: 'explicit', plan: {} },
      {
        get(target, property, receiver) {
          reads++;
          return Reflect.get(target, property, receiver);
        },
      },
    ) as unknown as NonNullable<PresentationAdaptationContext['candidates']>[number];

    expect(() => resolverCandidates([hostile])).not.toThrow();
    expect(resolverCandidates([hostile])).toEqual([{ id: 'legacy.invalid', source: 'explicit', plan: {} }]);
    expect(reads).toBe(0);
  });

  it('rejects accessor-bearing legacy candidates without invoking getters', () => {
    let reads = 0;
    const hostile = { plan: {} } as { source?: string; plan: object };
    Object.defineProperty(hostile, 'source', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('host getter executed');
      },
    });
    const candidate = hostile as unknown as NonNullable<PresentationAdaptationContext['candidates']>[number];

    expect(() => resolverCandidates([candidate])).not.toThrow();
    expect(resolverCandidates([candidate])).toEqual([{ id: 'legacy.invalid', source: 'explicit', plan: {} }]);
    expect(reads).toBe(0);
  });

  it('turns a hostile legacy candidate into a controlled adaptation failure', async () => {
    const { region, registry } = setup();
    let reads = 0;
    const hostile = new Proxy(
      { source: 'explicit', plan: {} },
      {
        get(target, property, receiver) {
          reads++;
          return Reflect.get(target, property, receiver);
        },
      },
    ) as unknown as NonNullable<PresentationAdaptationContext['candidates']>[number];
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: { ...baseContext(), candidates: [hostile] },
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });

    const outcome = await controller.request(environment(800));

    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'presentation.input' }] });
    expect(reads).toBe(0);
    controller.dispose();
  });

  it('treats text scale as an accessibility change even with a fixed container', async () => {
    const { region, registry } = setup();
    let reads = 0;
    const renderer = createCallbackPresentationRenderer({ apply: () => {} });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: () => {
        reads++;
        return baseContext();
      },
      renderer,
      dwellMs: 0,
    });
    await controller.request(environment(800, 1));
    const second = await controller.request(environment(800, 2));
    expect(second.ok).toBe(true);
    expect(reads).toBe(2);
    controller.dispose();
  });

  it('does not churn the region when the composed presentation is semantically unchanged', async () => {
    const { region, registry } = setup();
    const applied: PresentationProjectionState[] = [];
    const renderer = createCallbackPresentationRenderer({
      apply: (next) => {
        applied.push(next);
      },
    });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer,
      dwellMs: 0,
    });
    const first = await controller.request(environment(800));
    expect(first).toMatchObject({ ok: true, value: { status: 'committed' } });
    const before = region.snapshot();
    const second = await controller.request(environment(800), { force: true });
    expect(second).toMatchObject({ ok: true, value: { status: 'unchanged' } });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(applied).toHaveLength(1);
    controller.dispose();
  });

  it('accumulates small resize deltas from the last applied measurement', async () => {
    const { region, registry } = setup();
    let reads = 0;
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: () => {
        reads++;
        return baseContext();
      },
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
      hysteresisPx: 8,
    });
    await controller.request(environment(800));
    for (let width = 801; width < 808; width++) {
      await expect(controller.request(environment(width))).resolves.toMatchObject({
        ok: true,
        value: { status: 'deferred', reason: 'hysteresis' },
      });
    }
    expect(reads).toBe(1);
    await expect(controller.request(environment(808))).resolves.toMatchObject({
      ok: true,
      value: { status: 'unchanged' },
    });
    expect(reads).toBe(2);
    controller.dispose();
  });

  it('clears queued work immediately when disposed', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    const request = controller.request(environment(800));
    expect(controller.pending).toBe(true);
    controller.dispose();
    expect(controller.pending).toBe(false);
    await expect(request).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-disposed' }],
    });
  });

  it('defers explicit-only transitions before composing the incumbent fallback', async () => {
    const { region, registry } = setup();
    let reads = 0;
    const context = {
      ...baseContext(),
      experience: { ...baseContext().experience, transitionPolicy: 'explicit-only' as const },
    };
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: () => {
        reads++;
        return context;
      },
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    const first = await controller.request(environment(800), { explicit: true });
    expect(first).toMatchObject({ ok: true, value: { status: 'committed' } });
    const before = region.snapshot();
    const blocked = await controller.request(environment(320));
    expect(blocked).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
    expect(region.snapshot().regionRevision).toBe(before.regionRevision);
    expect(reads).toBe(2);
    controller.dispose();
  });

  it('defers a live transition guard without consuming the measurement baseline', async () => {
    const { region, registry } = setup();
    let blocked = true;
    let reads = 0;
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: () => {
        reads++;
        return baseContext();
      },
      transitionBlocked: () => blocked,
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    const first = await controller.request(environment(800), { force: true });
    expect(first).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
    expect(reads).toBe(1);
    blocked = false;
    const second = await controller.request(environment(800), { force: true });
    expect(second).toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(reads).toBe(2);
    controller.dispose();
  });

  it('does not let an explicit request bypass a live transition guard', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      transitionBlocked: () => true,
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    const outcome = await controller.request(environment(800), { explicit: true, force: true });
    expect(outcome).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
    expect(region.snapshot().state?.presentation).toBeUndefined();
    controller.dispose();
  });

  it('returns the committed receipt even when an injected clock throws afterward', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
      now: () => {
        throw new Error('clock failed');
      },
    });
    await expect(controller.request(environment(800))).resolves.toMatchObject({
      ok: true,
      value: { status: 'committed' },
    });
    controller.dispose();
  });

  it('settles queued callers when an injected scheduler fails', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
      schedule: () => {
        throw new Error('scheduler failed');
      },
    });
    await expect(controller.request(environment(800))).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-schedule' }],
    });
    controller.dispose();
  });

  it('supports a synchronous scheduler without entering the scheduler TDZ', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
      schedule: (callback) => {
        callback();
      },
    });
    await expect(controller.request(environment(800))).resolves.toMatchObject({
      ok: true,
      value: { status: 'committed' },
    });
    controller.dispose();
  });

  it('settles callers when a region snapshot unexpectedly rejects the run', async () => {
    const { region, registry } = setup();
    const broken = Object.create(region) as RegionHandle;
    broken.snapshot = () => {
      throw new Error('snapshot failed');
    };
    const controller = createPresentationAdaptationController({
      region: broken,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    await expect(controller.request(environment(800))).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-context' }],
    });
    controller.dispose();
  });

  it('settles queued work and clears scheduled state when the region is revoked', async () => {
    const { region, registry } = setup();
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
    });
    const request = controller.request(environment(800));
    expect(controller.pending).toBe(true);
    region.revoke('revoked by test');
    expect(controller.pending).toBe(false);
    await expect(request).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-revoked' }],
    });
    await expect(controller.request(environment(800))).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-disposed' }],
    });
  });

  it('does not publish visible content while stage is waiting on host validation', async () => {
    const { region, registry } = setup();
    const applied: PresentationProjectionState[] = [];
    const renderer = createCallbackPresentationRenderer({
      apply: (next) => {
        applied.push(next);
      },
    });
    let stageStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      stageStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayedRegion = Object.create(region) as typeof region;
    delayedRegion.stage = async (input) => {
      stageStarted();
      await gate;
      return region.stage(input);
    };
    const controller = createPresentationAdaptationController({
      region: delayedRegion,
      registry,
      baseContext: baseContext(),
      renderer,
      dwellMs: 0,
    });
    const request = controller.request(environment(800));
    await started;
    expect(applied).toHaveLength(0);
    release();
    await expect(request).resolves.toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(applied).toHaveLength(1);
    controller.dispose();
  });

  it('coalesces resize requests and settles an ignored host refresh on cancellation', async () => {
    const { region, registry } = setup();
    const renderer = createCallbackPresentationRenderer({ apply: () => {} });
    let release = false;
    const hanging = () =>
      new Promise<PresentationAdaptationContext>(() => {
        release = false;
      });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      readContext: hanging,
      renderer,
      dwellMs: 0,
    });
    const first = controller.request(environment(800));
    void controller.flush();
    await Promise.resolve();
    const second = controller.request(environment(320));
    await expect(first).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-cancelled' }],
    });
    controller.dispose();
    await expect(second).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.presentation-disposed' }],
    });
    expect(release).toBe(false);
  });

  it('rolls back a renderer failure without publishing canonical state', async () => {
    const { region, registry } = setup();
    let visible = false;
    const renderer = createCallbackPresentationRenderer({
      apply: () => {
        visible = true;
        throw new Error('render failed');
      },
      rollback: () => {
        visible = false;
      },
    });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer,
      dwellMs: 0,
    });
    const outcome = await controller.request(environment(800));
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'runtime.presentation-renderer' }] });
    expect(visible).toBe(false);
    expect(region.snapshot().state?.presentation).toBeUndefined();
    controller.dispose();
  });
  it('ignores a cancelled void-handle callback instead of stealing a later queued request', async () => {
    const { region, registry } = setup();
    const callbacks: (() => void)[] = [];
    let reads = 0;
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: () => {
        reads++;
        return baseContext();
      },
      renderer: createCallbackPresentationRenderer({ apply: () => {} }),
      dwellMs: 0,
      schedule: (callback) => {
        callbacks.push(callback);
      },
    });
    const first = controller.request(environment(800));
    await controller.flush();
    await expect(first).resolves.toMatchObject({ ok: true });
    const second = controller.request(environment(320));
    expect(callbacks).toHaveLength(2);
    const before = reads;
    callbacks[0]!();
    await Promise.resolve();
    expect(reads).toBe(before);
    callbacks[1]!();
    await expect(second).resolves.toMatchObject({ ok: true, value: { status: 'committed' } });
    expect(region.snapshot().state!.presentation!.nodes[0]!.representation.id).toBe('layout.narrow');
    controller.dispose();
  });

  it('keeps revoked content cleared when a failed commit rolls back an applied renderer', async () => {
    const { region, registry } = setup();
    let visible = 'private incumbent';
    let rollbacks = 0;
    const renderer = createCallbackPresentationRenderer({
      apply: () => {
        visible = 'candidate';
        region.revoke('revoked during apply');
      },
      rollback: () => {
        rollbacks++;
        visible = 'private incumbent';
      },
      clear: () => {
        visible = '';
      },
    });
    const controller = createPresentationAdaptationController({
      region,
      registry,
      baseContext: baseContext(),
      renderer,
      dwellMs: 0,
    });
    const pending = controller.request(environment(800));
    await expect(pending).resolves.toMatchObject({ ok: false });
    // Wait for the commit's failure and finally block, not just the observer's early settlement.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visible).toBe('');
    expect(rollbacks).toBe(0);
    controller.dispose();
  });

  it('clears renderer content when attached to an already closed region', async () => {
    for (const close of ['revoke', 'dispose'] as const) {
      const { region, registry } = setup();
      let visible = 'old data';
      region[close]();
      const controller = createPresentationAdaptationController({
        region,
        registry,
        baseContext: baseContext(),
        renderer: createCallbackPresentationRenderer({
          apply: () => {},
          clear: () => {
            visible = '';
          },
        }),
      });
      expect(visible).toBe('');
      await expect(controller.request(environment(800))).resolves.toMatchObject({ ok: false });
      controller.dispose();
    }
  });
});
