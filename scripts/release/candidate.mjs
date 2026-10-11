#!/usr/bin/env node
/** Build, inspect, scan, type-check, and consume the five exact public package tarballs. */
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import {
  PUBLIC_PACKAGES,
  PUBLIC_PACKAGE_NAMES,
  RELEASE_VERSION,
  assertExportTargets,
  assertPublicManifest,
  assertTarballPaths,
  candidateManifest,
  cyclonedxSbom,
  publicPackageName,
  packageTarballName,
  readJson,
  sha256,
  sha512Integrity,
} from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import { run as command, runBuffer as commandBuffer } from './run.mjs';
import { RELEASE_SOURCE_STATUS_ARGS, assertReleaseSourceClean } from './source-state.mjs';
import { isReleaseVersion } from './metadata.mjs';
import { externalConsumer } from './candidate-consumer.mjs';

const root = resolve(import.meta.dirname, '../..');
const arguments_ = process.argv.slice(2);
const version = flagValue(arguments_, '--version') ?? RELEASE_VERSION;
if (!isReleaseVersion(version))
  throw new Error(`Expected --version ${RELEASE_VERSION} or a unique ${RELEASE_VERSION}-rc.N version`);
const positional = [];
for (let index = 0; index < arguments_.length; index += 1) {
  if (arguments_[index] === '--version') {
    index += 1;
    continue;
  }
  positional.push(arguments_[index]);
}
if (positional.length > 1) throw new Error('Expected at most one candidate output directory');
const output = resolve(root, positional[0] ?? 'artifacts/release-candidate');
if (relative(root, output).startsWith('..')) throw new Error('Candidate output must remain within the repository');

