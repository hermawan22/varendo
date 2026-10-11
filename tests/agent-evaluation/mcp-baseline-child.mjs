import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createMcpStdioServer } from '../../packages/agent/dist/mcp/index.js';

// The child receives application fixture data only, never prompts or answer oracles.
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const root = resolve(import.meta.dirname, '../..');
const loader = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});
const { createEvaluationHost } = await loader.ssrLoadModule('/tests/agent-evaluation/host.ts');
const stdio = createMcpStdioServer({
  name: 'aeliqo-evaluation-baseline',
  version: '0.0.0-test',
  createEndpoint() {
    const host = createEvaluationHost(fixture, 'mcp');
    return {
      ...host.endpoint,
      close() {
        host.dispose();
      },
    };
  },
});

let closing;
const shutdown = () =>
  (closing ??= (async () => {
    const results = await Promise.allSettled([stdio.close(), loader.close()]);
    if (results.some((result) => result.status === 'rejected')) process.exitCode = 1;
  })());
process.stdin.once('end', () => {
  void shutdown();
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(process.exitCode ?? 0));
  });
