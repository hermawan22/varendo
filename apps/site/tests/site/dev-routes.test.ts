import { afterAll, expect, test } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer | undefined;
afterAll(async () => server?.close());

test('the dev server maps canonical documentation routes without a host rewrite', async () => {
  server = await createServer({
    configFile: resolve('vite.config.mjs'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === undefined || address === null || typeof address === 'string') throw new Error('No dev server');
  const response = await fetch(`http://127.0.0.1:${address.port}/start/`);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(
    '<title>Quickstart: one dataset, four questions, four views — Varendo</title>',
  );
}, 30_000);
