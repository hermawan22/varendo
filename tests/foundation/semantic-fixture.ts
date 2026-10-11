import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext, PresentationValues } from '../../packages/core/src/presentation/index.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { AELIQO_FOUNDATION_MANIFESTS } from '../../packages/web/src/foundation/manifest.js';
import type { AeliqoFoundationBindings } from '../../packages/web/src/region/foundation-registry.js';
import { environment, experience, presentationPlan, presentationTask } from '../contracts/fixtures.js';

export const save = { id: 'profile.save', revision: '1' };
export const route = { id: 'profile.open', revision: '1' };
export const bindings: AeliqoFoundationBindings = {
  revision: 'copy-1',
  contents: [
    { id: 'title', text: 'Account preferences' },
    {
      id: 'description',
      text: 'Choose the settings that work for you. Your application remains in control of saving changes.',
    },
    { id: 'save', text: 'Save preferences' },
    { id: 'more', text: 'More options' },
    { id: 'link', text: 'View profile' },
    { id: 'badge', text: 'Draft' },
    { id: 'panel', text: 'Preferences panel' },
    { id: 'scroll', text: 'Preference details' },
  ],
  actions: [
    { id: 'save', action: save, input: { profileId: 'self' } },
    { id: 'more', action: save, input: { profileId: 'self', mode: 'options' } },
  ],
  routes: [{ id: 'profile', route, params: { profileId: 'self' }, href: '/profile' }],
  identities: [{ id: 'owner', name: 'Ada Lovelace' }],
};
export function fixture(input = bindings) {
  const created = createAeliqoPresentationRegistry({ foundation: input });
  if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
  const registry = created.value;
  const values: Readonly<Record<string, PresentationValues>> = {
    button: { contentRef: 'save', actionRef: 'save' },
    'icon-button': { contentRef: 'more', actionRef: 'more' },
    link: { contentRef: 'link', routeRef: 'profile' },
    text: { contentRef: 'description', as: 'p' },
    heading: { contentRef: 'title', level: 2 },
    badge: { contentRef: 'badge' },
    avatar: { identityRef: 'owner' },
    separator: {},
    surface: { labelRef: 'panel' },
    stack: { gap: 16 },
    grid: { columns: 2 },
    'split-pane': { position: 50 },
    'scroll-area': { labelRef: 'scroll' },
  };
  const children: Readonly<Record<string, readonly string[]>> = {
    surface: ['stack'],
    stack: ['heading', 'separator', 'split-pane', 'button', 'icon-button', 'link'],
    grid: ['badge', 'avatar'],
    'split-pane': ['scroll-area', 'grid'],
    'scroll-area': ['text'],
  };
  const plan: PresentationPlan = {
    ...presentationPlan,
    rootId: 'surface',
    preconditions: { ...presentationPlan.preconditions, results: [] },
    nodes: AELIQO_FOUNDATION_MANIFESTS.map((m) => {
      const id = m.ref.id.slice('foundation.'.length);
      return {
        id,
        role: m.role,
        representation: m.ref,
        config: {
          schema: { id: `${m.ref.id}.config`, revision: '1' },
          values: { ...values[id]!, bindingRevision: input.revision },
        },
        children: children[id] ?? [],
      };
    }),
    coverage: [
      { needId: 'save', nodeIds: ['button'], operations: [save] },
      { needId: 'navigate', nodeIds: ['link'], operations: [route] },
    ],
  };
  const context: PresentationContext = {
    task: {
      ...presentationTask,
      inputs: [],
      goal: 'Show account preferences',
      needs: [
        { id: 'save', operation: save, fields: [], required: true },
        { id: 'navigate', operation: route, fields: [], required: true },
      ],
    },
    experience: {
      ...experience,
      mode: 'composable',
      allowedRepresentations: AELIQO_FOUNDATION_MANIFESTS.map((m) => m.ref.id),
      composition: { allowWithoutPreset: true, maxNodes: 32, maxExpansions: 64 },
    },
    current: plan.preconditions,
    environment,
    results: [],
    rendererCapabilities: registry.manifests.map((m) => m.ref),
  };
  return { plan, context, registry };
}
export function validatedFixture() {
  const f = fixture();
  const checked = validatePresentationPlan(f.plan, f.context, f.registry);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  return checked.value;
}
