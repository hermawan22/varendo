import { createPresentationRegistry } from '@varendo/core/presentation';
import type { RecipeDefinition, RecipeInput, RecipeIntent, ViewInput } from './types.js';
import type { AeliqoViewDefinition } from '../region/types.js';

function validNamespacedId(id: string): boolean {
  return id.includes('.') && id.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(id);
}

function validRevision(revision: string): boolean {
  return revision.length > 0 && revision.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(revision);
}

function validRecipeRevision(revision: string): boolean {
  return revision.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(revision);
}

function validCustomIntent(ref: unknown): ref is Extract<RecipeIntent, object> {
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    typeof candidate.id === 'string' &&
    typeof candidate.revision === 'string' &&
    validNamespacedId(candidate.id) &&
    validRevision(candidate.revision)
  );
}

const STANDARD_INTENTS: ReadonlySet<string> = new Set(['browse', 'detail', 'create', 'edit', 'compare', 'analyze']);

function validIntent(intent: unknown): intent is RecipeIntent {
  return (typeof intent === 'string' && STANDARD_INTENTS.has(intent)) || validCustomIntent(intent);
}

function intentKey(intent: RecipeIntent): string {
  return typeof intent === 'string' ? `standard:${intent}` : `custom:${intent.id}@${intent.revision}`;
}

export function defineRecipe(input: RecipeInput): RecipeDefinition {
  const intents = input.intents;
  if (
    !validNamespacedId(input.ref.id) ||
    !validRecipeRevision(input.ref.revision) ||
    !Array.isArray(intents) ||
    intents.length === 0 ||
    intents.some((intent) => !validIntent(intent)) ||
    new Set(intents.map(intentKey)).size !== intents.length
  )
    throw new TypeError('A recipe needs a namespaced versioned ID and unique supported intents or custom intent refs.');
  if (typeof input.build !== 'function') throw new TypeError('A recipe needs a synchronous trusted build callback.');
  return Object.freeze({
    ...input,
    ref: Object.freeze({ ...input.ref }),
    intents: Object.freeze(
      intents.map((intent) => (typeof intent === 'string' ? intent : Object.freeze({ ...intent }))),
    ),
  });
}

export function defineView(input: ViewInput): AeliqoViewDefinition {
  if (
    !validNamespacedId(input.ref.id) ||
    input.ref.id !== input.manifest.ref.id ||
    input.ref.revision !== input.manifest.ref.revision
  )
    throw new TypeError('A custom view needs one matching namespaced versioned identity.');
  if (input.manifest.extension !== true || typeof input.render !== 'function')
    throw new TypeError('A custom view must be declared as a trusted extension with a renderer.');
  const checked = createPresentationRegistry([input.manifest]);
  if (!checked.ok) throw new TypeError(checked.diagnostics.map((item) => item.message).join(' '));
  return Object.freeze({ ...input, ref: Object.freeze({ ...input.ref }), manifest: checked.value.manifests[0]! });
}
