import { createServer } from 'node:net';

/** Pick an OS-assigned local test port; child workers inherit the same choice. */
export async function testPort(key) {
  const configured = process.env[key];
  if (configured !== undefined) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid test port in ${key}`);
    return port;
  }
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No TCP test port assigned');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  process.env[key] = String(port);
  return port;
}
