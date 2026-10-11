import { describe, it, expect } from 'vitest';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { bindings, fixture, validatedFixture } from './semantic-fixture.js';

describe('foundation through the production presentation validator', () => {
  it('validates all thirteen queryless representations and resolves typed host operations', () => {
    const checked = validatedFixture();
    expect(checked.nodes).toHaveLength(13);
    expect(checked.nodes.find((n) => n.node.id === 'button')?.config).toMatchObject({
      values: {
        text: 'Save preferences',
        type: 'button',
        action: { id: 'profile.save', revision: '1' },
        actionInput: { profileId: 'self' },
      },
      ports: [{ payload: 'action-request' }],
    });
    expect(checked.nodes.find((n) => n.node.id === 'link')?.config).toMatchObject({
      values: { href: '/profile' },
      ports: [{ payload: 'navigate' }],
    });
  });
  it('rejects forged content, native form side effects and missing registered references', () => {
    for (const patch of [
      { text: 'Invented revenue' },
      { actor: 'admin' },
      { type: 'submit' },
      { type: 'reset' },
      { actionRef: 'unregistered' },
      { contentRef: 'unregistered' },
    ]) {
      const f = fixture();
      const plan = {
        ...f.plan,
        nodes: f.plan.nodes.map((n) =>
          n.id === 'button' ? { ...n, config: { ...n.config, values: { ...n.config.values, ...patch } } } : n,
        ),
      };
      expect(validatePresentationPlan(plan, f.context, f.registry).ok).toBe(false);
    }
  });
  it('snapshots host bindings and rejects executable destinations or duplicate binding ids', () => {
    const mutable = structuredClone(bindings);
    const f = fixture(mutable);
    (mutable.contents as { id: string; text: string }[])[2]!.text = 'Changed outside the registry';
    const checked = validatePresentationPlan(f.plan, f.context, f.registry);
    expect(checked.ok && checked.value.nodes.find((n) => n.node.id === 'button')?.config.values.text).toBe(
      'Save preferences',
    );
    expect(
      createAeliqoPresentationRegistry({
        foundation: { ...bindings, routes: [{ ...bindings.routes![0]!, href: 'javascript:alert(1)' }] },
      }).ok,
    ).toBe(false);
    expect(
      createAeliqoPresentationRegistry({
        foundation: { ...bindings, contents: [bindings.contents![0]!, bindings.contents![0]!] },
      }).ok,
    ).toBe(false);
  });
  it('requires current Experience pins, complete action coverage, and two split children', () => {
    const f = fixture();
    expect(
      validatePresentationPlan(
        f.plan,
        { ...f.context, current: { ...f.context.current, experienceRevision: 'new' } },
        f.registry,
      ).ok,
    ).toBe(false);
    expect(validatePresentationPlan({ ...f.plan, coverage: [] }, f.context, f.registry).ok).toBe(false);
    expect(
      validatePresentationPlan(
        { ...f.plan, nodes: f.plan.nodes.map((n) => (n.id === 'split-pane' ? { ...n, children: ['text'] } : n)) },
        f.context,
        f.registry,
      ).ok,
    ).toBe(false);
  });
  it('rejects a prior binding packet even when the Experience revision is unchanged', () => {
    const original = fixture();
    for (const changed of [
      {
        ...bindings,
        revision: 'copy-2',
        contents: bindings.contents!.map((c) => (c.id === 'save' ? { ...c, text: 'Delete profile' } : c)),
      },
      {
        ...bindings,
        revision: 'copy-2',
        actions: bindings.actions!.map((a) => ({ ...a, input: { profileId: 'other' } })),
      },
      {
        ...bindings,
        revision: 'copy-2',
        routes: bindings.routes!.map((r) => ({ ...r, href: '/other', params: { profileId: 'other' } })),
      },
    ]) {
      const replacement = fixture(changed);
      expect(validatePresentationPlan(original.plan, original.context, replacement.registry).ok).toBe(false);
    }
    const unpinned = {
      ...original.plan,
      nodes: original.plan.nodes.map((n) => {
        const { bindingRevision, ...values } = n.config.values;
        void bindingRevision;
        return { ...n, config: { ...n.config, values } };
      }),
    };
    expect(validatePresentationPlan(unpinned, original.context, original.registry).ok).toBe(false);
  });
});
