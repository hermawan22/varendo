import type { OAuthClientProvider, OAuthClientInformationContext } from '@modelcontextprotocol/client';
import type { McpHttpClientOptions } from './types.js';

type Credential = { readonly issuer?: string | undefined };

function issuerIdentity(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function checkedIssuer(options: McpHttpClientOptions): string {
  const value = options.policy?.expectedIssuer;
  if (typeof value !== 'string') throw new TypeError('An OAuth MCP client requires an explicit expected issuer.');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const insecure = url.protocol === 'http:' && loopback && options.policy?.allowInsecureLoopback === true;
  if ((!insecure && url.protocol !== 'https:') || url.username || url.password || url.hash || url.search)
    throw new TypeError('The expected OAuth issuer must be a secure URL without credentials, query, or fragment.');
  return value;
}

function checkContext(issuer: string, context?: OAuthClientInformationContext): void {
  if (context !== undefined && issuerIdentity(context.issuer) !== issuerIdentity(issuer))
    throw new TypeError('MCP discovery selected an unexpected OAuth issuer.');
}

function checkedCredential<T extends Credential>(issuer: string, credential: T | undefined): T | undefined {
  if (
    credential !== undefined &&
    (typeof credential.issuer !== 'string' || issuerIdentity(credential.issuer) !== issuerIdentity(issuer))
  )
    throw new TypeError(
      'Stored OAuth credentials require the configured issuer stamp. Clear or migrate legacy credentials.',
    );
  return credential;
}

function oauthProvider(provider: McpHttpClientOptions['authProvider']): provider is OAuthClientProvider {
  return provider !== undefined && 'tokens' in provider && 'clientInformation' in provider;
}

function bindProvider(provider: OAuthClientProvider, issuer: string): OAuthClientProvider {
  const reads = {
    async clientInformation(context?: OAuthClientInformationContext) {
      checkContext(issuer, context);
      return checkedCredential(issuer, await provider.clientInformation(context));
    },
    async tokens(context?: OAuthClientInformationContext) {
      checkContext(issuer, context);
      return checkedCredential(issuer, await provider.tokens(context));
    },
  };
  return new Proxy(provider, {
    get(target, key) {
      if (key === 'clientInformation') return reads.clientInformation;
      if (key === 'tokens') return reads.tokens;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Host configuration pins OAuth credentials before the transport can discover an authorization server. */
export async function boundMcpAuthProvider(
  options: McpHttpClientOptions,
): Promise<McpHttpClientOptions['authProvider']> {
  if (options.transportOptions?.skipIssuerMetadataValidation === true)
    throw new TypeError('MCP OAuth issuer metadata validation cannot be disabled.');
  const provider = options.authProvider;
  if (!oauthProvider(provider)) return provider;
  const issuer = checkedIssuer(options);
  const bound = bindProvider(provider, issuer);
  const context = { issuer };
  await Promise.all([bound.clientInformation(context), bound.tokens(context)]);
  return bound;
}
