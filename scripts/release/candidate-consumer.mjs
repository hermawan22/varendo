import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PUBLIC_PACKAGE_NAMES,
  exportSpecifiers,
  npmOverridesFromPnpmLock,
  packagePurl,
  pnpmLockIntegrities,
  readJson,
  removeDirectoryOnFailure,
  sha256,
} from './candidate-lib.mjs';
import {
  CONSUMER_TOOL_SPECS,
  exportImportStatement,
  externalPeerNames,
  recordLockedPeer,
  sortedPeerEntries,
  writeConsumerTsconfig,
} from './consumer-scaffold.mjs';
import { run } from './run.mjs';

const root = resolve(import.meta.dirname, '../..');
const command = run;

async function peerInstallSpecs(packages) {
  const peers = new Map();
  for (const item of packages) {
    for (const name of externalPeerNames(item.manifest)) {
      const installed = await readJson(join(item.directory, 'node_modules', name, 'package.json'));
      recordLockedPeer(
        peers,
        name,
        installed.version,
        (previous, current) => `Conflicting locked peer versions for ${name}: ${previous} and ${current}`,
      );
    }
  }
  return sortedPeerEntries(peers).map(([name, requested]) => `${name}@${requested}`);
}

async function typeCheckInstalledExports(consumer, packages) {
  const specifiers = packages.flatMap((item) => exportSpecifiers(item.manifest, item.paths));
  const imports = specifiers.map(exportImportStatement);
  await writeFile(join(consumer, 'exports.ts'), imports.join('\n') + '\n');
  await writeConsumerTsconfig(consumer);
  command(join(consumer, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], { cwd: consumer });
  return imports.length;
}

function packageNameFromLockPath(path) {
  const tail = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function resolveLockedDependency(packages, fromPath, dependency) {
  let current = fromPath;
  while (true) {
    const nested = `${current}/node_modules/${dependency}`;
    if (packages[nested]) return nested;
    const index = current.lastIndexOf('/node_modules/');
    if (index === -1) break;
    current = current.slice(0, index);
  }
  const rootPath = `node_modules/${dependency}`;
  return packages[rootPath] ? rootPath : undefined;
}

function collectPackageReferences(entries, workspaceLockText) {
  const workspace = pnpmLockIntegrities(workspaceLockText);
  const refByPath = new Map();
  const externalByPath = new Map();
  for (const [path, entry] of Object.entries(entries)) {
    if (!path.includes('node_modules/') || !entry.version) continue;
    const name = packageNameFromLockPath(path);
    const ref = packagePurl(name, entry.version);
    refByPath.set(path, ref);
    if (PUBLIC_PACKAGE_NAMES.includes(name)) continue;
    if (!entry.integrity) throw new Error(`Installed external package ${name}@${entry.version} has no integrity`);
    if (workspace.get(`${name}@${entry.version}`) !== entry.integrity)
      throw new Error(`Installed ${name}@${entry.version} differs from the pnpm lock`);
    if (!entry.license) throw new Error(`Installed external package ${name}@${entry.version} has no license metadata`);
    externalByPath.set(path, {
      ref,
      name,
      version: entry.version,
      integrity: entry.integrity,
      license: String(entry.license),
    });
  }
  return { refByPath, externalByPath };
}

function collectDependencyEdges(entries, refByPath) {
  const edges = new Map();
  for (const [path, entry] of Object.entries(entries)) {
    const ref = refByPath.get(path);
    if (!ref) continue;
    const childPaths = [];
    const dependencies = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      const dependencyPath = resolveLockedDependency(entries, path, dependency);
      if (dependencyPath && refByPath.has(dependencyPath)) childPaths.push(dependencyPath);
    }
    edges.set(path, { ref, childPaths });
  }
  return edges;
}

function reachablePackagePaths(edges, packages) {
  const reachable = new Set();
  const queue = packages.map((item) => `node_modules/${item.name}`);
  while (queue.length) {
    const path = queue.shift();
    if (!path || reachable.has(path)) continue;
    reachable.add(path);
    for (const child of edges.get(path)?.childPaths ?? []) queue.push(child);
  }
  return reachable;
}

function sbomDependencies(reachable, edges, refByPath) {
  return [...reachable]
    .map((path) => ({
      ref: refByPath.get(path),
      dependsOn: (edges.get(path)?.childPaths ?? [])
        .filter((child) => reachable.has(child))
        .map((child) => refByPath.get(child)),
    }))
    .filter((item) => item.ref);
}

