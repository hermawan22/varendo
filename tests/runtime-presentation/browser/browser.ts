import {
  createPresentationRegistry,
  type PresentationEnvironment,
  type PresentationManifest,
  type PresentationStateMappingManifest,
} from '../../../packages/core/src/presentation/index.js';
import { createRegionStore, type RegionHandle } from '../../../packages/runtime/src/regions/index.js';
import { createAeliqoRegionAdaptation } from '../../../packages/web/src/region/adaptation.js';
import { createCallbackPresentationRenderer } from '../../../packages/runtime/src/presentation/index.js';
import { registerAeliqoElements } from '../../../packages/web/src/register.js';
import { presentationTask, ref, result } from '../../contracts/fixtures.js';
import type { AeliqoRegionElement } from '../../../packages/web/src/region/aeliqo-region.js';
import type { PresentationAdaptationContext } from '../../../packages/runtime/src/presentation/index.js';

registerAeliqoElements();

const env = (inlineSize: number): PresentationEnvironment => ({
  inlineSize: { state: 'known', value: inlineSize },
  blockSize: { state: 'known', value: 400 },
  textScale: { state: 'known', value: 1 },
  pointer: 'fine',
  hover: 'available',
  keyboard: 'available',
  locale: 'en-US',
  direction: 'ltr',
  reducedMotion: false,
  forcedColors: false,
});

function manifest(id: string, fit: (size: number) => number): PresentationManifest {
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
    assess: (_config, _result, environment) => ({
      ok: true,
      value: {
        taskFit: fit(environment.inlineSize.state === 'known' ? environment.inlineSize.value : 0),
        informationDensity: 100,
        interactionEffort: 0,
        legibilityPenalty: 0,
      },
    }),
  };
}

const wide = manifest('layout.wide', (size) => (size >= 500 ? 100 : 10));
const narrow = manifest('layout.narrow', (size) => (size < 500 ? 100 : 10));
const mappings: readonly PresentationStateMappingManifest[] = [
  {
    ref: { id: 'state.wide-narrow', revision: '1' },
    from: wide.ref,
    to: narrow.ref,
    fromRole: 'view',
    toRole: 'view',
    kind: 'transfer',
  },
  {
    ref: { id: 'state.narrow-wide', revision: '1' },
    from: narrow.ref,
    to: wide.ref,
    fromRole: 'view',
    toRole: 'view',
    kind: 'transfer',
  },
];
const registryResult = createPresentationRegistry([wide, narrow], [], [], mappings);
if (!registryResult.ok) throw new Error(registryResult.diagnostics[0]!.message);
const authority = {
  principalKey: 'browser',
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
const created = store.create({ id: 'region-1', state: { task: presentationTask } });
if (!created.ok) throw new Error(created.diagnostics[0]!.message);
const region = created.value;
const element = document.querySelector<AeliqoRegionElement>('#region')!;
const editor = document.querySelector<HTMLInputElement>('#editor')!;
element.shadowRoot?.append(editor);
let contextReads = 0;
const baseContext = (): PresentationAdaptationContext => {
  contextReads++;
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
    rendererCapabilities: [wide.ref, narrow.ref],
    stateMappingCapabilities: mappings.map((mapping) => mapping.ref),
  };
};
const renderer = createCallbackPresentationRenderer({
  apply: (next) => {
    const root = element.shadowRoot;
    const draft = root?.querySelector<HTMLInputElement>('#editor');
    const value = draft?.value ?? '';
    const focused = draft !== null && root?.activeElement === draft;
    element.presentation = next.presentation;
    element.interaction = next.interaction;
    void element.updateComplete.then(() => {
      if (draft !== null && root !== undefined && !root.contains(draft)) root.append(draft);
      if (draft !== null) draft.value = value;
      if (focused) draft?.focus();
    });
  },
});
const adaptation = createAeliqoRegionAdaptation({
  element,
  region,
  registry: registryResult.value,
  baseContext,
  autoObserve: false,
  dwellMs: 0,
  renderer,
});
let latestWide: Awaited<ReturnType<typeof adaptation.request>> | undefined;
let latestNarrow: Awaited<ReturnType<typeof adaptation.request>> | undefined;
let observed: ReturnType<typeof createAeliqoRegionAdaptation> | undefined;
Object.assign(window, {
  adaptation,
  region,
  editor,
  observeMedia: () => {
    observed?.disconnect();
    observed = createAeliqoRegionAdaptation({
      element,
      region,
      registry: registryResult.value,
      baseContext,
      dwellMs: 0,
      renderer,
    });
  },
  disconnectObserved: () => {
    observed?.disconnect();
    observed = undefined;
  },
  requestWide: async () => {
    latestWide = await adaptation.request(env(800), { force: true });
    return latestWide;
  },
  requestNarrow: async () => {
    latestNarrow = await adaptation.request(env(320), { force: true });
    return latestNarrow;
  },
  latestWide: () => latestWide,
  latestNarrow: () => latestNarrow,
  contextReads: () => contextReads,
});
