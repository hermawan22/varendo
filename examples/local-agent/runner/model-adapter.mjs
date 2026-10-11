import {
  createOpaqueModelSecret,
  createOpenAICompatibleResponsesToolModel,
  createOpenAICompatibleToolModel,
} from '@varendo/agent/model';

/** Build only the trusted model port selected by the explicit local profile. */
export function createModelAdapter(settings, options = {}) {
  const { endpoint, model: modelName, auth, capabilities } = settings;
  const insecure = endpoint.protocol === 'http:';
  if (settings.protocol === 'openai-compatible-responses') {
    const port = createOpenAICompatibleResponsesToolModel({
      environment: 'trusted-server',
      endpoint: { protocol: 'https', baseUrl: endpoint.href },
      model: modelName,
      credentialReference: 'local-model-key',
      credentialResolver: { resolve: async () => auth.secret },
      requestPolicy: {
        maxRetries: 0,
        timeoutMilliseconds: 30_000,
        maxRequestBytes: 128_000,
        maxResponseBytes: 128_000,
        stream: false,
      },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    return Object.freeze({
      estimateInputTokens: (request) => Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4)),
      complete: port.complete,
    });
  }
  return createOpenAICompatibleToolModel({
    baseURL: endpoint.href,
    model: modelName,
    ...(auth.scheme === 'none'
      ? { auth: { scheme: 'none' } }
      : {
          secret: createOpaqueModelSecret(auth.secret, 'trusted-server'),
          auth: auth.scheme === 'header' ? { scheme: 'header', headerName: auth.headerName } : { scheme: 'bearer' },
        }),
    capabilities,
    policy: {
      allowExternalEgress: true,
      allowedOrigins: [endpoint.origin],
      ...(insecure ? { allowInsecureHttp: true } : {}),
    },
    budget: { maxRequestBytes: 128_000, maxResponseBytes: 128_000 },
    timeoutMs: 30_000,
    retry: { maxAttempts: 1 },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
