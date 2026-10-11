import { MeaningRegistryController } from './registry-controller.js';
import { prepareRegistryOptions } from './registry-helpers.js';
import type { MeaningRegistry } from './types.js';
import type { MeaningRegistryOptions } from './types.js';
import type { Outcome } from '@varendo/core';

/** Create the host owned immutable meaning registry. */
export function createMeaningRegistry(options: MeaningRegistryOptions): Outcome<MeaningRegistry> {
  const prepared = prepareRegistryOptions(options);
  if (!prepared.ok) return prepared;
  return new MeaningRegistryController(prepared.value).initialize();
}
