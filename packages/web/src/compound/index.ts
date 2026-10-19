export {
  VarendoExplorerElement,
  VarendoComparisonElement,
  VarendoBreakdownElement,
  VarendoInvestigationElement,
  VarendoSearchResultsElement,
  VarendoRecordEditorElement,
  VarendoFormFlowElement,
  VarendoQualityPanelElement,
} from './elements.js';
export { COMPOUND_VERSION, VarendoCompoundElement, compoundStyles, varendoCompoundThemeStyles } from './base.js';
export {
  VARENDO_COMPOUND_REFS,
  compoundRecipeHelpers,
  explorerPresentationRecipe,
  comparisonPresentationRecipe,
  breakdownPresentationRecipe,
  investigationPresentationRecipe,
  searchResultsPresentationRecipe,
  recordEditorPresentationRecipe,
  formFlowPresentationRecipe,
  qualityPanelPresentationRecipe,
} from './recipes.js';
export type * from './types.js';

import { COMPOUND_VERSION } from './base.js';
import {
  VarendoBreakdownElement,
  VarendoComparisonElement,
  VarendoExplorerElement,
  VarendoFormFlowElement,
  VarendoInvestigationElement,
  VarendoQualityPanelElement,
  VarendoRecordEditorElement,
  VarendoSearchResultsElement,
} from './elements.js';
export const VARENDO_COMPOUND_ELEMENTS = [
  ['varendo-explorer', VarendoExplorerElement],
  ['varendo-comparison', VarendoComparisonElement],
  ['varendo-breakdown', VarendoBreakdownElement],
  ['varendo-investigation', VarendoInvestigationElement],
  ['varendo-search-results', VarendoSearchResultsElement],
  ['varendo-record-editor', VarendoRecordEditorElement],
  ['varendo-form-flow', VarendoFormFlowElement],
  ['varendo-quality-panel', VarendoQualityPanelElement],
] as const;
/** Explicitly register the compound family; importing the pure entry has no global side effect. */
export function defineCompoundElements(registry?: CustomElementRegistry): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Varendo compound elements require a CustomElementRegistry.');
  for (const [name, constructor] of VARENDO_COMPOUND_ELEMENTS) {
    const current = target.get(name);
    if (current === undefined) target.define(name, constructor);
    else if (current !== constructor && (current as typeof constructor).varendoVersion !== COMPOUND_VERSION)
      throw new Error(`Cannot register ${name}: an incompatible custom element is already defined.`);
  }
}
