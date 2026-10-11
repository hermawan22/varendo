import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from './process.mjs';

export async function withBaseline(root, sha, work) {
  const temporary = await mkdtemp(join(tmpdir(), 'aeliqo-visual-baseline-'));
  const source = join(temporary, 'source');
  try {
    await mkdir(source);
    execute(root, 'git', ['archive', '--format=tar', `--output=${join(temporary, 'source.tar')}`, sha]);
    execute(root, 'tar', ['-xf', join(temporary, 'source.tar'), '-C', source]);
    execute(source, 'pnpm', ['install', '--frozen-lockfile']);
    return await work(source);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
