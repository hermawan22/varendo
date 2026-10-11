import {
  createPresentationRegistry,
  type PresentationPatternManifest,
  type PresentationTargetEvidence,
} from '@varendo/core/presentation';
import type { PresentationPlan } from '@varendo/core';
import { createRegionStore } from '@varendo/runtime/regions';
import { createAeliqoRegionAdaptation } from '@varendo/web/region/adaptation';
import { createAeliqoPresentationRegistry } from '@varendo/web/region';
import { registerAeliqoElements } from '@varendo/web/register';
import type { AeliqoRegionElement } from '@varendo/web/region';
import { presentationTask, result, ref, experience } from '../contracts/fixtures.js';
registerAeliqoElements();
const ok = <T>(value: T) => ({ ok: true as const, value });
const unwrap = <T>(outcome: { ok: true; value: T } | { ok: false; diagnostics: unknown }): T => {
  if (!outcome.ok) throw Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
};
const inputs = {
  revision: 'inputs-1',
  inputs: [
    {
      id: 'name',
      ref: { id: 'input.text-field' as const, revision: '1' as const },
      config: { label: 'Name', defaultValue: 'Ada' },
      draft: {
        entity: 'profile',
        key: 'self',
        field: 'name',
        entityRevision: '1',
        type: { value: 'text' as const, nullable: false },
      },
    },
  ],
};
const base = unwrap(
  createAeliqoPresentationRegistry({ inputs, foundation: { revision: 'copy-1' }, resolveEntity: () => 'employees' }),
);
const names = ['foundation.stack', 'input.text-field', 'data.table'];
const manifests = base.manifests
  .filter((m) => names.includes(m.ref.id))
  .map((m) =>
    m.ref.id !== 'foundation.stack'
      ? m
      : {
          ...m,
          assess: (config: any, _result: any, env: any) => {
            const desired =
              env.inlineSize.state === 'known' &&
              env.inlineSize.value / (env.textScale.state === 'known' ? env.textScale.value : 1) >= 600
                ? 'row'
                : 'column';
            return ok({
              taskFit: config.values.direction === desired ? 100 : 0,
              informationDensity: 100,
              interactionEffort: 0,
              legibilityPenalty: 0,
            });
          },
        },
  );
const pattern: PresentationPatternManifest = {
  ref: { id: 'preferences', revision: '1' },
  matches: (plan) => plan.rootId === 'layout',
  expand: (request) => {
    const env = request.context.environment;
    const direction =
      env.inlineSize.state === 'known' &&
      env.inlineSize.value / (env.textScale.state === 'known' ? env.textScale.value : 1) >= 600
        ? 'row'
        : 'column';
    const plan: PresentationPlan = {
      id: request.id,
      revision: request.revision,
      rootId: 'layout',
      preconditions: request.preconditions,
      nodes: [
        {
          id: 'layout',
          role: 'structure',
          representation: { id: 'foundation.stack', revision: '1' },
          config: {
            schema: { id: 'foundation.stack.config', revision: '1' },
            values: { bindingRevision: 'copy-1', direction, gap: 16 },
          },
          children: ['name', 'people'],
        },
        {
          id: 'name',
          role: 'input',
          representation: inputs.inputs[0]!.ref,
          config: {
            schema: { id: 'input.text-field.config', revision: '1' },
            values: { bindingRef: 'name', bindingRevision: 'inputs-1' },
          },
          children: [],
        },
        {
          id: 'people',
          role: 'table',
          representation: { id: 'data.table', revision: '1' },
          result: ref,
          config: { schema: { id: 'data.table.config', revision: '1' }, values: { selection: 'single' } },
          children: [],
        },
      ],
      links: [],
      coverage: [{ needId: 'read', nodeIds: ['people'], operations: [{ id: 'data.read', revision: '1' }] }],
      stateTransfer: [],
      diagnostics: [],
    };
    return ok(plan);
  },
};
const registry = unwrap(createPresentationRegistry(manifests, [], [pattern]));
const task = {
  ...presentationTask,
  needs: [
    {
      id: 'read',
      operation: { id: 'data.read', revision: '1' },
      fields: ['employee.id'],
      outputId: 'rows',
      required: true,
    },
  ],
};
const authority = {
  principalKey: 'browser',
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-r1',
  functionRegistryDigest: 'functions-1',
  results: [ref],
};
const store = createRegionStore({ readAuthority: () => ok(authority), authorizeCommit: () => ok(undefined) });
const region = unwrap(store.create({ id: 'region-1', state: { task } }));
const target = (state: PresentationTargetEvidence['state'], surfaceId = region.id): PresentationTargetEvidence => ({
  address: {
    runtimeId: 'installed-consumer',
    scopeInstanceId: 'scope-1',
    activationEpoch: 1,
    surfaceId,
    surfaceGeneration: 1,
  },
  state,
});
let targetEvidence = target('active');
const container = document.querySelector('#mount')!;
const shadow = container.attachShadow({ mode: 'open' });
const element = document.createElement('aeliqo-region') as AeliqoRegionElement;
shadow.append(element);
element.results = [{ ref, rows: [{ 'employee.id': 'e-1' }] }];
let reads = 0;
const adaptation = createAeliqoRegionAdaptation({
  element,
  region,
  registry,
  target: { address: target('active').address, read: () => targetEvidence },
  autoObserve: false,
  dwellMs: 0,
  baseContext: (input) => {
    reads++;
    const pins = input.snapshot.readSet!;
    const expanded = unwrap(
      pattern.expand({
        id: 'proposed',
        revision: '1',
        preconditions: pins,
        context: { task, current: pins, experience, environment: input.environment, results: [result] },
      }),
    );
    const plan = {
      ...expanded,
      stateTransfer:
        input.snapshot.state?.presentation?.nodes.map((node) => ({
          fromNode: node.id,
          toNode: node.id,
          mapping: { id: 'aeliqo.state.identity', revision: '1' },
        })) ?? [],
    };
    return {
      candidates: [{ source: 'explicit', plan }],
      ...{
        experience: {
          ...experience,
          allowedRepresentations: names,
          allowedPatterns: ['preferences'],
          composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
        },
      },
      results: [result],
      rendererCapabilities: manifests.map((m) => m.ref),
    };
  },
});
const measure = (width: number, textScale = 1) => ({
  inlineSize: { state: 'known' as const, value: width },
  blockSize: { state: 'known' as const, value: 600 },
  textScale: { state: 'known' as const, value: textScale },
  pointer: 'fine' as const,
  hover: 'available' as const,
  keyboard: 'available' as const,
  locale: 'en-US',
  direction: 'ltr' as const,
  reducedMotion: false,
  forcedColors: false,
});
Object.assign(window, {
  proof: {
    element,
    region,
    adaptation,
    reads: () => reads,
    request: (width: number, textScale = 1) => adaptation.request(measure(width, textScale), { force: true }),
    requestWithTarget: (width: number, state: PresentationTargetEvidence['state'], surfaceId?: string) => {
      targetEvidence = target(state, surfaceId);
      return adaptation.request(measure(width), { force: true });
    },
  },
});
const initial = await adaptation.request(measure(900), { force: true });
Object.assign(window, { initial });
Object.assign(window, { ready: true });
