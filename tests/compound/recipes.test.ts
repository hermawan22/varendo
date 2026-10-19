import { describe, expect, it } from 'vitest';
import { validatePresentationPlan } from '@varendo/core/presentation';
import type { PresentationContext } from '@varendo/core/presentation';
import { createVarendoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import {
  explorerPresentationRecipe,
  breakdownPresentationRecipe,
  qualityPanelPresentationRecipe,
  compoundRecipeHelpers,
} from '../../packages/web/src/compound/recipes.js';
import type { VarendoCompoundRecipeInput } from '../../packages/web/src/compound/types.js';
import { dataPresentationContext, dataPresentationPlan, registryOptions } from '../data-semantic/fixture.js';

function fixture(ids: readonly string[]): VarendoCompoundRecipeInput {
  const original = dataPresentationPlan();
  const base = dataPresentationContext();
  const stack = { id: 'layout.stack', revision: '1' };
  const context: PresentationContext = {
    ...base,
    task: {
      ...base.task,
      needs: [
        {
          id: 'read',
          operation: { id: 'data.read', revision: '1' },
          fields: ['id'],
          outputId: 'people',
          required: true,
        },
      ],
    },
    experience: { ...base.experience, allowedRepresentations: [...base.experience.allowedRepresentations, stack.id] },
    rendererCapabilities: [...base.rendererCapabilities, stack],
  };
  const registry = createVarendoPresentationRegistry(registryOptions);
  if (!registry.ok) throw new Error('registry');
  return {
    id: 'compound',
    revision: '1',
    preconditions: original.preconditions,
    parts: original.nodes.filter((node) => ids.includes(node.id)),
    coverage: [
      {
        needId: 'read',
        nodeIds: ids.filter((id) => id !== 'filter-builder') as [string, ...string[]],
        operations: [{ id: 'data.read', revision: '1' }],
      },
    ],
    validation: { context, registry: registry.value },
  };
}

describe('compound recipes use the real canonical presentation validator', () => {
  it('builds Explorer from configured registered primitives without invented roots or needs', () => {
    const input = fixture(['filter-builder', 'record-list', 'detail']);
    const result = explorerPresentationRecipe(input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.value.plan.nodes[0]?.representation.id).toBe('layout.stack');
    expect(result.value.plan.coverage.map((item) => item.needId)).toEqual(['read']);
    expect(validatePresentationPlan(result.value.plan, input.validation.context, input.validation.registry).ok).toBe(
      true,
    );
    expect(result.value.childIds).toEqual(['detail', 'record-list', 'filter-builder']);
  });
  it('rejects missing task coverage, stale results, invented configuration, and experience exclusions', () => {
    const input = fixture(['filter-builder', 'record-list', 'detail']);
    expect(explorerPresentationRecipe({ ...input, coverage: [] }).ok).toBe(false);
    expect(
      explorerPresentationRecipe({
        ...input,
        validation: { ...input.validation, context: { ...input.validation.context, results: [] } },
      }).ok,
    ).toBe(false);
    expect(
      explorerPresentationRecipe({
        ...input,
        parts: input.parts.map((node) => ({
          ...node,
          config: { ...node.config, values: { arbitraryCode: 'alert(1)' } },
        })),
      }).ok,
    ).toBe(false);
    expect(
      explorerPresentationRecipe({
        ...input,
        validation: {
          ...input.validation,
          context: {
            ...input.validation.context,
            experience: { ...input.validation.context.experience, allowedRepresentations: [] },
          },
        },
      }).ok,
    ).toBe(false);
  });
  it('validates Breakdown and QualityPanel over actual registered data primitives', () => {
    for (const [make, ids] of [
      [breakdownPresentationRecipe, ['metric', 'record-list']],
      [qualityPanelPresentationRecipe, ['detail']],
    ] as const) {
      const input = fixture(ids);
      const result = make(input);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
  });
  it('fails every macro closed without configured primitive parts', () => {
    for (const make of Object.values(compoundRecipeHelpers))
      expect(make({ ...fixture(['detail']), parts: [] }).ok).toBe(false);
  });
});