function sbomGraph(consumerLock, workspaceLockText, packages) {
  const entries = consumerLock.packages;
  const { refByPath, externalByPath } = collectPackageReferences(entries, workspaceLockText);
  const edges = collectDependencyEdges(entries, refByPath);
  const reachable = reachablePackagePaths(edges, packages);
  const externalComponents = [...externalByPath]
    .filter(([path]) => reachable.has(path))
    .map(([, component]) => component);
  return { externalComponents, dependencies: sbomDependencies(reachable, edges, refByPath) };
}

async function installExternalPackages(consumer, packages, workspaceLockText, version) {
  const overrides = npmOverridesFromPnpmLock(workspaceLockText, { ignoredPackages: PUBLIC_PACKAGE_NAMES });
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module', overrides }, null, 2) + '\n',
  );
  command(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      ...packages.map((item) => item.path),
      ...(await peerInstallSpecs(packages)),
      ...CONSUMER_TOOL_SPECS,
    ],
    { cwd: consumer },
  );
  const lock = await readJson(join(consumer, 'package-lock.json'));
  assertExactTarballs(lock, packages, version);
  return { overrides, lock };
}

function assertExactTarballs(lock, packages, version) {
  for (const item of packages) {
    const installed = lock.packages[`node_modules/${item.name}`];
    if (!installed || installed.version !== version || installed.integrity !== item.integrity)
      throw new Error(`Consumer did not install exact ${item.name} tarball`);
  }
}

async function writeNetworkBlocker(consumer) {
  await writeFile(
    join(consumer, 'network-blocker.cjs'),
    [
      "const {syncBuiltinESMExports} = require('node:module');",
      'const state = {attempts: []}; globalThis.__varendoOfflineNetwork = state;',
      "const blocked = label => () => { state.attempts.push(label); const error = new Error('network access is forbidden in the offline release consumer'); error.code = 'VARENDO_OFFLINE_NETWORK_BLOCKED'; throw error; };",
      "globalThis.fetch = blocked('fetch');",
      "for (const name of ['node:http', 'node:https']) { const value = require(name); value.request = blocked(`${name.slice(5)}.request`); value.get = blocked(`${name.slice(5)}.get`); }",
      "const net = require('node:net'); net.connect = blocked('net.connect'); net.createConnection = blocked('net.createConnection'); net.Socket.prototype.connect = blocked('net.Socket.connect');",
      "const dns = require('node:dns'); dns.lookup = blocked('dns.lookup'); dns.resolve = blocked('dns.resolve');",
      'syncBuiltinESMExports();',
    ].join('\n') + '\n',
  );
}

async function runQuickstart(consumer) {
  await cp(join(root, 'examples/quickstart.mjs'), join(consumer, 'quickstart.mjs'));
  const output = command(
    'node',
    ['--disallow-code-generation-from-strings', '--require', './network-blocker.cjs', 'quickstart.mjs'],
    { cwd: consumer },
  );
  if (output !== '{"ok":true,"revision":"catalog-1","entities":["employees"]}')
    throw new Error('Packed quickstart returned an invalid result');
  return output;
}

