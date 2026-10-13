import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { VarendoRegionElement, createVarendoPresentationRegistry } from '../../packages/web/src/region/index.js';
import { registerVarendoElements } from '../../packages/web/src/register.js';
import type {
  VarendoRegionDataRequest,
  VarendoRegionResult,
  VarendoSemanticInteractionRequest,
} from '../../packages/web/src/region/types.js';
import { binding, dataPresentationContext, dataPresentationPlan, registryOptions, resultRef, rows } from './fixture.js';

registerVarendoElements();

const registry = createVarendoPresentationRegistry(registryOptions);
if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
const checked = validatePresentationPlan(dataPresentationPlan(), dataPresentationContext(), registry.value);
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));

const region = document.querySelector<VarendoRegionElement>('#region');
if (region === null) throw new Error('Data semantic region fixture is missing.');

const semanticEvents: VarendoSemanticInteractionRequest[] = [];
const dataRequests: VarendoRegionDataRequest[] = [];
region.onSemanticInteraction = (request) => semanticEvents.push(request);
region.onDataRequest = (request) => dataRequests.push(request);
region.presentation = checked.value;
const result: VarendoRegionResult = { ref: resultRef, rows: binding.rows as unknown as VarendoRegionResult['rows'] };
region.results = [result];

Object.assign(window, {
  varendoDataSemanticReady: true,
  varendoDataSemanticEvents: semanticEvents,
  varendoDataSemanticRequests: dataRequests,
  varendoDataSemanticResult: result,
  varendoDataSemanticRows: rows,
});