function requireVersion(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} ${expected} is required; received ${actual}`);
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function verifyToolchainAndSource() {
  requireVersion(process.versions.node, '24.20.0', 'Node');
  requireVersion(command('pnpm', ['--version']), '11.24.0', 'pnpm');
  assertReleaseSourceClean(command('git', RELEASE_SOURCE_STATUS_ARGS), 'Building a release candidate');
}
async function prepareOutput() {
  if (await exists(output)) {
    if ((await readdir(output)).length > 0)
      throw new Error(`Refusing to overwrite non-empty candidate output ${output}`);
  } else await mkdir(output, { recursive: true });
}
async function clearGeneratedPackageOutputs() {
  for (const shortName of PUBLIC_PACKAGES) {
    await rm(join(root, 'packages', shortName, 'dist'), { recursive: true, force: true });
  }
}
function archivePaths(tarball) {
  return command('tar', ['-tzf', tarball]).split('\n').filter(Boolean).sort();
}
function packedJson(tarball) {
  return JSON.parse(command('tar', ['-xOf', tarball, 'package/package.json']));
}
function stagedManifest(source) {
  const staged = structuredClone(source);
  staged.version = version;
  // Development dependencies belong to the source workspace, not the public
  // runtime artifact. Removing them also prevents workspace-only aliases from
  // leaking into a package assembled outside the monorepo.
  delete staged.devDependencies;
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(staged[field] ?? {})) {
      if (PUBLIC_PACKAGE_NAMES.includes(dependency)) staged[field][dependency] = version;
    }
  }
  return staged;
}

const SECRET_PATTERNS = [
  ['pem-private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36,}\b/],
  ['openai-style-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{24,}\b/],
];
function scanContent(label, content, findings) {
  // Credential formats are ASCII. latin1 provides a lossless one-byte mapping,
  // so binary files are inspected instead of disappearing from the evidence.
  const searchable = Buffer.isBuffer(content) ? content.toString('latin1') : content;
  for (const [rule, pattern] of SECRET_PATTERNS) {
    if (pattern.test(searchable)) findings.push({ file: label, rule });
  }
}
function archiveFormat(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar-gzip';
  if (lower.endsWith('.zip')) return 'zip';
}
function archiveEntries(path, format) {
  const listing = format === 'tar-gzip' ? command('tar', ['-tzf', path]) : command('unzip', ['-Z1', path]);
  return listing.split('\n').filter((entry) => entry && !entry.endsWith('/'));
}
function archiveEntry(path, format, entry) {
  return format === 'tar-gzip'
    ? commandBuffer('tar', ['-xOzf', path, '--', entry])
    : commandBuffer('unzip', ['-p', path, entry]);
}
async function scanReleaseSource() {
  const files = command('git', ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const findings = [];
  let bytes = 0;
  let expandedBytes = 0;
  let expandedEntries = 0;
  const expandedArchives = [];
  for (const file of files) {
    const path = join(root, file);
    const content = await readFile(path);
    bytes += content.byteLength;
    scanContent(file, content, findings);
    const format = archiveFormat(file);
    if (!format) continue;
    const entries = archiveEntries(path, format);
    let archiveBytes = 0;
    for (const entry of entries) {
      const payload = archiveEntry(path, format, entry);
      archiveBytes += payload.byteLength;
      expandedBytes += payload.byteLength;
      expandedEntries += 1;
      scanContent(`${file}!/${entry}`, payload, findings);
    }
    expandedArchives.push({ file, format, sha256: sha256(content), entries: entries.length, bytes: archiveBytes });
  }
  return {
    scope: 'tracked-release-source-after-clean-worktree-check',
    consideredFiles: files.length,
    scannedFiles: files.length,
    excludedFiles: [],
    bytes,
    expandedArchives,
    expandedEntries,
    expandedBytes,
    findings,
  };
}
function scanTarballs(packages) {
  const findings = [];
  let bytes = 0;
  let scannedFiles = 0;
  for (const item of packages) {
    for (const path of item.paths.filter((path) => !path.endsWith('/'))) {
      const content = command('tar', ['-xOf', item.path, path]);
      bytes += Buffer.byteLength(content);
      scanContent(`${item.name}:${path}`, content, findings);
      scannedFiles += 1;
    }
  }
  return {
    scope: 'packed-public-artifacts',
    consideredFiles: scannedFiles,
    scannedFiles,
    excludedFiles: [],
    bytes,
    findings,
  };
}

async function buildAndPack(stagingRoot) {
  const packages = [];
  const canonicalLicense = await readFile(join(root, 'LICENSE'));
  const canonicalNotice = await readFile(join(root, 'NOTICE'));
  for (const shortName of PUBLIC_PACKAGES) {
    const directory = join(root, 'packages', shortName);
    const source = await readJson(join(directory, 'package.json'));
    const expectedName = publicPackageName(shortName);
    assertPublicManifest(source, expectedName, RELEASE_VERSION, { allowWorkspace: true });
    command('pnpm', ['--filter', expectedName, 'build']);

    const stage = join(stagingRoot, shortName);
    await mkdir(stage, { recursive: true });
    for (const path of source.files ?? []) {
      if (path === 'README.md') {
        const guide = await readFile(join(root, 'docs/packages', `${shortName}.md`));
        await writeFile(join(stage, path), guide);
        continue;
      }
      await cp(join(directory, path), join(stage, path), { recursive: true });
    }
    await writeFile(join(stage, 'package.json'), JSON.stringify(stagedManifest(source), null, 2) + '\n');
    command('pnpm', ['pack', '--pack-destination', output], { cwd: stage });

    const tarball = join(output, packageTarballName(expectedName, version));
    if (!(await exists(tarball))) throw new Error(`pnpm pack did not produce expected ${tarball}`);
    const manifest = packedJson(tarball);
    assertPublicManifest(manifest, expectedName, version);
    const paths = archivePaths(tarball);
    assertTarballPaths(paths, expectedName);
    assertExportTargets(manifest, paths, expectedName);
    const packedLicense = commandBuffer('tar', ['-xOf', tarball, 'package/LICENSE']);
    const packedNotice = commandBuffer('tar', ['-xOf', tarball, 'package/NOTICE']);
    if (!packedLicense.equals(canonicalLicense))
      throw new Error(`${expectedName} packed LICENSE differs from the canonical Apache-2.0 text`);
    if (!packedNotice.equals(canonicalNotice))
      throw new Error(`${expectedName} packed NOTICE differs from the canonical attribution`);
    const bytes = await readFile(tarball);
    packages.push({
      name: expectedName,
      directory,
      manifest,
      paths,
      file: basename(tarball),
      path: tarball,
      sha256: sha256(bytes),
      integrity: sha512Integrity(bytes),
      bytes: bytes.byteLength,
    });
  }
  return packages;
}

verifyToolchainAndSource();
await prepareOutput();
await clearGeneratedPackageOutputs();
const stagingRoot = await mkdtemp(join(tmpdir(), 'aeliqo-release-pack-'));
let consumerDirectory;
try {
  const sourceScan = await scanReleaseSource();
  const sourceRevision = command('git', ['rev-parse', 'HEAD']);
  const packages = await buildAndPack(stagingRoot);
  const artifactScan = scanTarballs(packages);
  const secretScan = {
    schema: 'aeliqo.secret-scan.v1',
    sourceRevision,
    rules: SECRET_PATTERNS.map(([rule]) => rule),
    scans: [sourceScan, artifactScan],
  };
  await writeFile(join(output, 'secret-scan.json'), JSON.stringify(secretScan, null, 2) + '\n');
  const findings = secretScan.scans.flatMap((scan) => scan.findings);
  if (findings.length)
    throw new Error(
      `Secret scan found ${findings.length} high-confidence credential pattern(s); inspect secret-scan.json`,
    );

  const workspaceLockText = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  const consumer = await externalConsumer(packages, workspaceLockText, version);
  consumerDirectory = consumer.consumer;
  const manifest = candidateManifest({ sourceRevision, packages, version });
  const sbom = cyclonedxSbom({ sourceRevision, packages, ...consumer.graph, version });
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(output, 'sbom.cdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  await writeFile(
    join(output, 'consumer.json'),
    JSON.stringify(
      {
        schema: 'aeliqo.local-tarball-consumer.v1',
        sourceRevision,
        version,
        install: {
          source: 'local-candidate-tarballs',
          resolution: 'reviewed-pnpm-parent-scoped-overrides',
          overrideParents: consumer.overrideParents,
          lockSha256: consumer.lockSha256,
        },
        execution: { ...consumer.runtime, quickstart: consumer.quickstart },
        packages: packages.map((item) => ({ name: item.name, version, integrity: item.integrity })),
        exportCount: consumer.exportCount,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        output,
        sourceRevision,
        tarballs: packages.map((item) => item.file),
        consumer: { lockSha256: consumer.lockSha256, packages: consumer.packages, exportCount: consumer.exportCount },
        sbomComponents: sbom.components.length,
        secretFindings: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
  if (consumerDirectory) await rm(consumerDirectory, { recursive: true, force: true });
}
