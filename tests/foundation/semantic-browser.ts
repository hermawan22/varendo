import { registerVarendoElements } from '../../packages/web/src/register.js';
import { VarendoRegionElement } from '../../packages/web/src/region/varendo-region.js';
import type { VarendoSemanticInteractionRequest } from '../../packages/web/src/region/types.js';
import { validatedFixture } from './semantic-fixture.js';

registerVarendoElements();
const region = document.querySelector<VarendoRegionElement>('#semantic')!;
const requests: VarendoSemanticInteractionRequest[] = [];
let submits = 0;
document.querySelector('#semantic-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  submits++;
});
region.onSemanticInteraction = (request) => requests.push(request);
region.presentation = validatedFixture();
await region.updateComplete;
const layout = document.createElement('style');
layout.textContent = 'varendo-split-pane{block-size:160px}varendo-scroll-area{block-size:100px}';
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
