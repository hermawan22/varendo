#!/usr/bin/env node
/** Install and verify one exact five-package release directly from npm. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PUBLIC_PACKAGE_NAMES, exportSpecifiers, packageShortName, readJson, sha256 } from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import {
  CONSUMER_TOOL_VERSIONS,
  exportImportStatement,
  externalPeerNames,
  recordLockedPeer,
  sortedPeerEntries,
  writeConsumerTsconfig,
} from './consumer-scaffold.mjs';
import { NPM_REGISTRY, assertCandidateIdentity, verifyNpmProvenance } from './publication-lib.mjs';
import { isReleaseVersion, RELEASE_VERSION, releaseCandidateNumber } from './metadata.mjs';
import { run } from './run.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const version = flagValue(args, '--version');
const output = resolve(root, flagValue(args, '--output') ?? 'artifacts/registry-consumer.json');
const expectedCandidatePath = flagValue(args, '--expected-candidate');
const expectedSourceRevision = flagValue(args, '--require-provenance-source');
if (!isReleaseVersion(version))
  throw new Error(`A unique ${RELEASE_VERSION} or ${RELEASE_VERSION}-rc.N --version is required`);
if ((expectedCandidatePath === undefined) !== (expectedSourceRevision === undefined))
  throw new Error('Expected candidate and provenance source must be supplied together');
if (expectedSourceRevision !== undefined && !/^[0-9a-f]{40}$/.test(expectedSourceRevision))
  throw new Error('Expected provenance source must be a full Git commit SHA');

async function packedPaths(directory, relative = '') {
  const paths = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) paths.push(...(await packedPaths(directory, child)));
    else if (entry.isFile()) paths.push(`package/${child}`);
  }
  return paths;
}

async function collectPackagePeers(packageName, peers) {
  const manifest = await readJson(join(root, 'packages', packageShortName(packageName), 'package.json'));
  for (const peer of externalPeerNames(manifest)) {
    const installed = await readJson(
      join(root, 'packages', packageShortName(packageName), 'node_modules', peer, 'package.json'),
    );
    recordLockedPeer(peers, peer, installed.version, () => `Conflicting locked peer versions for ${peer}`);
  }
}

async function collectExternalPeerVersions() {
  const peers = new Map();
  for (const name of PUBLIC_PACKAGE_NAMES) await collectPackagePeers(name, peers);
  return peers;
}

function assertRegistryMatchesCandidate(candidatePackages, registryPackages) {
  for (const item of candidatePackages ?? []) {
    const installed = registryPackages.find((entry) => entry.name === item.name);
    if (installed?.integrity !== item.integrity)
      throw new Error(`Registry integrity differs from approved candidate for ${item.name}`);
  }
}

const consumer = await mkdtemp(join(tmpdir(), 'varendo-registry-consumer-'));
try {
  const peers = await collectExternalPeerVersions();
  const dependencies = Object.fromEntries(PUBLIC_PACKAGE_NAMES.map((name) => [name, version]));
  for (const [name, requested] of sortedPeerEntries(peers)) dependencies[name] = requested;
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies, devDependencies: CONSUMER_TOOL_VERSIONS }, null, 2) +
      '\n',
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--registry', NPM_REGISTRY], {
    cwd: consumer,
  });

  const installedManifests = [];
  const imports = [];
  for (const name of PUBLIC_PACKAGE_NAMES) {
    const manifest = await readJson(join(consumer, 'node_modules', name, 'package.json'));
    if (manifest.name !== name || manifest.version !== version)
      throw new Error(`Registry consumer received unexpected ${name} identity`);
    installedManifests.push(manifest);
    const paths = await packedPaths(join(consumer, 'node_modules', name));
    for (const specifier of exportSpecifiers(manifest, paths)) {
      imports.push(exportImportStatement(specifier, imports.length));
    }
  }
  await writeFile(join(consumer, 'exports.ts'), imports.join('\n') + '\n');
  await writeConsumerTsconfig(consumer);
  run(join(consumer, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], { cwd: consumer });
  await writeFile(
    join(consumer, 'consumer.mjs'),
    [
      "import '@varendo/core';",
      "import '@varendo/runtime/evaluation';",
      "import '@varendo/web/server';",
      "import '@varendo/agent/protocol';",
      "import '@varendo/react/ssr';",
    ].join('\n') + '\n',
  );
  run('node', ['--disallow-code-generation-from-strings', 'consumer.mjs'], { cwd: consumer });

  const lockBytes = await readFile(join(consumer, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  const packages = PUBLIC_PACKAGE_NAMES.map((name) => {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry?.integrity || entry.version !== version)
      throw new Error(`Registry lock has no exact integrity for ${name}@${version}`);
    return { name, version, integrity: entry.integrity, resolved: entry.resolved };
  });
  let provenance = [];
  if (expectedCandidatePath !== undefined) {
    const candidate = await readJson(resolve(root, expectedCandidatePath));
    assertCandidateIdentity(candidate, { tag: releaseCandidateNumber(version) === undefined ? 'latest' : 'next' });
    if (
      candidate.schema !== 'varendo.release-candidate.v1' ||
      candidate.version !== version ||
      candidate.sourceRevision !== expectedSourceRevision
    ) {
      throw new Error('Expected candidate does not match the requested registry release');
    }
    assertRegistryMatchesCandidate(candidate.packages, packages);
    const audit = JSON.parse(
      run('npm', ['audit', 'signatures', '--json', '--include-attestations', '--registry', NPM_REGISTRY], {
        cwd: consumer,
      }),
    );
    provenance = packages.map((item) =>
      verifyNpmProvenance(audit, { ...item, sourceRevision: expectedSourceRevision }),
    );
  }
  const report = {
    schema: 'varendo.registry-consumer.v2',
    checkedAt: new Date().toISOString(),
    version,
    exportCount: imports.length,
    lockSha256: sha256(lockBytes),
    packages,
    expectedSourceRevision: expectedSourceRevision ?? null,
    provenanceVerified: expectedSourceRevision !== undefined,
    provenance,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      { output, version, packages: packages.length, exportCount: imports.length, lockSha256: report.lockSha256 },
      null,
      2,
    ),
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
