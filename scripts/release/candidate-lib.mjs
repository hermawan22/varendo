/**
 * Deterministic checks shared by the candidate builder and its unit tests.
 * This module deliberately has no package-manager dependency: a release gate
 * must be able to inspect the bytes that `pnpm pack` actually produced.
 */
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { PUBLIC_PACKAGE_NAMES, PUBLIC_PACKAGES, RELEASE_VERSION, isReleaseVersion } from './metadata.mjs';

export { PUBLIC_PACKAGE_NAMES, PUBLIC_PACKAGES, RELEASE_VERSION };

const REQUIRED_FILES = new Set(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/NOTICE']);
const ALLOWED_PREFIXES = ['package/dist/', 'package/schemas/'];
const SENSITIVE_NAME = /(?:^|[._-])(?:env|npmrc|pypirc|netrc|credentials?|secrets?|id_rsa|id_ed25519)(?:$|[._-])/i;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha512Integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

export async function removeDirectoryOnFailure(directory, operation) {
  try {
    return await operation();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function packageShortName(packageName) {
  if (!PUBLIC_PACKAGE_NAMES.includes(packageName)) throw new Error(`Not a public release package: ${packageName}`);
  return packageName.slice('@varendo/'.length);
}

export function publicPackageName(shortName) {
  if (!PUBLIC_PACKAGES.includes(shortName)) throw new Error(`Not a public package responsibility: ${shortName}`);
  return `@varendo/${shortName}`;
}

export function packageTarballName(packageName, version) {
  packageShortName(packageName);
  if (!isReleaseVersion(version)) throw new Error('Invalid public package tarball version');
  return `${packageName.slice(1).replace('/', '-')}-${version}.tgz`;
}

function assertManifestDependency(expectedName, expectedVersion, allowWorkspace, field, dependency, version) {
  const isPublicDependency = PUBLIC_PACKAGE_NAMES.includes(dependency);
  if (isPublicDependency && version !== expectedVersion && !(allowWorkspace && version === 'workspace:*'))
    throw new Error(`${expectedName} has non-exact internal ${field} dependency ${dependency}@${version}`);
  if (!allowWorkspace && typeof version === 'string' && version.startsWith('workspace:'))
    throw new Error(`${expectedName} retains workspace protocol in ${field}: ${dependency}@${version}`);
}

function assertManifestDependencies(manifest, expectedName, expectedVersion, allowWorkspace) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      assertManifestDependency(expectedName, expectedVersion, allowWorkspace, field, dependency, version);
    }
  }
}

function assertManifestIdentity(manifest, expectedName, expectedVersion) {
  if (manifest?.name !== expectedName)
    throw new Error(`Expected ${expectedName}, received ${manifest?.name ?? 'no package name'}`);
  if (manifest.version !== expectedVersion)
    throw new Error(`${expectedName} must be version ${expectedVersion}; found ${manifest.version ?? 'none'}`);
  if (manifest.private === true) throw new Error(`${expectedName} must be public`);
  if (manifest.license !== 'Apache-2.0') throw new Error(`${expectedName} must declare Apache-2.0`);
}

function assertManifestExports(manifest, expectedName) {
  if (!manifest.exports || typeof manifest.exports !== 'object')
    throw new Error(`${expectedName} must declare exports`);
}

export function assertPublicManifest(
  manifest,
  expectedName,
  expectedVersion = RELEASE_VERSION,
  { allowWorkspace = false } = {},
) {
  assertManifestIdentity(manifest, expectedName, expectedVersion);
  assertManifestExports(manifest, expectedName);
  assertManifestDependencies(manifest, expectedName, expectedVersion, allowWorkspace);
}

function manifestDependencies(item) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
    Object.keys(item.manifest[field] ?? []),
  );
}

export function assertPublishOrder(packages) {
  const positions = new Map(packages.map((item, index) => [item.name, index]));
  if (positions.size !== PUBLIC_PACKAGE_NAMES.length || PUBLIC_PACKAGE_NAMES.some((name) => !positions.has(name))) {
    throw new Error('Publish set must contain each public package exactly once');
  }
  for (const [index, item] of packages.entries()) {
    for (const dependency of manifestDependencies(item)) {
      const dependencyIndex = positions.get(dependency);
      if (dependencyIndex !== undefined && dependencyIndex >= index)
        throw new Error(`${item.name} must be published after internal dependency ${dependency}`);
    }
  }
}

function assertRequiredFiles(files, packageName) {
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) throw new Error(`${packageName} is missing required packed file ${required}`);
  }
  if (!files.some((path) => path.startsWith('package/dist/')))
    throw new Error(`${packageName} has no compiled dist files`);
}

