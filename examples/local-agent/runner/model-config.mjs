const MODEL_KEYS = [
  'AELIQO_MODEL_BASE_URL',
  'AELIQO_MODEL',
  'AELIQO_MODEL_PROTOCOL',
  'AELIQO_MODEL_AUTH_SCHEME',
  'AELIQO_MODEL_API_KEY',
  'AELIQO_MODEL_AUTH_HEADER',
  'AELIQO_MODEL_CAPABILITIES',
];
const CAPABILITIES = new Set(['tool-calls', 'usage', 'request-cancellation', 'input-token-estimate', 'request-retry']);

function bounded(value, maximum = 160) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function endpointFor(baseURL, env) {
  let endpoint;
  try {
    endpoint = new URL(baseURL);
  } catch {
    throw new Error('The model endpoint must be an absolute URL.');
  }
  if (endpoint.username || endpoint.password)
    throw new Error('Model endpoint credentials belong in server environment.');
  if (endpoint.search || endpoint.hash) throw new Error('Model endpoint query and fragment are forbidden.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol === 'http:' && (!loopback || env.AELIQO_ALLOW_INSECURE_MODEL_HTTP !== '1'))
    throw new Error('HTTP model endpoints require loopback and an explicit opt-in.');
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
    throw new Error('Model endpoints must use HTTPS, or opted-in loopback HTTP.');
  return endpoint;
}

function authFor(env, endpoint) {
  const scheme = env.AELIQO_MODEL_AUTH_SCHEME;
  const secret = env.AELIQO_MODEL_API_KEY;
  const headerName = env.AELIQO_MODEL_AUTH_HEADER;
  if (!['none', 'bearer', 'header'].includes(scheme))
    throw new Error('An explicit model authentication scheme is required.');
  if (scheme === 'none') {
    if (secret || headerName) throw new Error('No-auth model connections cannot include a credential or header.');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
      throw new Error('No-auth model connections require a local endpoint.');
    return { scheme: 'none' };
  }
  if (!bounded(secret, 4096)) throw new Error('The model credential must be configured in the server environment.');
  if (scheme === 'bearer') {
    if (headerName) throw new Error('Bearer auth cannot specify a custom header.');
    return { scheme, secret };
  }
  if (!bounded(headerName, 128) || !/^[A-Za-z0-9-]+$/u.test(headerName))
    throw new Error('Header auth requires a safe explicit header name.');
  return { scheme, headerName, secret };
}

function capabilitiesFor(value) {
  if (!bounded(value, 256)) throw new Error('Explicit model capabilities are required.');
  const capabilities = value.split(',').map((item) => item.trim());
  if (
    !capabilities.includes('tool-calls') ||
    new Set(capabilities).size !== capabilities.length ||
    !capabilities.every((item) => CAPABILITIES.has(item))
  )
    throw new Error('Model capabilities must be unique supported values including tool-calls.');
  return capabilities;
}

/** Read one trusted local model profile before opening the runner listener. */
export function readModelConfiguration(env) {
  if (!MODEL_KEYS.some((key) => env[key] !== undefined && env[key] !== '')) return undefined;
  const baseURL = env.AELIQO_MODEL_BASE_URL;
  const model = env.AELIQO_MODEL;
  if (!bounded(baseURL, 2048) || !bounded(model))
    throw new Error(
      'Model endpoint and model must be configured together with protocol, authentication and capabilities.',
    );
  if (!['openai-compatible-chat', 'openai-compatible-responses'].includes(env.AELIQO_MODEL_PROTOCOL))
    throw new Error('An explicit supported model protocol is required.');
  const endpoint = endpointFor(baseURL, env);
  const auth = authFor(env, endpoint);
  const capabilities = capabilitiesFor(env.AELIQO_MODEL_CAPABILITIES);
  if (
    env.AELIQO_MODEL_PROTOCOL === 'openai-compatible-responses' &&
    (endpoint.protocol !== 'https:' || auth.scheme !== 'bearer')
  )
    throw new Error('The Responses profile requires HTTPS and bearer authentication.');
  if (env.AELIQO_MODEL_PROTOCOL === 'openai-compatible-responses' && capabilities.includes('request-retry'))
    throw new Error('The Responses profile does not support request-retry capability.');
  return {
    endpoint,
    model,
    protocol: env.AELIQO_MODEL_PROTOCOL,
    auth,
    capabilities,
    public: {
      protocol: env.AELIQO_MODEL_PROTOCOL,
      model,
      endpointOrigin: endpoint.origin,
      authScheme: auth.scheme,
      capabilities,
    },
  };
}
