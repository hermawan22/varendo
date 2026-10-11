import { spawnSync } from 'node:child_process';

export function execute(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, AELIQO_BUILD_REUSE_DIRECTORY: '', ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

export function output(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `${command} failed`);
  return result.stdout.trim();
}
