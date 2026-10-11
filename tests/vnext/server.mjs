import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
if (!Number.isSafeInteger(port) || port < 1) throw new Error('A test port is required.');

function requestHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

const root = fileURLToPath(new URL('../../examples/vnext', import.meta.url));
const server = await createServer({
  root,
  // Parallel browser fixtures must not trigger optimizer-discovery page reloads
  // after a test has committed a presentation.
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [
    {
      name: 'vnext-request-scoped-ssr-fixture',
      configureServer(vite) {
        vite.middlewares.use('/vnext/ssr/people', async (request, response, next) => {
          try {
            const module = await vite.ssrLoadModule('/src/ssr.ts');
            const page = await module.renderSsrPeoplePage({
              principal: requestHeader(request.headers, 'x-aeliqo-principal'),
              direction: requestHeader(request.headers, 'x-aeliqo-direction'),
              theme: requestHeader(request.headers, 'x-aeliqo-theme'),
            });
            response.statusCode = 200;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.setHeader('cache-control', 'private, no-store');
            response.end(page);
          } catch (error) {
            vite.ssrFixStacktrace(error);
            next(error);
          }
        });
      },
    },
  ],
});

await server.listen();
console.log(`vNext fixture listening on ${port}`);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
