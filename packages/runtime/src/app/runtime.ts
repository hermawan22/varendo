import type { VarendoRuntime, VarendoRuntimeOptions } from './types.js';
import { RuntimeController } from './runtime-controller.js';

export function createVarendoRuntime(options: VarendoRuntimeOptions): VarendoRuntime {
  return new RuntimeController(options).create();
}
