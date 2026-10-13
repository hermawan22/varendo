import type { Diagnostic, Outcome, PresentationPlan } from '@varendo/core';
import { VARENDO_INPUT_REFS } from '../input/manifest.js';
import { defineRecipe } from './define.js';
import type { RecipeContext, RecipeDefinition } from './types.js';

function failure(code: string, message: string): Outcome<never> {
  const item: Diagnostic = { code, message, retryable: false };
  return { ok: false, diagnostics: [item] };
}

function buildForm(context: RecipeContext): Outcome<PresentationPlan> {
  if (context.task.kind !== 'form' || context.inputBindings === undefined)
    return failure('web.recipe.unsupported', 'Standard form recipes require host-owned form bindings.');
  const form = context.inputBindings.inputs.find((binding) => binding.ref.id === VARENDO_INPUT_REFS.form.id);
  if (
    form === undefined ||
    form.action === undefined ||
    form.action.action.id !== context.task.action.id ||
    form.action.action.revision !== context.task.action.revision
  )
    return failure('web.recipe.form-binding', 'The form action is not pinned to the compiled Task action.');
  const fields = context.inputBindings.inputs.filter((binding) => binding.ref.id !== VARENDO_INPUT_REFS.form.id);
  const nodes: PresentationPlan['nodes'] = [
    {
      id: 'form',
      role: 'structure',
      representation: VARENDO_INPUT_REFS.form,
      config: {
        schema: { id: 'input.form.config', revision: '1' },
        values: { bindingRef: form.id, bindingRevision: context.inputBindings.revision },
      },
      children: fields.map((field) => field.id),
    },
    ...fields.map((field) => ({
      id: field.id,
      role: field.ref.id === VARENDO_INPUT_REFS.fieldGroup.id ? 'structure' : 'input',
      representation: field.ref,
      config: {
        schema: { id: `${field.ref.id}.config`, revision: '1' },
        values: { bindingRef: field.id, bindingRevision: context.inputBindings!.revision },
      },
      children: [],
    })),
  ];
  return {
    ok: true,
    value: {
      id: `presentation-${context.task.id}`.slice(0, 160),
      revision: context.task.revision,
      rootId: 'form',
      preconditions: context.current,
      nodes,
      links: [],
      coverage: [],
      stateTransfer:
        context.incumbent === undefined
          ? []
          : context.incumbent.nodes.map((node) => ({
              fromNode: node.id,
              toNode: node.id,
              mapping: { id: 'varendo.state.identity', revision: '1' },
            })),
      diagnostics: [],
    },
  };
}

export const standardFormRecipe: RecipeDefinition = defineRecipe({
  ref: { id: 'varendo.recipe.form', revision: '1' },
  intents: ['create', 'edit'],
  build: buildForm,
});
