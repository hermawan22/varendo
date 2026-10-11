import { registerElements } from './register-elements.js';
import { registerBaseElements } from './register-base.js';
import { registrations as compound } from './register-compound.js';
import { registrations as hierarchy } from './register-hierarchy.js';
import { registrations as cartesian } from './register-cartesian.js';
import { registrations as temporal } from './register-temporal.js';
import { registrations as data } from './register-data.js';
import { registrations as feedback } from './register-feedback.js';
import { registrations as navigation } from './register-navigation.js';
import { registrations as input } from './register-input.js';
import { registrations as plot } from './register-plot.js';
import { registrations as foundation } from './register-foundation.js';

export { AELIQO_WEB_VERSION } from './version.js';

/** Register the shared elements exactly once in the supplied browser registry. */
export function registerAeliqoElements(registry?: CustomElementRegistry): void {
  registerElements(compound, registry);
  registerElements(hierarchy, registry);
  registerElements(cartesian, registry);
  registerElements(temporal, registry);
  registerElements(data, registry);
  registerElements(feedback, registry);
  registerElements(navigation, registry);
  registerElements(input, registry);
  registerElements(plot, registry);
  registerElements(foundation, registry);
  registerBaseElements(registry);
}
