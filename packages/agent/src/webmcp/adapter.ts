import type { Outcome } from '@varendo/core';
import { createWebMcpAdapter } from './adapter-core.js';
import { detectWebMcp } from './detection.js';
import type { WebMcpAdapter, WebMcpAdapterOptions, WebMcpRegisterOptions, WebMcpRegistration } from './types.js';

export { createWebMcpAdapter, detectWebMcp };

/** Register a host endpoint in one call while retaining the adapter for disposal. */
export async function registerWebMcpTools(
  options: WebMcpAdapterOptions & WebMcpRegisterOptions,
): Promise<Outcome<{ readonly adapter: WebMcpAdapter; readonly registrations: readonly WebMcpRegistration[] }>> {
  const adapter = createWebMcpAdapter(options);
  const result = await adapter.register(options);
  if (!result.ok) {
    adapter.close();
    return result;
  }
  return { ok: true, value: Object.freeze({ adapter, registrations: result.value }) };
}
