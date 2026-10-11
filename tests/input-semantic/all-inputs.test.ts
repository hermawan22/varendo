import { describe, it, expect } from 'vitest';
import { html } from 'lit';
import { type SemanticType } from '../../packages/core/src/index.js';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { AELIQO_INPUT_REFS } from '../../packages/web/src/input/manifest.js';
import type { AeliqoInputBinding } from '../../packages/web/src/region/input-registry.js';
import { fixture } from '../foundation/semantic-fixture.js';

function allInputs() {
  const f = fixture();
  const draft = (field: string, type: SemanticType = { value: 'text', nullable: false }) => ({
    entity: 'profile',
    key: 'self',
    field,
    entityRevision: '1',
    type,
  });
  const inputs: AeliqoInputBinding[] = Object.values(AELIQO_INPUT_REFS).map((ref) => {
    const id = ref.id;
    const config: Record<string, unknown> = { label: id };
    if (id === 'input.form')
      return { id, ref, config, action: { action: { id: 'profile.save', revision: '1' }, input: {} } };
    if (id === 'input.field-group') return { id, ref, config: { legend: 'Profile' } };
    if (id === 'input.file-input')
      return { id, ref, config, file: { schema: { id: 'files.metadata', revision: '1' } } };
    if (id === 'input.date-range')
      return {
        id,
        ref,
        config,
        range: {
          start: draft('start', { value: 'date', nullable: false }),
          end: draft('end', { value: 'date', nullable: false }),
        },
      };
    let type: SemanticType = { value: 'text', nullable: false };
    if (['input.checkbox', 'input.switch'].includes(id)) type = { value: 'boolean', nullable: false };
    if (id === 'input.number-field') type = { value: 'integer', nullable: false };
    if (id === 'input.date-field') type = { value: 'date', nullable: false };
    if (id === 'input.slider') {
      type = { value: 'float', nullable: false, unit: { dimension: 'temperature', symbol: 'C' } };
      config.unit = 'C';
    }
    if (['input.select', 'input.combobox', 'input.radio-group'].includes(id))
      config.options = [{ value: 'a', label: 'Option A' }];
    return { id, ref, config, draft: draft(id, type) };
  });
  const made = createAeliqoPresentationRegistry({ inputs: { revision: 'all-1', inputs } });
  if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
  const plan = {
    ...f.plan,
    rootId: 'input.form',
    nodes: inputs.map((b) => ({
      id: b.id,
      role: ['input.form', 'input.field-group'].includes(b.id) ? 'structure' : 'input',
      representation: b.ref,
      config: {
        schema: { id: b.ref.id + '.config', revision: '1' },
        values: { bindingRef: b.id, bindingRevision: 'all-1' },
      },
      children:
        b.id === 'input.form'
          ? ['input.field-group']
          : b.id === 'input.field-group'
            ? inputs.filter((x) => !['input.form', 'input.field-group'].includes(x.id)).map((x) => x.id)
            : [],
    })),
    coverage: [{ needId: 'save', nodeIds: ['input.form'], operations: [{ id: 'profile.save', revision: '1' }] }],
  };
  const context = {
    ...f.context,
    task: {
      ...f.context.task,
      needs: [{ id: 'save', operation: { id: 'profile.save', revision: '1' }, fields: [], required: true }],
    },
    experience: { ...f.context.experience, allowedRepresentations: inputs.map((b) => b.ref.id) },
    rendererCapabilities: made.value.manifests.map((m) => m.ref),
  };
  const checked = validatePresentationPlan(plan, context, made.value);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  return checked.value;
}
describe('complete input semantic surface', () => {
  it('validates all fifteen owned components in one queryless graph', () => {
    expect(allInputs().nodes).toHaveLength(15);
  });
  it('renders actual declarative shadow content with request isolation', async () => {
    const { renderAeliqo } = await import('../../packages/web/dist/server.js');
    const output = await renderAeliqo(html`<aeliqo-region .presentation=${allInputs()}></aeliqo-region>`);
    expect(output).toContain('shadowrootmode="open"');
    for (const ref of Object.values(AELIQO_INPUT_REFS)) expect(output).toContain(`<aeliqo-${ref.id.slice(6)}`);
    expect(output).toContain('Option A');
    expect(output).toContain('<legend');
    const empty = await renderAeliqo(html`<aeliqo-region></aeliqo-region>`);
    expect(empty).not.toContain('Option A');
  });
});
