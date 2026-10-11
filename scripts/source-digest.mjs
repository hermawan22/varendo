import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { stdout } = await execute('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'buffer',
  maxBuffer: 32 * 1024 * 1024,
});
const excluded =
  /^(?:artifacts|node_modules|test-results|playwright-report|coverage)(?:\/|$)|(?:^|\/)(?:dist|\.next)(?:\/|$)/u;
const paths = stdout
  .toString('utf8')
  .split('\0')
  .filter((path) => path && !excluded.test(path))
  .sort();
const hash = createHash('sha256');
for (const path of paths) {
  let bytes;
  try {
    bytes = await readFile(resolve(root, path));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  hash.update(path);
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
}
process.stdout.write(`${hash.digest('hex')}\n`);
