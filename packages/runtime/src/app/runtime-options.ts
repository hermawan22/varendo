import type { VarendoRuntimeOptions, RuntimeResourceBinding } from './types.js';

export function validateOptions(options: VarendoRuntimeOptions): void {
  if (
    options === null ||
    typeof options !== 'object' ||
    options.authority === null ||
    typeof options.authority?.read !== 'function'
  )
    throw new TypeError('createVarendoRuntime requires one trusted authority adapter.');
  if (!Array.isArray(options.resources) || options.resources.length === 0)
    throw new TypeError('createVarendoRuntime requires at least one resource binding.');
}

export function indexResources(resources: VarendoRuntimeOptions['resources']): Map<string, RuntimeResourceBinding> {
  const indexed = new Map<string, RuntimeResourceBinding>();
  for (const binding of resources) {
    if (indexed.has(binding.resource.id))
      throw new TypeError(`Resource ${binding.resource.id} is bound more than once.`);
    indexed.set(binding.resource.id, binding);
  }
  return indexed;
}
