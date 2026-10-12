import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, arch, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  PUBLIC_PACKAGE_NAMES,
  RELEASE_VERSION,
  assertExportTargets,
  assertPublicManifest,
  assertTarballPaths,
  exportSpecifiers,
  packageTarballName,
} from '../../scripts/release/candidate-lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const publicPackageNames = PUBLIC_PACKAGE_NAMES.map((name) => name.slice('@varendo/'.length));

function run(command, args, cwd, timeout = 300_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageNameFromLockPath(path) {
  const tail = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function archiveEntries(archive) {
  return run('tar', ['-tzf', archive], root).trim().split('\n').filter(Boolean);
}

function archiveFile(archive, path) {
  return Buffer.from(run('tar', ['-xOf', archive, path], root, 30_000));
}

async function stagePackage(name, runDirectory, version) {
  const directory = join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const stage = join(runDirectory, 'staged', name);
  await mkdir(stage, { recursive: true });
  const stagedManifest = structuredClone(manifest);
  stagedManifest.version = version;
  delete stagedManifest.devDependencies;
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(stagedManifest[field] ?? {})) {
      if (PUBLIC_PACKAGE_NAMES.includes(dependency)) stagedManifest[field][dependency] = version;
    }
  }
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);
  for (const file of manifest.files ?? []) {
    const source = file === 'README.md' ? join(root, 'docs/packages', `${name}.md`) : join(directory, file);
    await cp(source, join(stage, file), { recursive: true });
  }
  const archive = join(runDirectory, packageTarballName(manifest.name, version));
  run('pnpm', ['pack', '--pack-destination', runDirectory], stage);
  return { archive, directory, manifest, paths: archiveEntries(archive) };
}

async function packPublicPackages(runDirectory, version) {
  const artifacts = [];
  for (const name of publicPackageNames) artifacts.push(await stagePackage(name, runDirectory, version));
  return artifacts;
}

function assertPackedArtifacts(artifacts, version, canonicalNotice, canonicalLicense, packageGuides) {
  for (const artifact of artifacts) {
    const packed = JSON.parse(archiveFile(artifact.archive, 'package/package.json').toString('utf8'));
    assertPublicManifest(packed, artifact.manifest.name, version);
    assertTarballPaths(artifact.paths, artifact.manifest.name);
    assertExportTargets(packed, artifact.paths, artifact.manifest.name);
    assert.deepEqual(
      packed.exports,
      artifact.manifest.exports,
      `${artifact.manifest.name} export map changed while packing`,
    );
    assert.equal(packed.version, version);
    assert.deepEqual(archiveFile(artifact.archive, 'package/LICENSE'), canonicalLicense);
    assert.deepEqual(archiveFile(artifact.archive, 'package/NOTICE'), canonicalNotice);
    assert.deepEqual(archiveFile(artifact.archive, 'package/README.md'), packageGuides[artifact.manifest.name]);
    assert(
      exportSpecifiers(packed, artifact.paths).length > 0,
      `${artifact.manifest.name} has no packed export specifiers`,
    );
    if (artifact.manifest.name === '@varendo/agent') {
      for (const peer of Object.keys(packed.peerDependencies ?? {}))
        assert.equal(packed.peerDependenciesMeta?.[peer]?.optional, true, `Agent peer ${peer} must stay optional`);
    }
    if (artifact.manifest.name === '@varendo/web')
      assert.equal(packed.peerDependenciesMeta?.['@varendo/runtime']?.optional, true);
    if (artifact.manifest.name === '@varendo/react')
      assert.notEqual(packed.peerDependenciesMeta?.['@varendo/runtime']?.optional, true);
  }
}

