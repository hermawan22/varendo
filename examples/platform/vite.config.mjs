import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // This entry is injected only after server-rendered markup is inspected.
    // Pre-bundle its unique dependency so Vite cannot invalidate the request
    // while the browser is loading the hydration module graph.
    include: ['@lit-labs/ssr-client/lit-element-hydrate-support.js'],
  },
});
