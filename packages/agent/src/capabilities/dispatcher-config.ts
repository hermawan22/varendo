import { WIRE_LIMITS } from '@varendo/core';
import type { AgentCapabilityDispatcherOptions } from './types.js';

export interface DispatchConfiguration {
  readonly options: AgentCapabilityDispatcherOptions;
  readonly maxPending: number;
  readonly maxMilliseconds: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface PendingDispatches {
  count: number;
}

const DEFAULT_MAX_PENDING = 8;
const DEFAULT_MAX_MILLISECONDS = 30_000;

function positiveLimit(value: unknown, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(maximum, value);
}

function validOptions(options: AgentCapabilityDispatcherOptions): boolean {
  return (
    options !== null &&
    typeof options === 'object' &&
    options.host !== null &&
    typeof options.host?.readContext === 'function' &&
    options.registry !== null &&
    typeof options.registry?.get === 'function'
  );
}

export function createDispatchConfiguration(options: AgentCapabilityDispatcherOptions): DispatchConfiguration {
  if (!validOptions(options)) throw new TypeError('A capability host and registry are required.');
  return {
    options,
    maxPending: positiveLimit(options.maxPending, 64, DEFAULT_MAX_PENDING),
    maxMilliseconds: positiveLimit(options.maxMilliseconds, 300_000, DEFAULT_MAX_MILLISECONDS),
    maxInputBytes: positiveLimit(options.maxInputBytes, WIRE_LIMITS.bytes, WIRE_LIMITS.bytes),
    maxOutputBytes: positiveLimit(options.maxOutputBytes, WIRE_LIMITS.bytes, WIRE_LIMITS.bytes),
  };
}
