export { defineRecipe, defineView } from './recipes/index.js';
export {
  STANDARD_RECIPES,
  STANDARD_STATE_MAPPINGS,
  STANDARD_VIEW_REFS,
  recipeSupports,
  standardDataRecipe,
  standardFormRecipe,
  standardOperationFor,
} from './recipes/index.js';
export type {
  RecipeContext,
  RecipeDefinition,
  RecipeInput,
  RecipePresentationPolicy,
  ViewInput,
} from './recipes/index.js';
export { AELIQO_WEB_VERSION, registerAeliqoElements } from './register.js';
