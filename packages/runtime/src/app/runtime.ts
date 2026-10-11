import type { AeliqoRuntime, AeliqoRuntimeOptions } from './types.js';
import { RuntimeController } from './runtime-controller.js';

export function createAeliqoRuntime(options: AeliqoRuntimeOptions): AeliqoRuntime {
  return new RuntimeController(options).create();
}
