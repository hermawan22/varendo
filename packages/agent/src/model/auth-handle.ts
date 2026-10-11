import type { ModelExecutionEnvironment, OpaqueModelSecret } from './connection-types.js';

const secretValues = new WeakMap<object, string>();

export function createOpaqueModelSecret(value: string, environment: ModelExecutionEnvironment): OpaqueModelSecret {
  if (environment !== 'trusted-server')
    throw new Error('Model credentials must be created in an explicitly trusted server environment.');
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error('The model credential is not a bounded opaque value.');
  const handle = Object.freeze({ kind: 'opaque' }) as OpaqueModelSecret;
  secretValues.set(handle, value);
  return handle;
}

export function readModelSecret(secret: OpaqueModelSecret): string {
  const value = secretValues.get(secret);
  if (value === undefined) throw new Error('The model credential handle is invalid.');
  return value;
}
