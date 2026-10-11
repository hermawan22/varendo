import { AELIQO_WEB_VERSION } from './version.js';

type AeliqoElementConstructor = CustomElementConstructor & { readonly aeliqoVersion?: string };

export interface ElementRegistration {
  readonly name: string;
  readonly constructor: AeliqoElementConstructor;
}

export function registerElements(
  registrations: readonly ElementRegistration[],
  registry?: CustomElementRegistry,
): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Varendo web elements require a CustomElementRegistry.');
  for (const registration of registrations) {
    const current = target.get(registration.name) as AeliqoElementConstructor | undefined;
    if (current === undefined) {
      target.define(registration.name, registration.constructor);
      continue;
    }
    if (current !== registration.constructor && current.aeliqoVersion !== AELIQO_WEB_VERSION)
      throw new Error(`Cannot register ${registration.name}: an incompatible custom element is already defined.`);
  }
}
