import { createServer } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const server = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { runEvaluation } = await server.ssrLoadModule('/tests/agent-evaluation/runner.ts');
  process.exitCode = await runEvaluation(process.argv.slice(2));
} finally {
  await server.close();
}
