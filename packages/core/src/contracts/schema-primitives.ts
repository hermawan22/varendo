import * as z from 'zod/mini';
import { WIRE_LIMITS as L } from './limits.js';
import { array, contractVersion, object } from './schema-kit.js';

const identifierSchema = () =>
  z.string().check(z.minLength(1), z.maxLength(L.id), z.regex(/^[^\s\u0000-\u001f\u007f]+$/u));

export const canonicalIdSchema = identifierSchema();
export const canonicalRevisionSchema = identifierSchema();
export const canonicalVersionRefSchema = object({ id: canonicalIdSchema, revision: canonicalRevisionSchema });
export const canonicalIds = array(canonicalIdSchema);
export const canonicalRefs = array(canonicalVersionRefSchema);
export const canonicalVersion = contractVersion;
export const canonicalRecord = <S extends z.ZodMiniType>(value: S) => z.record(canonicalIdSchema, value);