function assertAllowedFiles(files, packageName) {
  for (const path of files) {
    const relative = path.slice('package/'.length);
    const allowed = REQUIRED_FILES.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (!allowed) throw new Error(`${packageName} has non-allowlisted packed file ${path}`);
    if (SENSITIVE_NAME.test(relative)) throw new Error(`${packageName} has sensitive-looking packed file ${path}`);
  }
}

export function assertTarballPaths(paths, packageName) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error(`${packageName} tarball is empty`);
  const files = paths.filter((path) => !path.endsWith('/'));
  assertSafeTarballPaths(paths, packageName);
  assertRequiredFiles(files, packageName);
  assertAllowedFiles(files, packageName);
}

function assertSafeTarballPaths(paths, packageName) {
  for (const path of paths) {
    if (!path.startsWith('package/') || path.includes('..') || path.includes('\\'))
      throw new Error(`${packageName} has unsafe tarball path ${path}`);
  }
}

function exportTargets(value, targets = []) {
  if (typeof value === 'string') targets.push(value);
  else if (value && typeof value === 'object')
    for (const nested of Object.values(value)) exportTargets(nested, targets);
  return targets;
}

export function exportSpecifiers(manifest, paths) {
  const files = paths.filter((path) => !path.endsWith('/'));
  const specifiers = new Set();
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (!key.includes('*')) {
      specifiers.add(key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`);
      continue;
    }
    addPatternSpecifiers(specifiers, manifest.name, key, exportTargets(value), files);
  }
  return [...specifiers].sort();
}

function addPatternSpecifiers(specifiers, packageName, key, targets, files) {
  for (const target of targets) {
    if (!target.includes('*')) continue;
    const packed = `package/${target.slice(2)}`;
    const marker = packed.indexOf('*');
    addMatchingSpecifiers(specifiers, packageName, key, packed.slice(0, marker), packed.slice(marker + 1), files);
  }
}

function addMatchingSpecifiers(specifiers, packageName, key, prefix, suffix, files) {
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
    const wildcard = file.slice(prefix.length, file.length - suffix.length || undefined);
    specifiers.add(`${packageName}${key.slice(1).replace('*', wildcard)}`);
  }
}

export function assertExportTargets(manifest, paths, packageName) {
  const files = new Set(paths.filter((path) => !path.endsWith('/')));
  for (const target of exportTargets(manifest.exports)) {
    if (!target.startsWith('./') || target.includes('..'))
      throw new Error(`${packageName} has unsafe export target ${target}`);
    const packed = `package/${target.slice(2)}`;
    if (target.includes('*')) {
      const prefix = packed.slice(0, packed.indexOf('*'));
      if (!Array.from(files).some((file) => file.startsWith(prefix)))
        throw new Error(`${packageName} export pattern does not match packed files: ${target}`);
    } else if (!files.has(packed)) {
      throw new Error(`${packageName} export target is absent from tarball: ${target}`);
    }
  }
}

export function candidateManifest({ sourceRevision, packages, version = RELEASE_VERSION }) {
  assertPublishOrder(packages);
  return {
    schema: 'aeliqo.release-candidate.v1',
    sourceRevision,
    version,
    publishOrder: packages.map((item) => item.name),
    packages: packages.map(({ name, file, sha256: digest, integrity, bytes }) => ({
      name,
      version,
      file,
      sha256: digest,
      integrity,
      bytes,
    })),
  };
}

export function packagePurl(name, version) {
  const path = name.startsWith('@')
    ? `${encodeURIComponent(name.slice(0, name.indexOf('/')))}/${encodeURIComponent(name.slice(name.indexOf('/') + 1))}`
    : encodeURIComponent(name);
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
}

function integrityToCycloneDxHash(integrity) {
  const match = /^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '');
  if (!match) throw new Error(`Unsupported package integrity ${integrity ?? 'none'}`);
  return {
    alg: match[1] === 'sha256' ? 'SHA-256' : 'SHA-512',
    content: Buffer.from(match[2], 'base64').toString('hex'),
  };
}

export function pnpmLockIntegrities(lockText) {
  const result = new Map();
  let inPackages = false;
  let current;
  for (const line of lockText.split(/\r?\n/)) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (line === 'snapshots:') break;
    if (!inPackages) continue;
    const key = /^  (?:'([^']+)'|([^:\s]+)):\s*$/.exec(line);
    if (key) {
      current = key[1] ?? key[2];
      continue;
    }
    const integrity = /^    resolution: \{integrity: ([^}]+)\}/.exec(line);
    if (current && integrity) result.set(current, integrity[1]);
  }
  return result;
}

function lockedPackageIdentity(value, label) {
  const match = /^(@[^/]+\/[^@]+|[^@]+)@([^()]+)(?:\(.*\))?$/.exec(value);
  if (!match || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(match[2])) {
    throw new Error(`Unsupported ${label} ${value}`);
  }
  return { name: match[1], version: match[2] };
}

export function npmOverridesFromPnpmLock(lockText, { ignoredPackages = [] } = {}) {
  const ignored = new Set(ignoredPackages);
  const overrides = new Map();
  const state = { inSnapshots: false, current: undefined, inDependencies: false };
  for (const line of lockText.split(/\r?\n/)) {
    collectSnapshotDependency(line, state, ignored, overrides);
  }
  return Object.fromEntries(
    [...overrides]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([parent, dependencies]) => [
        parent,
        Object.fromEntries([...dependencies].sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
}

function snapshotParent(line) {
  const key = /^  (?:'([^']+)'|([^:\s]+)):\s*(?:\{\})?\s*$/.exec(line);
  if (!key) return undefined;
  const identity = lockedPackageIdentity(key[1] ?? key[2], 'locked parent');
  return `${identity.name}@${identity.version}`;
}

function collectSnapshotDependency(line, state, ignored, overrides) {
  if (line === 'snapshots:') {
    state.inSnapshots = true;
    return;
  }
  if (!state.inSnapshots) return;
  const parent = snapshotParent(line);
  if (parent !== undefined) {
    state.current = parent;
    state.inDependencies = false;
    return;
  }
  if (/^    (?:dependencies|optionalDependencies):\s*$/.test(line)) {
    state.inDependencies = true;
    return;
  }
  if (/^    \S/.test(line)) {
    state.inDependencies = false;
    return;
  }
  if (!state.inDependencies || !state.current) return;
  const child = /^      (?:'([^']+)'|([^:\s]+)):\s+(.+?)\s*$/.exec(line);
  if (child) addSnapshotDependency(state.current, child, ignored, overrides);
}

function addSnapshotDependency(parent, child, ignored, overrides) {
  const name = child[1] ?? child[2];
  if (ignored.has(name)) return;
  const value = child[3];
  const peerSuffix = value.indexOf('(');
  const version = peerSuffix === -1 ? value : value.slice(0, peerSuffix);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`Unsupported locked child ${name}@${value}`);
  const dependencies = overrides.get(parent) ?? new Map();
  const previous = dependencies.get(name);
  if (previous && previous !== version)
    throw new Error(`Conflicting locked child ${parent}>${name}: ${previous} and ${version}`);
  dependencies.set(name, version);
  overrides.set(parent, dependencies);
}

export function cyclonedxSbom({
  sourceRevision,
  packages,
  externalComponents = [],
  dependencies = [],
  version = RELEASE_VERSION,
}) {
  const internalComponents = [...packages]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      type: 'library',
      'bom-ref': packagePurl(item.name, version),
      purl: packagePurl(item.name, version),
      name: item.name,
      version,
      licenses: [{ license: { id: 'Apache-2.0' } }],
      hashes: [{ alg: 'SHA-256', content: item.sha256 }],
      properties: [
        { name: 'aeliqo:tarball', value: item.file },
        { name: 'aeliqo:source-revision', value: sourceRevision },
      ],
    }));
  const external = [...externalComponents]
    .sort((left, right) => left.ref.localeCompare(right.ref))
    .map((item) => ({
      type: 'library',
      'bom-ref': item.ref,
      purl: item.ref,
      name: item.name,
      version: item.version,
      licenses: [{ license: { name: item.license } }],
      hashes: [integrityToCycloneDxHash(item.integrity)],
    }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'aeliqo-release-candidate',
        version,
        properties: [{ name: 'aeliqo:source-revision', value: sourceRevision }],
      },
    },
    components: [...internalComponents, ...external],
    dependencies: [...dependencies]
      .sort((left, right) => left.ref.localeCompare(right.ref))
      .map((item) => ({
        ref: item.ref,
        dependsOn: [...new Set(item.dependsOn)].sort(),
      })),
  };
}

export function classifyRegistryVersionResponse(status, payload, expectedName, expectedVersion, expectedIntegrity) {
  if (status === 404) return { state: 'absent' };
  if (status !== 200) throw new Error(`Registry returned HTTP ${status} for ${expectedName}@${expectedVersion}`);
  if (payload?.name !== expectedName || payload?.version !== expectedVersion) {
    throw new Error(`Registry returned the wrong identity for ${expectedName}@${expectedVersion}`);
  }
  if (payload?.dist?.integrity !== expectedIntegrity) {
    throw new Error(`${expectedName}@${expectedVersion} exists with different bytes`);
  }
  return { state: 'verified-existing', integrity: expectedIntegrity };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
