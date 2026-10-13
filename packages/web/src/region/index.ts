export { VarendoRegionElement } from './varendo-region.js';
export {
  VARENDO_CONFIG_SCHEMAS,
  VARENDO_OPERATION_REFS,
  VARENDO_PRESENTATION_REFS,
  createVarendoPresentationRegistry,
  createSelectionIdentityMapping,
} from './registry.js';
export { VARENDO_PRESENTATION_MANIFESTS } from './default-manifests.js';
export type {
  VarendoRegionResult,
  VarendoRegionSnapshot,
  VarendoSemanticInteractionHandler,
  VarendoSemanticInteractionRequest,
  VarendoViewDefinition,
  VarendoViewRenderContext,
} from './types.js';
export type { VarendoPresentationRegistryOptions } from './registry.js';
export { createFoundationPresentationManifests } from './foundation-registry.js';
export type { VarendoFoundationBindings } from './foundation-registry.js';

export { createInputPresentationManifests } from './input-registry.js';
export type {
  VarendoInputBindings,
  VarendoInputBinding,
  VarendoInputDraftBinding,
  VarendoInputActionBinding,
  VarendoInputFileBinding,
} from './input-registry.js';

export {
  createNavigationFeedbackPresentationManifests,
  VARENDO_NAVIGATION_FEEDBACK_REFS,
  VARENDO_NAVIGATION_FEEDBACK_CONFIG_SCHEMAS,
} from './navigation-feedback-registry.js';
export type { VarendoNavigationFeedbackBindings } from './navigation-feedback-registry.js';

export { createVarendoDataPresentationManifests } from './data-presentation.js';
export type { VarendoAuthorizedDataBindings } from './data-presentation.js';
export type { VarendoDataBinding } from './data-registry.js';
export type { VarendoRegionDataRequest, VarendoRegionDataRequestHandler } from './types.js';

export {
  createVarendoVisualizationPresentationManifests,
  createVarendoVisualizationPresentationRegistry,
  VARENDO_VISUALIZATION_REFS,
  VARENDO_VISUALIZATION_CONFIG_SCHEMAS,
  VARENDO_VISUALIZATION_PRESENTATION_OPERATIONS,
} from './visualization-registry.js';
export type {
  VarendoVisualizationBinding,
  VarendoAuthorizedVisualizationBindings,
  VarendoVisualizationRegistryOptions,
} from './visualization-registry.js';
