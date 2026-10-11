import { createMcpStdioServer } from '../../packages/agent/dist/mcp/index.js';

const endpoint = () => ({
  transport: 'mcp',
  targetRegionId: 'region',
  goalEpoch: 'goal',
  async discover() {
    return {
      ok: true,
      value: [
        {
          name: 'summary',
          description: 'Return a bounded summary.',
          capability: { id: 'summary', revision: '1' },
          operation: 'catalog.read',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
        },
      ],
    };
  },
  async invoke(name, input, options) {
    return {
      ok: true,
      value: {
        version: '1',
        requestId: options.requestId,
        targetRegionId: 'region',
        goalEpoch: 'goal',
        capability: { id: 'summary', revision: '1' },
        operation: 'catalog.read',
        transport: 'mcp',
        state: 'data-ready',
        status: 'data-ready',
        stage: 'data-ready',
        value: { name, query: input?.query ?? null },
        diagnostics: [],
      },
    };
  },
  close() {},
});

createMcpStdioServer({
  createEndpoint: () => endpoint(),
  name: 'aeliqo-stdio-fixture',
  version: '0.0.0-test',
  maxBufferSize:
    process.env.AELIQO_MCP_MAX_BUFFER === undefined ? undefined : Number(process.env.AELIQO_MCP_MAX_BUFFER),
});