async function installConsumer(consumer, artifacts, version) {
  const dependencies = Object.fromEntries(
    artifacts.map((artifact) => [artifact.manifest.name, `file:${artifact.archive}`]),
  );
  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'aeliqo-t20-clean-consumer',
        private: true,
        type: 'module',
        dependencies: {
          ...dependencies,
          '@types/node': '24.13.3',
          '@types/react': '19.2.18',
          '@types/react-dom': '19.2.7',
          lit: '3.3.3',
          react: '19.2.8',
          'react-dom': '19.2.8',
          typescript: '7.0.2',
          vite: '8.2.2',
          vue: '3.5.42',
          zod: '4.5.4',
        },
      },
      null,
      2,
    )}\n`,
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact'], consumer);
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  for (const artifact of artifacts) {
    const installed = lock.packages[`node_modules/${artifact.manifest.name}`];
    assert.equal(
      installed?.version,
      version,
      `${artifact.manifest.name} was not installed at the candidate source version`,
    );
    assert.deepEqual(
      Object.keys(lock.packages).filter((path) => path.endsWith(`node_modules/${artifact.manifest.name}`)),
      [`node_modules/${artifact.manifest.name}`],
      `${artifact.manifest.name} was installed more than once`,
    );
  }
  return lock;
}

async function writeConsumerSources(consumer, fixtureDirectory) {
  await cp(join(fixtureDirectory, 'legacy-usage.ts'), join(consumer, 'legacy-usage.ts'));
  await cp(join(fixtureDirectory, 'vnext-entries.tsx'), join(consumer, 'new-entries.tsx'));
  await writeFile(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: ['node', 'react', 'react-dom'],
        },
        files: ['legacy-usage.ts', 'new-entries.tsx'],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, 'legacy-run.mjs'),
    [
      "const modules = await Promise.all([import('@varendo/core'), import('@varendo/runtime'), import('@varendo/web'), import('@varendo/react'), import('@varendo/agent')]);",
      "const names = ['defineResource', 'createAeliqoRuntime', 'registerAeliqoElements', 'AeliqoProvider', 'createAppToolEndpoint'];",
      "for (const [module, name] of modules.map((module, index) => [module, names[index]])) if (typeof module[name] !== 'function') throw new Error(`Missing legacy export ${name}`);",
      'console.log(JSON.stringify({legacy: true}));',
    ].join('\n') + '\n',
  );
  await writeFile(
    join(consumer, 'new-run.mjs'),
    [
      "const entries = await Promise.all([import('@varendo/core/features'), import('@varendo/runtime/surfaces'), import('@varendo/runtime/scopes'), import('@varendo/react/surface'), import('@varendo/agent/browser')]);",
      "for (const [module, names] of [[entries[0], ['defineDataFeature', 'defineFeature', 'inferLocalDataShape']], [entries[1], ['createLocalDataBinding', 'createLocalDataSurface']], [entries[3], ['AdaptiveSurface', 'AeliqoScope', 'ViewSurface', 'defineReactViews', 'useSurface', 'useSurfaceState']], [entries[4], ['connectAgent', 'createScopedSurfaceEndpoint']]]) for (const name of names) if (!(name in module)) throw new Error(`Missing vNext export ${name}`);",
      "if (typeof entries[2] !== 'object') throw new Error('Runtime scope entry did not load');",
      "const local = entries[1].createLocalDataSurface({ data: [{ id: 'ada', name: 'Ada' }], getRowId: row => row.id });",
      "try { const receipt = await local.surface.request({ kind: 'browse' }); if (receipt.status !== 'committed' || local.surface.getSnapshot().state.rows[0]?.name !== 'Ada') throw new Error('Packed local surface did not browse rows'); } finally { local.dispose(); }",
      "const React = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');",
      "function LocalPeople() { const surface = entries[3].useDataSurface({ data: [{ id: 'ada', name: 'Ada' }], getRowId: row => row.id }); return React.createElement(entries[3].AdaptiveSurface, { surface }); }",
      "if (!renderToStaticMarkup(React.createElement(LocalPeople)).includes('Ada')) throw new Error('Packed React local surface did not render useful SSR data');",
      'console.log(JSON.stringify({vNext: true}));',
    ].join('\n') + '\n',
  );
  await cp(join(fixtureDirectory, 'no-agent-forbidden.mjs'), join(consumer, 'no-agent-forbidden.mjs'));
  await writeFile(
    join(consumer, 'no-agent-entry.mjs'),
    [
      "import { defineDataFeature } from '@varendo/core/features';",
      "import { createLocalDataBinding, createLocalDataSurface } from '@varendo/runtime/surfaces';",
      "import { registerAeliqoElements } from '@varendo/web';",
      "import { AdaptiveSurface, defineReactViews, useDataSurface } from '@varendo/react/surface';",
      'globalThis.__aeliqoT20NoAgent = { defineDataFeature, createLocalDataBinding, createLocalDataSurface, registerAeliqoElements, AdaptiveSurface, defineReactViews, useDataSurface };',
    ].join('\n') + '\n',
  );
}

async function typecheckConsumer(consumer) {
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'], consumer);
  const legacyOutput = run(process.execPath, ['legacy-run.mjs'], consumer, 60_000);
  const modernOutput = run(process.execPath, ['new-run.mjs'], consumer, 60_000);
  assert.deepEqual(JSON.parse(legacyOutput), { legacy: true });
  assert.deepEqual(JSON.parse(modernOutput), { vNext: true });
}

function bundleModules(result, consumer) {
  const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
  const modules = new Set();
  for (const output of outputs) {
    if (output.type !== 'chunk') continue;
    for (const moduleId of Object.keys(output.modules)) {
      const normalized = moduleId.replaceAll('\\', '/');
      modules.add(
        normalized.startsWith(`${consumer.replaceAll('\\', '/')}/`)
          ? normalized.slice(consumer.length + 1)
          : normalized,
      );
    }
    for (const imported of [...(output.imports ?? []), ...(output.dynamicImports ?? [])]) modules.add(imported);
  }
  return [...modules].sort();
}

async function bundleEntry(consumer, entry) {
  return bundleModules(
    await build({
      configFile: false,
      root: consumer,
      logLevel: 'error',
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        rollupOptions: {
          input: join(consumer, entry),
          treeshake: false,
          output: { format: 'es', codeSplitting: false },
        },
      },
    }),
    consumer,
  );
}

function forbiddenPackageNames(lock) {
  return Object.keys(lock.packages)
    .filter((path) => path.includes('node_modules/'))
    .map(packageNameFromLockPath)
    .filter((name, index, names) => names.indexOf(name) === index)
    .filter((name) => name === 'openai' || name === 'server-only' || name.startsWith('@modelcontextprotocol/'));
}

function isAgentModule(moduleId) {
  const normalized = moduleId.replaceAll('\\', '/');
  return (
    normalized === '@varendo/agent' ||
    normalized.startsWith('@varendo/agent/') ||
    normalized.includes('node_modules/@varendo/agent/') ||
    normalized.includes('/@varendo+agent@')
  );
}

function forbiddenModules(modules, lock) {
  const providerNames = forbiddenPackageNames(lock);
  return modules.filter((moduleId) => {
    const normalized = moduleId.replaceAll('\\', '/');
    return (
      normalized.startsWith('node:') ||
      isAgentModule(normalized) ||
      providerNames.some((name) => normalized.includes(`/node_modules/${name}/`))
    );
  });
}

function assertNoForbiddenModules(modules, lock) {
  const forbidden = forbiddenModules(modules, lock);
  if (forbidden.length > 0) throw new Error(`No-agent graph contains forbidden modules: ${forbidden.join(', ')}`);
}

async function assertNoAgentGraph(consumer, lock) {
  const positive = await bundleEntry(consumer, 'no-agent-entry.mjs');
  assert.doesNotThrow(() => assertNoForbiddenModules(positive, lock));
  assert.deepEqual(
    positive.filter((moduleId) => moduleId.includes('/node_modules/@varendo/web/dist/server/')),
    [],
    'The browser/no-agent entry imported the web server helper',
  );

  const negative = await bundleEntry(consumer, 'no-agent-forbidden.mjs');
  const detected = forbiddenModules(negative, lock);
  assert(detected.some(isAgentModule));
  assert.throws(() => assertNoForbiddenModules(negative, lock), /No-agent graph contains forbidden modules/);
  return { positive, negative: detected };
}

async function assertHistoricalMigration(releaseNotes, packagePage) {
  const historical = JSON.parse(await readFile(join(root, 'docs/releases/0.5.2/support-matrix.json'), 'utf8'));
  const migration = await readFile(join(root, 'docs/site/pages/migration-0.4.md'), 'utf8');
  assert.equal(historical.candidate.version, '0.5.2');
  assert.equal(historical.candidate.baseVersion, '0.4.2');
  assert.equal(historical.candidate.compatibility, 'breaking');
  assert.match(migration, /0\.4\.2/u);
  assert.match(migration, /0\.5\.0/u);
  assert.match(releaseNotes, /## Aeliqo 0\.5\.0/u);
  assert.match(releaseNotes, /historical `0\.5\.0-rc\.1`/u);
  assert.match(releaseNotes, /earlier source revision that lacks the local React path/u);
  assert.match(packagePage, /0\.4 to 0\.5 migration guide/u);
  for (const entry of [
    '@varendo/core/features',
    '@varendo/runtime/surfaces',
    '@varendo/runtime/scopes',
    '@varendo/react/surface',
    '@varendo/agent/browser',
  ])
    assert.ok(migration.includes(entry.replace('@varendo/', '@aeliqo/')), `Historical migration must retain ${entry}`);
}

async function readQualificationInputs() {
  const metadata = JSON.parse(await readFile(join(root, 'release-metadata.json'), 'utf8'));
  const matrix = JSON.parse(await readFile(join(root, 'docs/support-matrix.json'), 'utf8'));
  const sourceVersion = metadata.previousVersion ?? metadata.upstreamVersion;
  const previousLine = sourceVersion.split('.').slice(0, 2).join('.');
  const migrationLine =
    previousLine === metadata.line
      ? `${metadata.line.split('.')[0]}.${Number(metadata.line.split('.')[1]) - 1}`
      : previousLine;
  const migrationPath = metadata.migration ?? `migration-${migrationLine}`;
  const migration = await readFile(join(root, 'docs/site/pages', `${migrationPath}.md`), 'utf8');
  const releaseNotes = await readFile(join(root, 'docs/site/pages/release-notes.md'), 'utf8');
  const packagePage = await readFile(join(root, 'docs/site/pages/packages.md'), 'utf8');
  assert.equal(metadata.version, RELEASE_VERSION);
  assert.match(sourceVersion, /^\d+\.\d+\.\d+$/u);
  assert.equal(metadata.previousVersion, null);
  assert.equal(matrix.candidate.upstreamVersion, metadata.upstreamVersion);
  assert.notEqual(metadata.previousVersion, metadata.version);
  assert.ok(['candidate', 'stable'].includes(metadata.status), 'Release status must be candidate or stable');
  assert.equal(matrix.candidate.status, metadata.status);
  assert.equal(matrix.claims.stablePublished, metadata.status === 'stable');
  assert.equal(matrix.candidate.version, metadata.version);
  assert.equal(matrix.candidate.baseVersion, metadata.previousVersion);
  assert.equal(matrix.candidate.compatibility, previousLine === metadata.line ? 'compatible' : 'breaking');
  assert.equal(metadata.line, metadata.version.split('.').slice(0, 2).join('.'));
  for (const claim of ['unlimitedScale', 'everyFramework', 'everyProvider', 'liveModelQuality'])
    assert.equal(matrix.claims[claim], false);
  assert.ok(migration.includes(`Migrate from ${migrationLine} to ${metadata.line}`));
  assert.ok(migration.includes(metadata.version));
  assert.ok(releaseNotes.includes(`## Varendo ${metadata.version}`));
  assert.ok(releaseNotes.includes(`/ship/${migrationPath}/`));
  assert.ok(packagePage.includes(`@varendo/core@${metadata.version}`));
  for (const contract of [
    'policy.expectedIssuer',
    'issuer',
    'createAppToolSession',
    'onDraftExit',
    'needs-input',
    'renderer-ready',
    'onPresentation',
    'stateMappings',
    'context.incumbent',
  ])
    assert.ok(migration.includes(contract), `Current migration must explain ${contract}`);
  await assertHistoricalMigration(releaseNotes, packagePage);
  return { metadata, matrix };
}

