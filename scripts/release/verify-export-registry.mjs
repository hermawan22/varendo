#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { projectFiles } from '../../apps/site/src/playground/project-template.ts';
import { zipProject } from '../../apps/site/src/playground/zip.ts';
import { flagValue } from './cli.mjs';
import { PUBLIC_PACKAGE_NAMES } from './metadata.mjs';

const execute = promisify(execFile);
const args = process.argv.slice(2);
const scenarios = ['people', 'products', 'support', 'knowledge'];
const registry = 'https://registry.npmjs.org/';

async function run(command, args, cwd) {
  return execute(command, args, {
    cwd,
    timeout: 180_000,
    maxBuffer: 2_000_000,
    env: { ...process.env, npm_config_registry: registry, npm_config_workspaces: 'false' },
  });
}

async function latestTags(version) {
  const tags = {};
  for (const name of PUBLIC_PACKAGE_NAMES) {
    const { stdout } = await run('npm', ['view', name, 'dist-tags.latest', '--json'], process.cwd());
    tags[name] = JSON.parse(stdout);
    if (tags[name] !== version) throw new Error(`${name} latest dist-tag is not ${version}.`);
  }
  return tags;
}

async function verifyScenario(root, scenario, version) {
  const files = projectFiles(scenario, version);
  const archive = new Uint8Array(await zipProject(files).arrayBuffer());
  const archivePath = join(root, `${scenario}.zip`);
  const directory = join(root, scenario);
  await mkdir(directory);
  await writeFile(archivePath, archive);
  await run('unzip', ['-q', archivePath, '-d', directory], root);
  for (const file of files) {
    const extracted = await readFile(join(directory, file.path), 'utf8');
    if (extracted !== file.content) throw new Error(`${scenario} ZIP content differs from its export source.`);
  }
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
  const { stdout } = await run('npm', ['ls', '@varendo/core', '@varendo/runtime', '@varendo/web', '--json'], directory);
  const installed = JSON.parse(stdout).dependencies;
  for (const name of ['@varendo/core', '@varendo/runtime', '@varendo/web'])
    if (installed?.[name]?.version !== version) throw new Error(`${scenario} installed ${name} at the wrong version.`);
  await run('npm', ['run', 'build'], directory);
  return {
    scenario,
    files: files.length,
    archiveBytes: archive.byteLength,
    packages: Object.fromEntries(
      ['@varendo/core', '@varendo/runtime', '@varendo/web'].map((name) => [name, installed[name].version]),
    ),
    build: 'passed',
  };
}

async function main() {
  const version = flagValue(args, '--version');
  const sourceRevision = flagValue(args, '--source');
  const output = flagValue(args, '--output');
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? '') || !/^[0-9a-f]{40}$/u.test(sourceRevision ?? '') || !output)
    throw new Error('Pass --version <stable semver> --source <SHA> --output <report path>.');
  const root = await mkdtemp(join(tmpdir(), 'varendo-export-registry-'));
  const report = {
    schema: 'varendo.export-registry.v1',
    version,
    sourceRevision,
    registry,
    status: 'failed',
    tags: {},
    scenarios: [],
  };
  try {
    report.tags = await latestTags(version);
    for (const scenario of scenarios) report.scenarios.push(await verifyScenario(root, scenario, version));
    report.status = 'passed';
  } finally {
    await rm(root, { recursive: true, force: true });
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`Verified ${report.scenarios.length} exported ZIP projects against npm ${version}.\n`);
}

await main();
