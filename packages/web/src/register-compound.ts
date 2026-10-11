import { AELIQO_COMPOUND_ELEMENTS } from './compound/index.js';
import type { ElementRegistration } from './register-elements.js';

export const registrations: readonly ElementRegistration[] = [
  ...AELIQO_COMPOUND_ELEMENTS.map(([name, constructor]) => ({ name, constructor })),
];
