import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const port = process.env.AELIQO_VISUAL_PORT;
if (port === undefined || !/^[0-9]+$/u.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw Error('AELIQO_VISUAL_PORT must identify the isolated visual fixture server');

// Serve the same catalog entry as a production bundle, without a development
// module graph on every navigation. Concurrent servers own separate outputs.
export default defineConfig({
  root,
  base: '/',
  publicDir: false,
  build: {
    outDir: resolve(root, 'artifacts/visual-fixture', port),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(root, 'tests/visual/index.html') },
  },
  preview: { host: '127.0.0.1' },
});
