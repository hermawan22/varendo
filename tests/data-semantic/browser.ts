import { createPresentationRegistry, validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { AeliqoRegionElement, createAeliqoPresentationRegistry } from '../../packages/web/src/region/index.js';
import { registerAeliqoElements } from '../../packages/web/src/register.js';
import type {
  AeliqoRegionDataRequest,
  AeliqoRegionResult,
  AeliqoSemanticInteractionRequest,
} from '../../packages/web/src/region/types.js';
import { binding, dataPresentationContext, dataPresentationPlan, registryOptions, resultRef, rows } from './fixture.js';

registerAeliqoElements();

const registry = createAeliqoPresentationRegistry(registryOptions);
if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
const checked = validatePresentationPlan(dataPresentationPlan(), dataPresentationContext(), registry.value);
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));

const region = document.querySelector<AeliqoRegionElement>('#region');
if (region === null) throw new Error('Data semantic region fixture is missing.');

const semanticEvents: AeliqoSemanticInteractionRequest[] = [];
const dataRequests: AeliqoRegionDataRequest[] = [];
region.onSemanticInteraction = (request) => semanticEvents.push(request);
region.onDataRequest = (request) => dataRequests.push(request);
region.presentation = checked.value;
const result: AeliqoRegionResult = { ref: resultRef, rows: binding.rows as unknown as AeliqoRegionResult['rows'] };
region.results = [result];

Object.assign(window, {
  aeliqoDataSemanticReady: true,
  aeliqoDataSemanticEvents: semanticEvents,
  aeliqoDataSemanticRequests: dataRequests,
  aeliqoDataSemanticResult: result,
  aeliqoDataSemanticRows: rows,
});
