import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { registerVarendoElements } from '../../packages/web/src/index.js';
import { explorerPresentationRecipe } from '../../packages/web/src/compound/recipes.js';
import type { VarendoRegionElement } from '../../packages/web/src/region/varendo-region.js';
import { explorerInput, peopleRef, peopleRows } from './fixtures.js';

registerVarendoElements();

const supplied = explorerInput();
const recipe = explorerPresentationRecipe(supplied);
if (!recipe.ok) throw new Error(JSON.stringify(recipe.diagnostics));
const checked = validatePresentationPlan(
  recipe.value.plan,
  supplied.validation.context as any,
  supplied.validation.registry as any,
);
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));

const region = document.querySelector<VarendoRegionElement>('#region');
if (region === null) throw new Error('Canonical compound region is missing.');
const events: unknown[] = [];
region.onSemanticInteraction = (request) => events.push(request);
region.presentation = checked.value;
region.results = [{ ref: peopleRef, rows: peopleRows }];

Object.assign(window, { varendoCompoundSemanticReady: true, varendoCompoundSemanticEvents: events });