test('release qualification matches canonical documentation inputs', async () => {
  await readQualificationInputs();
});

test('T20 packages, migrates, and qualifies support from packed artifacts', async () => {
  const { metadata, matrix } = await readQualificationInputs();
  const candidateVersion = matrix.candidate.version;
  const evidenceRoot = join(root, 'artifacts/t20-qualification');
  await mkdir(evidenceRoot, { recursive: true });
  const runDirectory = await mkdtemp(join(evidenceRoot, 'run-'));
  const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-t20-consumer-'));
  try {
    const [canonicalNotice, canonicalLicense] = await Promise.all([
      readFile(join(root, 'NOTICE')),
      readFile(join(root, 'LICENSE')),
    ]);
    const packageGuides = Object.fromEntries(
      await Promise.all(
        publicPackageNames.map(async (name) => [
          `@varendo/${name}`,
          await readFile(join(root, 'docs/packages', `${name}.md`)),
        ]),
      ),
    );
    const artifacts = await packPublicPackages(runDirectory, candidateVersion);
    assertPackedArtifacts(artifacts, candidateVersion, canonicalNotice, canonicalLicense, packageGuides);
    const lock = await installConsumer(consumer, artifacts, candidateVersion);
    await writeConsumerSources(consumer, join(root, 'tests/release/fixtures'));
    await typecheckConsumer(consumer);
    const graph = await assertNoAgentGraph(consumer, lock);
    const packageReports = await Promise.all(
      artifacts.map(async (artifact) => ({
        name: artifact.manifest.name,
        version: candidateVersion,
        tarball: artifact.archive,
        sha256: digest(await readFile(artifact.archive)),
        exports: exportSpecifiers(artifact.manifest, artifact.paths),
        notices: { license: true, notice: true, readme: true },
      })),
    );
    const report = {
      schema: 'aeliqo.t20-qualification.v1',
      sourceRevision: run('git', ['rev-parse', 'HEAD'], root, 30_000).trim(),
      stableVersion: metadata.previousVersion,
      candidate: matrix.candidate,
      packageArtifacts: {
        version: candidateVersion,
        role: 'vnext-candidate-consumer',
        candidatePublished: false,
      },
      environment: { node: process.version, os: platform(), release: release(), arch: arch() },
      packages: packageReports,
      legacyConsumer: { typecheck: true, runtime: true },
      vNextConsumer: { typecheck: true, runtime: true },
      noAgentGraph: { positiveModules: graph.positive, negativeDetected: graph.negative },
      claims: matrix.claims,
    };
    await writeFile(join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: `${runDirectory.slice(root.length + 1)}/report.json`,
          packages: artifacts.length,
          legacyConsumer: true,
          vNextConsumer: true,
          noAgentModules: graph.positive.length,
          negativeForbiddenModules: graph.negative.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});
