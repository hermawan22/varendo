import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readModelConfiguration } from './model-config.mjs';

const complete = {
  AELIQO_MODEL_BASE_URL: 'https://provider.example/v1/',
  AELIQO_MODEL: 'tools-model',
  AELIQO_MODEL_PROTOCOL: 'openai-compatible-chat',
  AELIQO_MODEL_AUTH_SCHEME: 'bearer',
  AELIQO_MODEL_API_KEY: 'server-only-secret',
  AELIQO_MODEL_CAPABILITIES: 'tool-calls,usage,request-cancellation',
};

test('requires an explicit complete server-owned model profile', () => {
  assert.equal(readModelConfiguration({}), undefined);
  assert.throws(() => readModelConfiguration({ AELIQO_MODEL: 'tools-model' }), /configured together/u);
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_PROTOCOL: undefined }), /protocol/u);
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_CAPABILITIES: undefined }), /capabilities/u);
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_AUTH_SCHEME: undefined }), /authentication/u);
});

test('rejects unsafe endpoints and unsupported capabilities before egress', () => {
  assert.throws(
    () => readModelConfiguration({ ...complete, AELIQO_MODEL_BASE_URL: 'http://provider.example/v1/' }),
    /loopback/u,
  );
  assert.throws(
    () => readModelConfiguration({ ...complete, AELIQO_MODEL_BASE_URL: 'https://user:password@provider.example/v1/' }),
    /credentials/u,
  );
  assert.throws(
    () => readModelConfiguration({ ...complete, AELIQO_MODEL_BASE_URL: 'https://provider.example/v1/?key=secret' }),
    /query/u,
  );
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_CAPABILITIES: 'usage' }), /tool-calls/u);
  assert.throws(
    () => readModelConfiguration({ ...complete, AELIQO_MODEL_CAPABILITIES: 'tool-calls,unknown' }),
    /capabilities/u,
  );
});

test('keeps auth explicit and allows only local no-auth or opted-in local HTTP', () => {
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_AUTH_SCHEME: 'none' }), /credential/u);
  assert.throws(() => readModelConfiguration({ ...complete, AELIQO_MODEL_AUTH_SCHEME: 'header' }), /header/u);
  const local = readModelConfiguration({
    ...complete,
    AELIQO_MODEL_BASE_URL: 'http://127.0.0.1:9090/v1/',
    AELIQO_MODEL_AUTH_SCHEME: 'none',
    AELIQO_MODEL_API_KEY: undefined,
    AELIQO_ALLOW_INSECURE_MODEL_HTTP: '1',
  });
  assert.equal(local.auth.scheme, 'none');
  assert.equal(local.endpoint.origin, 'http://127.0.0.1:9090');
  assert.throws(
    () => readModelConfiguration({ ...complete, AELIQO_MODEL_BASE_URL: 'http://127.0.0.1:9090/v1/' }),
    /opt-in/u,
  );
});

test('returns protocol, auth, endpoint, model and capabilities without exposing the secret in public metadata', () => {
  const config = readModelConfiguration({
    ...complete,
    AELIQO_MODEL_AUTH_SCHEME: 'header',
    AELIQO_MODEL_AUTH_HEADER: 'x-api-key',
  });
  assert.deepEqual(config.public, {
    protocol: 'openai-compatible-chat',
    model: 'tools-model',
    endpointOrigin: 'https://provider.example',
    authScheme: 'header',
    capabilities: ['tool-calls', 'usage', 'request-cancellation'],
  });
  assert.equal(JSON.stringify(config.public).includes('server-only-secret'), false);
});

test('allows an explicit HTTPS Responses profile with bearer auth and bounded capabilities', () => {
  const config = readModelConfiguration({
    ...complete,
    AELIQO_MODEL_PROTOCOL: 'openai-compatible-responses',
    AELIQO_MODEL_CAPABILITIES: 'tool-calls,usage,input-token-estimate,request-cancellation',
  });
  assert.equal(config.protocol, 'openai-compatible-responses');
  assert.equal(config.auth.scheme, 'bearer');
  assert.throws(
    () =>
      readModelConfiguration({
        ...complete,
        AELIQO_MODEL_PROTOCOL: 'openai-compatible-responses',
        AELIQO_MODEL_AUTH_SCHEME: 'header',
        AELIQO_MODEL_AUTH_HEADER: 'x-api-key',
      }),
    /bearer/u,
  );
  assert.throws(
    () =>
      readModelConfiguration({
        ...complete,
        AELIQO_MODEL_PROTOCOL: 'openai-compatible-responses',
        AELIQO_MODEL_CAPABILITIES: 'tool-calls,request-retry',
      }),
    /retry/u,
  );
});
