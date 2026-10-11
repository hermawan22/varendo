import { registerBaseElements } from '../../packages/web/src/register-base.js';

/** Mounted-region port for node tests; production family loaders still define the real constructors. */
export function createRegistrationDocument() {
  const constructors = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => constructors.get(name),
    define(name: string, constructor: CustomElementConstructor) {
      if (constructors.has(name) || [...constructors.values()].includes(constructor))
        throw new Error('The custom element name or constructor is already registered.');
      constructors.set(name, constructor);
    },
  } as unknown as CustomElementRegistry;
  registerBaseElements(registry);
  return { defaultView: { customElements: registry } };
}
