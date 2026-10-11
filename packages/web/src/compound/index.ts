export {
  AeliqoExplorerElement,
  AeliqoComparisonElement,
  AeliqoBreakdownElement,
  AeliqoInvestigationElement,
  AeliqoSearchResultsElement,
  AeliqoRecordEditorElement,
  AeliqoFormFlowElement,
  AeliqoQualityPanelElement,
} from './elements.js';
export { COMPOUND_VERSION, AeliqoCompoundElement, compoundStyles, aeliqoCompoundThemeStyles } from './base.js';
export {
  AELIQO_COMPOUND_REFS,
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
  AeliqoBreakdownElement,
  AeliqoComparisonElement,
  AeliqoExplorerElement,
  AeliqoFormFlowElement,
  AeliqoInvestigationElement,
  AeliqoQualityPanelElement,
  AeliqoRecordEditorElement,
  AeliqoSearchResultsElement,
} from './elements.js';
export const AELIQO_COMPOUND_ELEMENTS = [
  ['aeliqo-explorer', AeliqoExplorerElement],
  ['aeliqo-comparison', AeliqoComparisonElement],
  ['aeliqo-breakdown', AeliqoBreakdownElement],
  ['aeliqo-investigation', AeliqoInvestigationElement],
  ['aeliqo-search-results', AeliqoSearchResultsElement],
  ['aeliqo-record-editor', AeliqoRecordEditorElement],
  ['aeliqo-form-flow', AeliqoFormFlowElement],
  ['aeliqo-quality-panel', AeliqoQualityPanelElement],
] as const;
/** Explicitly register the compound family; importing the pure entry has no global side effect. */
export function defineCompoundElements(registry?: CustomElementRegistry): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Varendo compound elements require a CustomElementRegistry.');
  for (const [name, constructor] of AELIQO_COMPOUND_ELEMENTS) {
    const current = target.get(name);
    if (current === undefined) target.define(name, constructor);
    else if (current !== constructor && (current as typeof constructor).aeliqoVersion !== COMPOUND_VERSION)
      throw new Error(`Cannot register ${name}: an incompatible custom element is already defined.`);
  }
}