async function writeRuntimeConsumer(consumer, installedExportSpecifiers) {
  await writeFile(
    join(consumer, 'consumer.mjs'),
    [
      `const installedExportSpecifiers = ${JSON.stringify(installedExportSpecifiers)};`,
      "const installedExports = await Promise.all(installedExportSpecifiers.map(specifier => specifier.endsWith('.json') ? import(specifier, {with: {type: 'json'}}) : import(specifier)));",
      "import {parseContract} from '@varendo/core';",
      'const modules = await Promise.all([',
      "  import('@varendo/runtime/evaluation'), import('@varendo/runtime/audit'), import('@varendo/web/server'),",
      "  import('@varendo/agent/protocol'), import('@varendo/react/ssr'),",
      ']);',
      "const boundedRejection = parseContract('catalog', '{}');",
      'const audit = modules[1].createLocalAuditExporter({maxEvents: 2, maxBytes: 1024, now: () => 1});',
      "const auditRecord = audit.record({kind: 'source', transport: 'local', status: 'error', code: 'source.invalid'}); const auditExport = audit.exportSnapshot(); audit.dispose();",
      'const stateBeforeProbes = globalThis.__varendoOfflineNetwork;',
      "if (installedExports.length !== installedExportSpecifiers.length || installedExports.some(module => module === null || typeof module !== 'object') || boundedRejection.ok || modules.length !== 5 || !auditRecord.ok || !auditExport.ok || auditExport.value.records.length !== 1 || !stateBeforeProbes || stateBeforeProbes.attempts.length !== 0) throw new Error('installed package runtime smoke failed');",
      "const [http, https, net, dns] = await Promise.all([import('node:http'), import('node:https'), import('node:net'), import('node:dns')]);",
      "const probes = [['fetch', () => fetch('https://example.invalid')], ['http.request', () => http.request('http://example.invalid')], ['http.get', () => http.get('http://example.invalid')], ['https.request', () => https.request('https://example.invalid')], ['https.get', () => https.get('https://example.invalid')], ['net.connect', () => net.connect(9, 'example.invalid')], ['net.createConnection', () => net.createConnection(9, 'example.invalid')], ['net.Socket.connect', () => new net.Socket().connect(9, 'example.invalid')], ['dns.lookup', () => dns.lookup('example.invalid', () => {})], ['dns.resolve', () => dns.resolve('example.invalid', () => {})]];",
      "for (const [label, probe] of probes) { try { probe(); throw new Error(`network probe unexpectedly succeeded: ${label}`); } catch (error) { if (error?.code !== 'VARENDO_OFFLINE_NETWORK_BLOCKED') throw error; } }",
      "const state = globalThis.__varendoOfflineNetwork; if (!state || JSON.stringify(state.attempts) !== JSON.stringify(probes.map(([label]) => label))) throw new Error('network blocker did not observe every exact probe');",
      'process.stdout.write(JSON.stringify({networkDenied: true, deniedMethods: state.attempts, packageModulesLoaded: 5, publicExportsLoaded: installedExports.length, coreParserExecuted: true, auditNetworkAttempts: 0, auditExecuted: true}));',
    ].join('\n') + '\n',
  );
}

function deniedNetworkMethods() {
  return [
    'fetch',
    'http.request',
    'http.get',
    'https.request',
    'https.get',
    'net.connect',
    'net.createConnection',
    'net.Socket.connect',
    'dns.lookup',
    'dns.resolve',
  ];
}

function assertOfflineRuntime(runtime, exportCount) {
  if (
    runtime.networkDenied !== true ||
    runtime.packageModulesLoaded !== 5 ||
    runtime.publicExportsLoaded !== exportCount ||
    runtime.coreParserExecuted !== true ||
    runtime.auditExecuted !== true ||
    runtime.auditNetworkAttempts !== 0 ||
    JSON.stringify(runtime.deniedMethods) !== JSON.stringify(deniedNetworkMethods())
  )
    throw new Error('Offline consumer returned an invalid report');
}

async function runOfflineConsumer(consumer, exportCount) {
  const runtime = JSON.parse(
    command('node', ['--disallow-code-generation-from-strings', '--require', './network-blocker.cjs', 'consumer.mjs'], {
      cwd: consumer,
    }),
  );
  assertOfflineRuntime(runtime, exportCount);
  return runtime;
}

async function externalConsumerInDirectory(consumer, packages, workspaceLockText, version) {
  const { overrides, lock } = await installExternalPackages(consumer, packages, workspaceLockText, version);
  const graph = sbomGraph(lock, workspaceLockText, packages);
  const exportCount = await typeCheckInstalledExports(consumer, packages);
  const installedExportSpecifiers = packages.flatMap((item) => exportSpecifiers(item.manifest, item.paths));
  await writeNetworkBlocker(consumer);
  const quickstart = await runQuickstart(consumer);
  await writeRuntimeConsumer(consumer, installedExportSpecifiers);
  const runtime = await runOfflineConsumer(consumer, exportCount);
  return {
    consumer,
    lock,
    lockSha256: sha256(await readFile(join(consumer, 'package-lock.json'))),
    packages: packages.map((item) => item.name),
    exportCount,
    quickstart,
    runtime,
    graph,
    overrideParents: Object.keys(overrides).length,
  };
}

export async function externalConsumer(packages, workspaceLockText, version) {
  const consumer = await mkdtemp(join(tmpdir(), 'varendo-release-consumer-'));
  return removeDirectoryOnFailure(consumer, () =>
    externalConsumerInDirectory(consumer, packages, workspaceLockText, version),
  );
}
