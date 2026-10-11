import { registerAeliqoElements } from '../../packages/web/src/register.js';
import { AeliqoRegionElement } from '../../packages/web/src/region/aeliqo-region.js';
import type { AeliqoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
import { validatedFixture } from './semantic-fixture.js';

registerAeliqoElements();
const region = document.querySelector<AeliqoRegionElement>('#semantic')!;
const requests: AeliqoSemanticInteractionRequest[] = [];
let submits = 0;
document.querySelector('#semantic-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  submits++;
});
region.onSemanticInteraction = (request) => requests.push(request);
region.presentation = validatedFixture();
await region.updateComplete;
const layout = document.createElement('style');
layout.textContent = 'aeliqo-split-pane{block-size:160px}aeliqo-scroll-area{block-size:100px}';
region.shadowRoot!.append(layout);
Object.assign(window, {
  foundationSemantic: {
    region,
    requests,
    stats: () => ({ submits }),
    rerender: () => {
      region.presentation = validatedFixture();
    },
  },
});
