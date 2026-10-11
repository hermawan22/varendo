import { WIRE_LIMITS } from '@varendo/core';
import type {
  AuthorizeRegionCommit,
  ReadAuthority,
  RegionAuthority,
  RegionStoreOptions,
  RestoreRegion,
} from './types.js';
import {
  DEFAULT_COMMIT_AUTHORIZATION_MILLISECONDS,
  FAILURE,
  MAX_COMMIT_AUTHORIZATION_MILLISECONDS,
  failure,
} from './region-contracts.js';

export interface RegionStoreConfiguration {
  readonly maxRegions: number;
  readonly maxHistory: number;
  readonly maxQueuedCommands: number;
  readonly maxStagedCommits: number;
  readonly maxStagedBytes: number;
  readonly maxCommitAuthorizationMilliseconds: number;
  readonly maxRestoreMilliseconds: number;
  readonly now: () => number;
  readonly readAuthority: ReadAuthority;
  readonly authorizeCommit: AuthorizeRegionCommit;
  readonly restoreRegion: RestoreRegion | undefined;
  readonly authorityConfigured: boolean;
  readonly authorizationConfigured: boolean;
}

interface StoreLimits {
  readonly maxRegions: number;
  readonly maxHistory: number;
  readonly maxQueuedCommands: number;
  readonly maxStagedCommits: number;
  readonly maxStagedBytes: number;
  readonly maxCommitAuthorizationMilliseconds: number;
  readonly maxRestoreMilliseconds: number;
}

function assertBoundedInteger(value: number, maximum: number, name: string, unit = 'safe integer'): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(`${name} must be a bounded positive ${unit}.`);
}

function resolveStoreLimits(settings: RegionStoreOptions): StoreLimits {
  const maxRegions = settings.maxRegions ?? 128;
  const maxHistory = settings.maxHistory ?? 64;
  const maxQueuedCommands = settings.maxQueuedCommands ?? 64;
  const maxStagedCommits = settings.maxStagedCommits ?? 128;
  const maxStagedBytes = settings.maxStagedBytes ?? WIRE_LIMITS.bytes;
  const maxCommitAuthorizationMilliseconds =
    settings.maxCommitAuthorizationMilliseconds ?? DEFAULT_COMMIT_AUTHORIZATION_MILLISECONDS;
  const maxRestoreMilliseconds = settings.maxRestoreMilliseconds ?? DEFAULT_COMMIT_AUTHORIZATION_MILLISECONDS;
  assertBoundedInteger(maxRegions, 10_000, 'maxRegions');
  assertBoundedInteger(maxHistory, WIRE_LIMITS.array, 'maxHistory');
  assertBoundedInteger(maxQueuedCommands, 10_000, 'maxQueuedCommands');
  assertBoundedInteger(maxStagedCommits, 10_000, 'maxStagedCommits');
  assertBoundedInteger(maxStagedBytes, WIRE_LIMITS.bytes, 'maxStagedBytes');
  assertBoundedInteger(
    maxCommitAuthorizationMilliseconds,
    MAX_COMMIT_AUTHORIZATION_MILLISECONDS,
    'maxCommitAuthorizationMilliseconds',
    'duration',
  );
  assertBoundedInteger(
    maxRestoreMilliseconds,
    MAX_COMMIT_AUTHORIZATION_MILLISECONDS,
    'maxRestoreMilliseconds',
    'duration',
  );
  return {
    maxRegions,
    maxHistory,
    maxQueuedCommands,
    maxStagedCommits,
    maxStagedBytes,
    maxCommitAuthorizationMilliseconds,
    maxRestoreMilliseconds,
  };
}

function resolveStoreCallbacks(settings: RegionStoreOptions) {
  const authorityConfigured = typeof settings.readAuthority === 'function';
  const authorizationConfigured = typeof settings.authorizeCommit === 'function';
  const readAuthority: ReadAuthority = authorityConfigured
    ? settings.readAuthority!
    : () => failure<RegionAuthority>('runtime.region-denied', FAILURE.denied);
  const authorizeCommit: AuthorizeRegionCommit = authorizationConfigured
    ? settings.authorizeCommit!
    : () => failure<void>('runtime.region-denied', FAILURE.denied);
  return {
    readAuthority,
    authorizeCommit,
    restoreRegion: typeof settings.restoreRegion === 'function' ? settings.restoreRegion : undefined,
    authorityConfigured,
    authorizationConfigured,
  };
}

export function resolveStoreConfiguration(options: RegionStoreOptions): RegionStoreConfiguration {
  const settings = options ?? {};
  const limits = resolveStoreLimits(settings);
  const callbacks = resolveStoreCallbacks(settings);
  return { ...limits, now: settings.now ?? (() => Date.now()), ...callbacks };
}
