#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const separator = process.argv.indexOf('--', 2);
const key = process.argv[2];
const outputRoots = process.argv.slice(3, separator);
const command = process.argv.slice(separator + 1);
if (separator < 4 || !/^[a-z][a-z0-9-]*$/u.test(key ?? '') || outputRoots.length === 0 || command.length === 0) {
  console.error('Usage: reuse-build.mjs <key> <output>... -- <command> [args...]');
  process.exit(2);
}
if (outputRoots.some((path) => isAbsolute(path) || path.split(/[\\/]/u).includes('..'))) {
  console.error('Build output paths must stay inside the working directory.');
  process.exit(2);
}

function execute() {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env: process.env });
  if (result.error !== undefined) {
    console.error(result.error.message);
    return 127;
  }
  return result.status ?? 1;
}

async function outputFiles() {
  const files = [];
  async function visit(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refuse symlinked build output: ${path}`);
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
      return;
    }
    if (!stat.isFile()) throw new Error(`Refuse non-file build output: ${path}`);
    const bytes = await readFile(path);
    files.push({
      path: relative(process.cwd(), path).split(sep).join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  for (const output of outputRoots) await visit(resolve(output));
  if (files.length === 0) throw new Error('A successful build produced no reusable output files.');
  return files;
}

const reuseDirectory = process.env.AELIQO_BUILD_REUSE_DIRECTORY;
if (reuseDirectory === undefined || reuseDirectory === '') process.exit(execute());

await mkdir(reuseDirectory, { recursive: true });
const marker = join(reuseDirectory, `${key}.json`);
const cwd = await realpath(process.cwd());
try {
  const saved = JSON.parse(await readFile(marker, 'utf8'));
  const currentFiles = await outputFiles();
  if (
    saved.cwd === cwd &&
    JSON.stringify(saved.command) === JSON.stringify(command) &&
    JSON.stringify(saved.outputRoots) === JSON.stringify(outputRoots) &&
    JSON.stringify(saved.files) === JSON.stringify(currentFiles)
  ) {
    console.log(`Reusing ${key} build from this quality invocation.`);
    process.exit(0);
  }
} catch {
  // Missing, incomplete, or malformed state always rebuilds.
}

// A failed rebuild must not leave a formerly valid marker behind.
await rm(marker, { force: true });
const status = execute();
if (status !== 0) process.exit(status);
try {
  const files = await outputFiles();
  const temporary = `${marker}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ cwd, command, outputRoots, files })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, marker);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
