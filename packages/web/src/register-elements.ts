import { VARENDO_WEB_VERSION } from './version.js';

type VarendoElementConstructor = CustomElementConstructor & { readonly varendoVersion?: string };

export interface ElementRegistration {
  readonly name: string;
  readonly constructor: VarendoElementConstructor;
}

export function registerElements(
  registrations: readonly ElementRegistration[],
  registry?: CustomElementRegistry,
): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Varendo web elements require a CustomElementRegistry.');
  for (const registration of registrations) {
    const current = target.get(registration.name) as VarendoElementConstructor | undefined;
    if (current === undefined) {
      target.define(registration.name, registration.constructor);
      continue;
    }
    if (current !== registration.constructor && current.varendoVersion !== VARENDO_WEB_VERSION)
      throw new Error(`Cannot register ${registration.name}: an incompatible custom element is already defined.`);
  }
}
