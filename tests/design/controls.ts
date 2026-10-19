import '../input/browser.js';
import { VarendoButtonElement } from '../../packages/web/src/foundation/button.js';
import { VarendoIconButtonElement } from '../../packages/web/src/foundation/icon-button.js';

customElements.define('varendo-button', VarendoButtonElement);
customElements.define('varendo-icon-button', VarendoIconButtonElement);
const fixture = document.querySelector('#fixture');
fixture?.insertAdjacentHTML(
  'beforeend',
  `
  <varendo-button id="button" size="small">Save</varendo-button>
  <varendo-icon-button id="icon-button" size="small" label="Add"><span slot="icon">+</span></varendo-icon-button>
`,
);
