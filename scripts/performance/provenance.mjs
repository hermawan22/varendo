import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function invalidPath(path, paths) {
  return typeof path !== 'string' || isAbsolute(path) || path.split('/').includes('..') || paths.has(path);
}

function validateManifest(manifest) {
  if (!/^[a-f0-9]{40}$/u.test(manifest.sourceSHA ?? '') || !Array.isArray(manifest.entries) || !manifest.entries.length)
    throw Error('Invalid archived source manifest');
  const paths = new Set();
  for (const entry of manifest.entries) {
    if (invalidPath(entry.path, paths)) throw Error('Invalid archived source path');
    if (!['100644', '100755', '120000'].includes(entry.mode) || !/^[a-f0-9]{40}$/u.test(entry.oid ?? ''))
      throw Error('Invalid archived source object');
    paths.add(entry.path);
  }
}

async function objectMatches(root, entry) {
  const path = join(root, entry.path);
  const stat = await lstat(path);
  let bytes;
  if (entry.mode === '120000') {
    if (!stat.isSymbolicLink()) return false;
    bytes = Buffer.from(await readlink(path));
  } else {
    if (!stat.isFile() || ((stat.mode & 0o111) !== 0) !== (entry.mode === '100755')) return false;
    bytes = await readFile(path);
  }
  const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return oid === entry.oid;
}

export async function verifyArchive(root, manifest) {
  validateManifest(manifest);
  for (const entry of manifest.entries) {
    try {
      if (!(await objectMatches(root, entry))) return false;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

function manifestFromCommit(repository, sourceSHA) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSHA)) throw Error('Expected exact source SHA');
  const entries = git(repository, ['ls-tree', '-r', '-z', sourceSHA])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-7]{6}) blob ([a-f0-9]{40})\t(.+)$/su.exec(line);
      if (!match) throw Error('Unsupported archived source object');
      return { mode: match[1], oid: match[2], path: match[3] };
    });
  const manifest = { sourceSHA, entries };
  validateManifest(manifest);
  return manifest;
}

export async function writeArchiveManifest(repository, sourceSHA, source, destination) {
  const manifest = manifestFromCommit(repository, sourceSHA);
  if (!(await verifyArchive(source, manifest))) throw Error('Source bytes do not match the archived Git commit');
  await writeFile(destination, JSON.stringify(manifest));
  return manifest;
}

export async function createSourceGuard(root, env = process.env) {
  const path = env.AELIQO_SOURCE_ARCHIVE_MANIFEST;
  if (!path) {
    const commit = env.AELIQO_SOURCE_COMMIT ?? git(root, ['rev-parse', 'HEAD']).trim();
    return { commit, current: async () => git(root, ['rev-parse', 'HEAD']).trim() === commit };
  }
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.sourceSHA !== env.AELIQO_SOURCE_COMMIT || !(await verifyArchive(root, manifest)))
    throw Error('Archive provenance does not match the requested source and actual tree');
  return { commit: manifest.sourceSHA, current: () => verifyArchive(root, manifest) };
}
