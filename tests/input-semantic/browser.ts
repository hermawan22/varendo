import { registerAeliqoElements } from '../../packages/web/src/register.js';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import type { AeliqoRegionElement } from '../../packages/web/src/region/aeliqo-region.js';
import type { AeliqoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
import { fixture } from '../foundation/semantic-fixture.js';
registerAeliqoElements();
const f = fixture();
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
    {
      id: 'enabled',
      ref: { id: 'input.checkbox' as const, revision: '1' as const },
      config: { label: 'Enabled', defaultChecked: true },
      draft: {
        entity: 'profile',
        key: 'self',
        field: 'enabled',
        entityRevision: '1',
        type: { value: 'boolean' as const, nullable: false },
      },
    },
    {
      id: 'amount',
      ref: { id: 'input.number-field' as const, revision: '1' as const },
      config: { label: 'Amount', value: '1234.50' },
      draft: {
        entity: 'profile',
        key: 'self',
        field: 'amount',
        entityRevision: '1',
        type: { value: 'decimal' as const, nullable: false },
      },
    },
    {
      id: 'group',
      ref: { id: 'input.field-group' as const, revision: '1' as const },
      config: { legend: 'Preferences' },
    },
  ],
};
const made = createAeliqoPresentationRegistry({ inputs });
if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
const plan = {
  ...f.plan,
  rootId: 'group',
  nodes: inputs.inputs.map((b) => ({
    id: b.id,
    role: b.id === 'group' ? 'structure' : 'input',
    representation: b.ref,
    config: {
      schema: { id: b.ref.id + '.config', revision: '1' },
      values: { bindingRef: b.id, bindingRevision: inputs.revision },
    },
    children: b.id === 'group' ? ['name', 'enabled', 'amount'] : [],
  })),
  coverage: [],
};
const context = {
  ...f.context,
  environment: { ...f.context.environment, locale: 'de-DE', direction: 'rtl' as const },
  task: { ...f.context.task, needs: [] },
  experience: { ...f.context.experience, allowedRepresentations: inputs.inputs.map((b) => b.ref.id) },
  rendererCapabilities: made.value.manifests.map((m) => m.ref),
};
const validated = () => {
  const result = validatePresentationPlan(plan, context, made.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
};
const region = document.querySelector<AeliqoRegionElement>('aeliqo-region')!;
const requests: AeliqoSemanticInteractionRequest[] = [];
region.onSemanticInteraction = (r) => requests.push(r);
region.presentation = validated();
Object.assign(window, {
  inputSemantic: {
    region,
    requests,
    rerender: () => {
      region.presentation = validated();
    },
  },
});
