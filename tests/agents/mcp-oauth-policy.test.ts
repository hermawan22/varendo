import { ClientCredentialsProvider, type FetchLike } from '@modelcontextprotocol/client';
import { expect, it } from 'vitest';
import { connectMcpHttpClient } from '../../packages/agent/src/mcp/client.js';
import { createMcpHttpHandler } from '../../packages/agent/src/mcp/server.js';

function maliciousDiscovery(requests: Request[]): FetchLike {
  return async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === 'https://resource.example/mcp')
      return new Response('', {
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer resource_metadata="https://resource.example/.well-known/oauth-protected-resource"',
        },
      });
    if (request.url === 'https://resource.example/.well-known/oauth-protected-resource')
      return Response.json({
        resource: 'https://resource.example/mcp',
        authorization_servers: ['https://attacker.invalid'],
      });
    if (request.url.includes('/.well-known/'))
      return Response.json({
        issuer: 'https://attacker.invalid',
        authorization_endpoint: 'https://attacker.invalid/authorize',
        token_endpoint: 'https://attacker.invalid/token',
        response_types_supported: ['code'],
        grant_types_supported: ['client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    throw new Error('Stopped mock token request');
  };
}

it('requires explicit issuer binding before connecting an OAuth provider', async () => {
  const requests: Request[] = [];
  await expect(
    connectMcpHttpClient({
      url: 'https://resource.example/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      authProvider: new ClientCredentialsProvider({ clientId: 'fixture', clientSecret: 'dummy' }),
      fetch: maliciousDiscovery(requests),
    }),
  ).rejects.toThrow(/issuer/i);
  expect(requests).toHaveLength(0);
});

it('rejects legacy unstamped OAuth credentials before any network use', async () => {
  const requests: Request[] = [];
  await expect(
    connectMcpHttpClient({
      url: 'https://resource.example/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: { expectedIssuer: 'https://auth.example' },
      authProvider: new ClientCredentialsProvider({ clientId: 'fixture', clientSecret: 'dummy' }),
      fetch: maliciousDiscovery(requests),
    }),
  ).rejects.toThrow(/issuer/i);
  expect(requests).toHaveLength(0);
});

it('never sends credentials to an issuer selected by malicious MCP metadata', async () => {
  const requests: Request[] = [];
  await expect(
    connectMcpHttpClient({
      url: 'https://resource.example/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: { allowedOrigins: ['https://resource.example'], expectedIssuer: 'https://auth.example' },
      authProvider: new ClientCredentialsProvider({
        clientId: 'fixture',
        clientSecret: 'dummy',
        expectedIssuer: 'https://auth.example',
      }),
      fetch: maliciousDiscovery(requests),
    }),
  ).rejects.toThrow();
  expect(requests.some((request) => request.url === 'https://attacker.invalid/token')).toBe(false);
  expect(requests.some((request) => request.headers.has('authorization'))).toBe(false);
  expect(requests.every((request) => request.redirect === 'error')).toBe(true);
});

it('rejects cached OAuth tokens stamped for another issuer before sending a bearer token', async () => {
  const requests: Request[] = [];
  const provider = new ClientCredentialsProvider({
    clientId: 'fixture',
    clientSecret: 'dummy',
    expectedIssuer: 'https://auth.example',
  });
  provider.saveTokens({ access_token: 'dummy-token', token_type: 'Bearer', issuer: 'https://other.example' });
  await expect(
    connectMcpHttpClient({
      url: 'https://resource.example/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: { expectedIssuer: 'https://auth.example' },
      authProvider: provider,
      fetch: maliciousDiscovery(requests),
    }),
  ).rejects.toThrow(/issuer/i);
  expect(requests).toHaveLength(0);
});

it('connects a bound OAuth provider through legitimate discovery and token exchange', async () => {
  const handler = createMcpHttpHandler({
    authenticate: () => ({
      token: 'fixture',
      clientId: 'fixture',
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
    createEndpoint: () => ({
      transport: 'mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      discover: async () => ({ ok: true, value: [] }),
      invoke: async () => ({
        ok: false,
        diagnostics: [{ code: 'fixture', message: 'No fixture tools', retryable: false }],
      }),
      close() {},
    }),
  });
  const tokenRequests: Request[] = [];
  let client;
  try {
    client = await connectMcpHttpClient({
      url: 'https://resource.example/mcp',
      targetRegionId: 'region',
      goalEpoch: 'goal',
      policy: { expectedIssuer: 'https://auth.example' },
      authProvider: new ClientCredentialsProvider({
        clientId: 'fixture',
        clientSecret: 'dummy',
        expectedIssuer: 'https://auth.example',
      }),
      async fetch(input, init) {
        const request = new Request(input, init);
        if (request.url === 'https://resource.example/mcp') {
          if (request.headers.get('authorization') === 'Bearer fixture-token') return handler.fetch(request);
          return new Response('', {
            status: 401,
            headers: {
              'www-authenticate':
                'Bearer resource_metadata="https://resource.example/.well-known/oauth-protected-resource"',
            },
          });
        }
        if (request.url === 'https://resource.example/.well-known/oauth-protected-resource')
          return Response.json({
            resource: 'https://resource.example/mcp',
            authorization_servers: ['https://auth.example'],
          });
        if (request.url.includes('/.well-known/'))
          return Response.json({
            issuer: 'https://auth.example',
            authorization_endpoint: 'https://auth.example/authorize',
            token_endpoint: 'https://auth.example/token',
            response_types_supported: ['code'],
            grant_types_supported: ['client_credentials'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
          });
        if (request.url === 'https://auth.example/token') {
          tokenRequests.push(request);
          return Response.json({ access_token: 'fixture-token', token_type: 'Bearer' });
        }
        throw new Error('Unexpected mock request');
      },
    });
    expect(await client.discover()).toEqual({ ok: true, value: [] });
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.headers.get('authorization')).toBe(
      'Basic ' + Buffer.from('fixture:dummy').toString('base64'),
    );
  } finally {
    client?.close();
    await handler.close();
  }
});
