import { randomUUID } from 'node:crypto';
import { createMcpStdioServer } from '@varendo/agent/mcp';
import manifest from '../package.json' with { type: 'json' };

const baseURL = process.env.VARENDO_LOCAL_URL;
const token = process.env.VARENDO_MCP_TOKEN;
if (baseURL === undefined || token === undefined)
  throw new Error('VARENDO_LOCAL_URL and VARENDO_MCP_TOKEN are required.');
const origin = new URL(baseURL);
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname))
  throw new Error('The stdio bridge only connects to a loopback local runner.');

async function bridge(body, signal) {
  const response = await fetch(new URL('/api/varendo/bridge', origin), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'playground.stdio-bridge',
          message: `The local runner rejected the bridge (${response.status}).`,
          retryable: false,
        },
      ],
    };
  return response.json();
}

createMcpStdioServer({
  name: 'varendo-local-agent',
  version: manifest.version,
  createEndpoint() {
    return {
      transport: 'mcp',
      targetRegionId: 'people-main',
      goalEpoch: 'local-agent',
      discover: (options = {}) => bridge({ operation: 'discover' }, options.signal),
      invoke: (name, input, options) =>
        bridge({ operation: 'invoke', name, input, requestId: options.requestId ?? randomUUID() }, options.signal),
      close() {},
    };
  },
});
