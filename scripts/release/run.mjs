/** Shared synchronous command runner for release tooling. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const DEFAULT_MAX_BUFFER = 128 * 1024 * 1024;

function textFailure(commandName, args, result) {
  return new Error(
    `${commandName} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
}

function bufferFailure(commandName, args, result) {
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
  return new Error(`${commandName} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${stderr}`);
}

function assertSucceeded(commandName, args, result, defaultFailure, describeFailure) {
  if (result.error || result.status !== 0) {
    throw describeFailure === undefined ? defaultFailure(commandName, args, result) : describeFailure(result);
  }
}

export function run(commandName, args, { cwd = root, timeout = 300_000, env = process.env, describeFailure } = {}) {
  const result = spawnSync(commandName, args, { cwd, encoding: 'utf8', timeout, env });
  assertSucceeded(commandName, args, result, textFailure, describeFailure);
  return result.stdout.trim();
}

export function runBuffer(
  commandName,
  args,
  { cwd = root, timeout = 300_000, env = process.env, maxBuffer = DEFAULT_MAX_BUFFER, describeFailure } = {},
) {
  const result = spawnSync(commandName, args, { cwd, encoding: null, timeout, env, maxBuffer });
  assertSucceeded(commandName, args, result, bufferFailure, describeFailure);
  return result.stdout;
}
