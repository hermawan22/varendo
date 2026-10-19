import { defineConfig } from 'vite';
import { resolve, dirname, relative } from 'node:path';
import { readFile, copyFile } from 'node:fs/promises';
import { generatePages, generatedRoot, generatedPublic } from './generate-pages.mjs';
import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
const root = dirname(new URL(import.meta.url).pathname);

function localAnchor(destination, routes) {
  const url = new URL(destination);
  const path = url.pathname;
  const localPath = path.replace(/^\/varendo/u, '') || '/';
  if (
    !routes.has(localPath) &&
    !routes.has(localPath + '/') &&
    !routes.has(`/docs${localPath}`) &&
    !routes.has(`/docs${localPath}/`)
  )
    return destination;
  return `${localPath}${url.search}${url.hash}`;
}

function installStaticRoutes(server, routes) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const docsPath = `/docs${path}`;
    if (
      path !== '/' &&
      !routes.has(path) &&
      !routes.has(path + '/') &&
      (routes.has(docsPath) || routes.has(docsPath + '/'))
    ) {
      req.url = `${docsPath}${url.search}`;
      next();
      return;
    }
    if (!path.includes('.') && !path.startsWith('/@') && !routes.has(path) && !routes.has(path + '/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        await server.transformIndexHtml('/404/', await readFile(resolve(generatedRoot, '404/index.html'), 'utf8')),
      );
      return;
    }
    next();
  });
}

export default defineConfig(async () => {
  const inputs = await generatePages();
  const routes = new Set(inputs.map((path) => '/' + relative(generatedRoot, path).replace(/index\.html$/, '')));
  let outputDirectory = '';
  const siteBase = process.env.VARENDO_PAGES === '1' ? '/varendo/' : '/';
  return {
    root: generatedRoot,
    base: siteBase,
    publicDir: generatedPublic,
    define: {
      __VARENDO_SITE_BASE__: JSON.stringify(siteBase),
      __VARENDO_RELEASE_VERSION__: JSON.stringify(RELEASE_VERSION),
      __VARENDO_EXPORT_AVAILABLE__: JSON.stringify(process.env.VARENDO_EXPORT_VERIFIED_VERSION === RELEASE_VERSION),
    },
    resolve: {
      dedupe: ['@varendo/agent', '@varendo/core', '@varendo/runtime', '@varendo/web'],
      alias: {
        '/src': resolve(root, 'src'),
        '/docs-src': resolve(root, 'src'),
        '/playground-src': resolve(root, 'src/playground'),
        '@varendo/catalog-examples': resolve(root, '../../examples/catalog/index.ts'),
      },
    },
    plugins: [
      {
        name: 'varendo-local-preview-links',
        apply: 'serve',
        transformIndexHtml(html, context) {
          // The route middleware resolves documentation aliases under /docs/.
          if (context.path.startsWith('/docs/'))
            html = html.replace(
              /(<a\b[^>]*?\s)href=(["'])\/([?#][^"']*)?\2/giu,
              (_match, prefix, quote, suffix = '') => `${prefix}href=${quote}/docs/${suffix}${quote}`,
            );
          return html.replace(
            /(<a\b[^>]*?\s)href=(["'])(https:\/\/hermawan22\.github\.io\/varendo(?:\/[^"']*)?)\2/giu,
            (_match, prefix, quote, destination) => `${prefix}href=${quote}${localAnchor(destination, routes)}${quote}`,
          );
        },
      },
      {
        name: 'varendo-static-routes',
        configResolved(config) {
          outputDirectory = config.build.outDir;
        },
        configureServer(server) {
          installStaticRoutes(server, routes);
        },
        async closeBundle() {
          if (outputDirectory === '') throw Error('Vite output directory was not resolved.');
          await copyFile(resolve(outputDirectory, '404/index.html'), resolve(outputDirectory, '404.html'));
        },
      },
    ],
    build: { outDir: resolve(root, 'dist'), emptyOutDir: true, rollupOptions: { input: inputs } },
    server: { host: '127.0.0.1', fs: { allow: [resolve(root, '../..')] } },
  };
});
