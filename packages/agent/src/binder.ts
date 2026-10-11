import type { AgentBinder, AgentBinderOptions } from './binder-types.js';
import { createBinderOperations, invalidBinderOptions, validBinderOptions } from './binder/operations.js';

export function createAgentBinder(options: AgentBinderOptions): AgentBinder {
  if (!validBinderOptions(options)) throw invalidBinderOptions();
  return createBinderOperations(options);
}
