import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const forbiddenModulePattern =
  /(?:^|\/)(?:runtime|planner|agent|studio|model|presentation|query)(?:\/|$|\.[cm]?[jt]s$)|@varendo\/(?:runtime|agent|studio)(?:\/|$)/iu;

function normalizeModuleId(id) {
  return id.replaceAll('\\', '/').replace(/^\0/u, '');
}

function retainedModuleGraphPlugin() {
  return {
    name: 'varendo-perceived-input-retained-module-graph',
    generateBundle(_options, bundle) {
      const retainedModules = new Set();
      const entryModules = new Set();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) retainedModules.add(normalizeModuleId(id));
        if (output.isEntry && output.facadeModuleId !== null)
          entryModules.add(normalizeModuleId(output.facadeModuleId));
      }
      const retained = [...retainedModules].sort();
      const entries = [...entryModules].sort();
      const forbidden = retained.filter((id) => forbiddenModulePattern.test(id));
      const graph = {
        schema: 'varendo.performance.perceived-input.retained-modules.v1',
        entryModules: entries,
        retainedModules: retained,
        forbiddenModules: forbidden,
      };
      if (entries.length !== 1 || !entries[0]?.includes('perceived-input.html')) {
        throw new Error(`Perceived input build must have exactly one direct HTML entry; got ${entries.join(', ')}`);
      }
      if (forbidden.length > 0)
        throw new Error(`Perceived input build retains forbidden modules: ${forbidden.join(', ')}`);
      this.emitFile({
        type: 'asset',
        fileName: 'retained-modules.json',
        source: `${JSON.stringify(graph, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  root: repositoryRoot,
  base: '/',
  build: {
    outDir: resolve(repositoryRoot, 'artifacts/performance-perceived-input-dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(repositoryRoot, 'tests/performance/perceived-input.html') },
  },
  plugins: [retainedModuleGraphPlugin()],
  preview: { host: '127.0.0.1' },
});
