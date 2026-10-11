import { describe, it, expect } from 'vitest';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { fixture } from '../foundation/semantic-fixture.js';

describe('inputs in the canonical presentation graph', () => {
  it('accepts queryless draft targets without claiming Result fields', () => {
    const f = fixture();
    const inputs = {
      revision: 'input-1',
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
    const registry = createAeliqoPresentationRegistry({ inputs });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const plan = {
      ...f.plan,
      rootId: 'name',
      nodes: [
        {
          id: 'name',
          role: 'input',
          representation: { id: 'input.text-field', revision: '1' },
          config: {
            schema: { id: 'input.text-field.config', revision: '1' },
            values: { bindingRef: 'name', bindingRevision: 'input-1' },
          },
          children: [],
        },
      ],
      coverage: [],
    };
    const context = {
      ...f.context,
      task: { ...f.context.task, needs: [] },
      experience: { ...f.context.experience, allowedRepresentations: ['input.text-field'] },
      rendererCapabilities: registry.value.manifests.map((m) => m.ref),
    };
    const checked = validatePresentationPlan(plan, context, registry.value);
    expect(checked).toMatchObject({ ok: true });
    if (checked.ok)
      expect(checked.value.nodes[0]!.config).toMatchObject({
        fields: [],
        values: { label: 'Name', defaultValue: 'Ada' },
        ports: [{ payload: 'draft', entity: 'profile' }],
      });
    expect(
      validatePresentationPlan(
        {
          ...plan,
          nodes: plan.nodes.map((n) => ({
            ...n,
            config: { ...n.config, values: { ...n.config.values, bindingRevision: 'old' } },
          })),
        },
        context,
        registry.value,
      ).ok,
    ).toBe(false);
  });
});
