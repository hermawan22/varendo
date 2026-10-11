import '../input/browser.js';
import { AeliqoButtonElement } from '../../packages/web/src/foundation/button.js';
import { AeliqoIconButtonElement } from '../../packages/web/src/foundation/icon-button.js';

customElements.define('aeliqo-button', AeliqoButtonElement);
customElements.define('aeliqo-icon-button', AeliqoIconButtonElement);
const fixture = document.querySelector('#fixture');
fixture?.insertAdjacentHTML(
  'beforeend',
  `
  <aeliqo-button id="button" size="small">Save</aeliqo-button>
  <aeliqo-icon-button id="icon-button" size="small" label="Add"><span slot="icon">+</span></aeliqo-icon-button>
`,
);
