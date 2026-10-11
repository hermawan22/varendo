import * as z from 'zod/mini';
import { CONTRACT_VERSION, WIRE_LIMITS as L } from './limits.js';

export const object = z.strictObject;
export const optional = z.optional;
export const array = <S extends z.ZodMiniType>(schema: S, maximum: number = L.array) =>
  z.array(schema).check(z.maxLength(maximum));
export const nonEmpty = <S extends z.ZodMiniType>(schema: S, maximum: number = L.array) =>
  z.tuple([schema], schema).check(z.maxLength(maximum));
export const text = z.string().check(z.maxLength(L.text));
export const label = z.string().check(z.minLength(1), z.maxLength(L.label));
export const nonnegative = z.number().check(z.minimum(0));
export const count = z.int().check(z.minimum(0));
export const positiveCount = z.int().check(z.minimum(1));
export const contractVersion = z.literal(CONTRACT_VERSION);
