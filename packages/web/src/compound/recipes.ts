import { parseWireValue, type Outcome, type PresentationPlan, type VersionRef } from '@varendo/core';
import { validatePresentationPlan } from '@varendo/core/presentation';
import type {
  VarendoBreakdownRecipeInput,
  VarendoComparisonRecipeInput,
  VarendoCompoundRecipe,
  VarendoCompoundRecipeInput,
  VarendoExplorerRecipeInput,
  VarendoFormFlowRecipeInput,
  VarendoInvestigationRecipeInput,
  VarendoQualityPanelRecipeInput,
  VarendoRecordEditorRecipeInput,
  VarendoSearchResultsRecipeInput,
} from './types.js';

/** Macro names are authoring identifiers. They are not invented renderer registrations. */
export const VARENDO_COMPOUND_REFS = Object.freeze({
  explorer: { id: 'compound.explorer', revision: '1' },
  comparison: { id: 'compound.comparison', revision: '1' },
  breakdown: { id: 'compound.breakdown', revision: '1' },
  investigation: { id: 'compound.investigation', revision: '1' },
  searchResults: { id: 'compound.search-results', revision: '1' },
  recordEditor: { id: 'compound.record-editor', revision: '1' },
  formFlow: { id: 'compound.form-flow', revision: '1' },
  qualityPanel: { id: 'compound.quality-panel', revision: '1' },
} satisfies Record<string, VersionRef>);
const failure = (message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: 'web.compound.recipe', message, retryable: false }],
});
const required = {
  explorer: [['control.filter-builder'], ['data.record-list', 'data.card-collection', 'data.table'], ['data.detail']],
  comparison: [['data.table', 'visualization.matrix']],
  breakdown: [['data.metric'], ['data.table', 'data.record-list']],
  investigation: [['visualization.trend'], ['visualization.timeline'], ['data.detail']],
  searchResults: [['input.search-field'], ['data.record-list', 'data.card-collection', 'data.table']],
  recordEditor: [['input.form']],
  formFlow: [['input.form']],
  qualityPanel: [['data.detail', 'data.key-value', 'foundation.text']],
} as const;

type RecipePlanParts = Pick<
  PresentationPlan,
  'id' | 'revision' | 'preconditions' | 'nodes' | 'links' | 'coverage' | 'stateTransfer'
>;

function readPlanParts(input: VarendoCompoundRecipeInput): Outcome<RecipePlanParts> {
  if (!input || !input.validation || !Array.isArray(input.parts) || input.parts.length === 0 || input.parts.length > 64)
    return failure('A compound recipe requires configured primitive nodes and the canonical validation context.');
  const checked = parseWireValue({
    id: input.id,
    revision: input.revision,
    preconditions: input.preconditions,
    nodes: input.parts,
    links: input.links ?? [],
    coverage: input.coverage ?? [],
    stateTransfer: input.stateTransfer ?? [],
  });
  if (!checked.ok) return failure('Compound recipe input must be bounded wire data.');
  const copied = checked.value as unknown as RecipePlanParts;
  if (copied.nodes.some(isMalformedPrimitive)) return failure('A compound primitive node is malformed.');
  return { ok: true, value: copied };
}

function isMalformedPrimitive(node: PresentationPlan['nodes'][number]): boolean {
  return (
    !node ||
    typeof node !== 'object' ||
    !node.representation ||
    typeof node.representation !== 'object' ||
    !Array.isArray(node.children)
  );
}

function hasRequiredPrimitives(nodes: PresentationPlan['nodes'], kind: keyof typeof required): boolean {
  return required[kind].every((alternatives) =>
    nodes.some((node) => alternatives.some((ref) => node.representation.id === ref)),
  );
}

function topLevelChildren(nodes: PresentationPlan['nodes']): string[] {
  const contained = new Set(nodes.flatMap((node) => node.children));
  return nodes.filter((node) => !contained.has(node.id)).map((node) => node.id);
}

function validatedPlan(
  input: VarendoCompoundRecipeInput,
  parts: RecipePlanParts,
  rootId: string,
  childIds: readonly string[],
): Outcome<VarendoCompoundRecipe> {
  const plan: PresentationPlan = {
    ...parts,
    rootId,
    nodes: [
      {
        id: rootId,
        role: 'structure',
        representation: { id: 'layout.stack', revision: '1' },
        config: { schema: { id: 'layout.stack.config', revision: '1' }, values: {} },
        children: childIds,
      },
      ...parts.nodes,
    ],
    diagnostics: [],
  };
  const validated = validatePresentationPlan(plan, input.validation.context, input.validation.registry);
  if (!validated.ok) return validated;
  return { ok: true, value: Object.freeze({ plan: validated.value.plan, childIds: Object.freeze([...childIds]) }) };
}

function build(input: VarendoCompoundRecipeInput, kind: keyof typeof required): Outcome<VarendoCompoundRecipe> {
  const copied = readPlanParts(input);
  if (!copied.ok) return copied;
  if (!hasRequiredPrimitives(copied.value.nodes, kind))
    return failure(`The ${kind} recipe is missing a required primitive.`);
  const rootId = `${input.id}:compound-root`;
  if (copied.value.nodes.some((node) => node.id === rootId))
    return failure('The compound root identity conflicts with a supplied primitive.');
  const childIds = topLevelChildren(copied.value.nodes);
  // Actual task needs, exact results, operation coverage, mappings, registered
  // configuration and experience restrictions are all checked by the shared pass.
  return validatedPlan(input, copied.value, rootId, childIds);
}
export const explorerPresentationRecipe = (input: VarendoExplorerRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'explorer');
export const comparisonPresentationRecipe = (input: VarendoComparisonRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'comparison');
export const breakdownPresentationRecipe = (input: VarendoBreakdownRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'breakdown');
export const investigationPresentationRecipe = (
  input: VarendoInvestigationRecipeInput,
): Outcome<VarendoCompoundRecipe> => build(input, 'investigation');
export const searchResultsPresentationRecipe = (
  input: VarendoSearchResultsRecipeInput,
): Outcome<VarendoCompoundRecipe> => build(input, 'searchResults');
export const recordEditorPresentationRecipe = (input: VarendoRecordEditorRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'recordEditor');
export const formFlowPresentationRecipe = (input: VarendoFormFlowRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'formFlow');
export const qualityPanelPresentationRecipe = (input: VarendoQualityPanelRecipeInput): Outcome<VarendoCompoundRecipe> =>
  build(input, 'qualityPanel');
export const compoundRecipeHelpers = Object.freeze({
  explorerPresentationRecipe,
  comparisonPresentationRecipe,
  breakdownPresentationRecipe,
  investigationPresentationRecipe,
  searchResultsPresentationRecipe,
  recordEditorPresentationRecipe,
  formFlowPresentationRecipe,
  qualityPanelPresentationRecipe,
});
