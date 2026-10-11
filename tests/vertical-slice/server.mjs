import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
if (!Number.isSafeInteger(port) || port < 1) throw new Error('A test port is required.');
const server = await createServer({
  root: fileURLToPath(new URL('../../examples/vertical-slice', import.meta.url)),
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [
    {
      name: 'hr-ssr-fixture',
      configureServer(vite) {
        vite.middlewares.use('/ssr', async (_request, response, next) => {
          try {
            const module = await vite.ssrLoadModule('/src/ssr.ts');
            const page = await module.renderHrPage();
            response.statusCode = 200;
            response.setHeader('content-type', 'text/html');
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
console.log(`HR integration fixture listening on ${port}`);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
