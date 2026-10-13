import type { CommitPreconditions, Intent, Outcome, PresentationPlan, Result, Task, VersionRef } from '@varendo/core';
import type { PresentationEnvironment } from '@varendo/core/presentation';
import type { VarendoViewDefinition } from '../region/types.js';
import type { VarendoInputBindings } from '../region/input-registry.js';

export interface RecipePresentationPolicy {
  /** Canonical representation IDs permitted by the mounted resource. */
  readonly allowedRepresentations: readonly string[];
}

export interface RecipeContext {
  readonly intent: Intent;
  readonly task: Task;
  /** Primary result retained for recipes that render a single output. */
  readonly result?: Result;
  /** Every authorized output descriptor. Always supplied by the app facade. */
  readonly results?: readonly Result[];
  readonly inputBindings?: VarendoInputBindings;
  readonly current: CommitPreconditions;
  readonly environment: PresentationEnvironment;
  readonly availableViews: readonly VarendoViewDefinition[];
  /** Supplied by the app facade. Optional for source compatibility with direct recipe consumers. */
  readonly presentationPolicy?: RecipePresentationPolicy;
  readonly incumbent?: PresentationPlan;
}

/** Built-in intent kinds remain separate from host-registered custom intent identities. */
export type StandardRecipeIntent = Exclude<Intent, { readonly kind: 'custom' }>['kind'];
export type RecipeIntent = StandardRecipeIntent | VersionRef;

export interface RecipeDefinition {
  readonly ref: VersionRef;
  /** Standard intent aliases or exact, trusted custom-intent identities. */
  readonly intents: readonly RecipeIntent[];
  build(context: RecipeContext): Outcome<PresentationPlan>;
}

export interface RecipeInput extends RecipeDefinition {}

export interface ViewInput extends VarendoViewDefinition {}
