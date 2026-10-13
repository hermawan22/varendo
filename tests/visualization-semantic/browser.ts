import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { VarendoRegionElement, createVarendoPresentationRegistry } from '../../packages/web/src/region/index.js';
import { registerVarendoElements } from '../../packages/web/src/register.js';
import type { VarendoPresentationRegistryOptions } from '../../packages/web/src/region/registry.js';
import type { VarendoRegionResult, VarendoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext } from '../../packages/core/src/presentation/index.js';
import {
  regionResults,
  temporalRef,
  visualizationContext,
  visualizationPlan,
  visualizationRegistryOptions,
} from './fixtures.mjs';

registerVarendoElements();

function install(element: VarendoRegionElement, readOnly: boolean, events: VarendoSemanticInteractionRequest[]): void {
  const registry = createVarendoPresentationRegistry(
    visualizationRegistryOptions(readOnly) as VarendoPresentationRegistryOptions,
  );
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  const checked = validatePresentationPlan(
    visualizationPlan() as PresentationPlan,
    visualizationContext() as PresentationContext,
    registry.value,
  );
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  element.presentation = checked.value;
  element.results = regionResults() as VarendoRegionResult[];
  element.onSemanticInteraction = (request) => events.push(request);
}

const editable = document.querySelector<VarendoRegionElement>('#editable');
const readOnly = document.querySelector<VarendoRegionElement>('#readonly');
if (editable === null || readOnly === null) throw new Error('Semantic visualization regions are missing.');
const semanticEvents: VarendoSemanticInteractionRequest[] = [];
const readOnlyEvents: VarendoSemanticInteractionRequest[] = [];
install(editable, false, semanticEvents);
install(readOnly, true, readOnlyEvents);

Object.assign(window, {
  varendoVisualizationSemanticReady: true,
  varendoVisualizationSemanticEvents: semanticEvents,
  varendoVisualizationSemanticReadOnlyEvents: readOnlyEvents,
  varendoVisualizationSemanticTemporalRef: temporalRef,
});
