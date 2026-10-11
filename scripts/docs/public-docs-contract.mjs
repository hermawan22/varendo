import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { isReleaseVersion, RELEASE_VERSION } from '../release/metadata.mjs';
import { hasExactKeys } from './docs-lib.mjs';

export const PUBLIC_DOCS_SCHEMA = 'aeliqo.public-docs.v1';
export const PUBLIC_DOCS_MANIFEST_SCHEMA = 'aeliqo.public-docs-manifest.v1';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  if (!hasExactKeys(value, expected)) {
    throw new Error(`${label} has unexpected fields: ${Object.keys(value).sort().join(', ')}`);
  }
}

function assertSafeFileName(value, label) {
  if (typeof value !== 'string' || value === '' || basename(value) !== value || value === '.' || value === '..') {
    throw new Error(`${label} must be a local file name`);
  }
}

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.startsWith('/') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertVersion(value, label) {
  if (!isReleaseVersion(value)) {
    throw new Error(`${label} must use the ${RELEASE_VERSION} release lineage`);
  }
}

function assertSource(value, label) {
  assertObject(value, label);
  assertExactKeys(value, ['repository', 'revision'], label);
  if (value.repository !== 'https://github.com/hermawan22/varendo') {
    throw new Error(`${label}.repository must identify the public Varendo repository`);
  }
  if (typeof value.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(value.revision)) {
    throw new Error(`${label}.revision must be an exact Git commit`);
  }
}

function assertPackageVersions(value, docsVersion, label) {
  assertObject(value, label);
  const names = ['@varendo/agent', '@varendo/core', '@varendo/react', '@varendo/runtime', '@varendo/web'];
  assertExactKeys(value, names, label);
  for (const name of names) {
    if (value[name] !== docsVersion) throw new Error(`${label}.${name} must equal docsVersion ${docsVersion}`);
  }
}

function assertRequiredPageFields(page, index, required) {
  for (const key of required) {
    if (typeof page[key] !== 'string' || page[key] === '')
      throw new Error(`artifact.pages[${index}].${key} must be a non-empty string`);
  }
}

function assertAllowedPageFields(page, index, allowed) {
  for (const key of Object.keys(page)) {
    if (!allowed.has(key)) throw new Error(`artifact.pages[${index}] has unexpected field ${key}`);
  }
}

function assertCanonicalPagePath(page, index) {
  if (!page.path.startsWith('/') || !page.path.endsWith('/') || page.path.startsWith('//') || page.path.includes('..'))
    throw new Error(`artifact.pages[${index}].path must be a canonical absolute route`);
}

function assertComponentPageId(page, index) {
  if (page.component !== undefined && (typeof page.component !== 'string' || page.component === ''))
    throw new Error(`artifact.pages[${index}].component must be a non-empty string`);
}

function assertPage(page, index) {
  assertObject(page, `artifact.pages[${index}]`);
  const required = ['body', 'description', 'id', 'path', 'section', 'title'];
  const allowed = new Set([...required, 'component']);
  assertRequiredPageFields(page, index, required);
  assertAllowedPageFields(page, index, allowed);
  assertCanonicalPagePath(page, index);
  assertComponentPageId(page, index);
}

export function assertPublicDocsArtifact(value) {
  const artifact = assertObject(value, 'artifact');
  assertExactKeys(artifact, ['docsVersion', 'packageVersions', 'pages', 'schema', 'source'], 'artifact');
  if (artifact.schema !== PUBLIC_DOCS_SCHEMA) throw new Error(`artifact.schema must be ${PUBLIC_DOCS_SCHEMA}`);
  assertVersion(artifact.docsVersion, 'artifact.docsVersion');
  assertSource(artifact.source, 'artifact.source');
  assertPackageVersions(artifact.packageVersions, artifact.docsVersion, 'artifact.packageVersions');
  if (!Array.isArray(artifact.pages)) throw new Error('artifact.pages must be an array');
  artifact.pages.forEach(assertPage);
  const paths = artifact.pages.map((page) => page.path);
  if (new Set(paths).size !== paths.length) throw new Error('artifact.pages contains duplicate routes');
  const ids = artifact.pages.map((page) => page.id);
  if (new Set(ids).size !== ids.length) throw new Error('artifact.pages contains duplicate IDs');
  const componentPages = artifact.pages.filter((page) => page.component !== undefined);
  if (componentPages.length === 0) throw new Error('artifact must contain component documentation routes');
  const componentIds = componentPages.map((page) => page.component);
  if (new Set(componentIds).size !== componentIds.length)
    throw new Error('artifact contains duplicate component documentation IDs');
  for (const path of ['/docs/', '/docs/components/', '/docs/search/']) {
    if (!paths.includes(path)) throw new Error(`artifact is missing required route ${path}`);
  }
  return artifact;
}

function assertManifestIdentity(manifest) {
  if (manifest.schema !== PUBLIC_DOCS_MANIFEST_SCHEMA)
    throw new Error(`manifest.schema must be ${PUBLIC_DOCS_MANIFEST_SCHEMA}`);
  assertVersion(manifest.docsVersion, 'manifest.docsVersion');
  assertSource(manifest.source, 'manifest.source');
  assertPackageVersions(manifest.packageVersions, manifest.docsVersion, 'manifest.packageVersions');
  if (manifest.sourceTree !== 'clean' && manifest.sourceTree !== 'modified')
    throw new Error('manifest.sourceTree must be clean or modified');
}

function assertManifestArtifact(artifact) {
  assertObject(artifact, 'manifest.artifact');
  assertExactKeys(artifact, ['bytes', 'file', 'sha256'], 'manifest.artifact');
  assertSafeFileName(artifact.file, 'manifest.artifact.file');
  assertSha256(artifact.sha256, 'manifest.artifact.sha256');
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0)
    throw new Error('manifest.artifact.bytes must be a positive integer');
}

function assertCatalogFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('manifest.catalogFiles must be a non-empty array');
  let previous = '';
  for (const [index, file] of files.entries()) {
    const label = `manifest.catalogFiles[${index}]`;
    assertObject(file, label);
    assertExactKeys(file, ['bytes', 'path', 'sha256'], label);
    assertSafeRelativePath(file.path, `${label}.path`);
    if (!file.path.startsWith('catalog-examples/') || !file.path.endsWith('.ts'))
      throw new Error(`${label}.path must be a catalog example TypeScript file`);
    if (file.path <= previous) throw new Error('manifest.catalogFiles must be unique and sorted by path');
    previous = file.path;
    assertSha256(file.sha256, `${label}.sha256`);
    assertPositiveBytes(file.bytes, `${label}.bytes`);
  }
  if (!files.some((file) => file.path === 'catalog-examples/index.ts'))
    throw new Error('manifest.catalogFiles must contain catalog-examples/index.ts');
}

function assertInputFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('manifest.inputs must be a non-empty array');
  let previous = '';
  for (const [index, input] of files.entries()) {
    const label = `manifest.inputs[${index}]`;
    assertObject(input, label);
    assertExactKeys(input, ['bytes', 'path', 'sha256'], label);
    assertRepositoryRelativePath(input.path, label);
    if (input.path <= previous) throw new Error('manifest.inputs must be unique and sorted by path');
    previous = input.path;
    assertSha256(input.sha256, `${label}.sha256`);
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0)
      throw new Error(`${label}.bytes must be a non-negative integer`);
  }
}

function assertPositiveBytes(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function assertRepositoryRelativePath(path, label) {
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.includes('..'))
    throw new Error(`${label}.path must be repository-relative`);
}

export function assertPublicDocsManifest(value) {
  const manifest = assertObject(value, 'manifest');
  assertExactKeys(
    manifest,
    ['artifact', 'catalogFiles', 'docsVersion', 'inputs', 'packageVersions', 'schema', 'source', 'sourceTree'],
    'manifest',
  );
  assertManifestIdentity(manifest);
  assertManifestArtifact(manifest.artifact);
  assertCatalogFiles(manifest.catalogFiles);
  assertInputFiles(manifest.inputs);
  return manifest;
}

export async function readVerifiedPublicDocs(manifestPath) {
  const absoluteManifest = await realpath(resolve(manifestPath));
  const base = dirname(absoluteManifest);
  const manifest = assertPublicDocsManifest(JSON.parse(await readFile(absoluteManifest, 'utf8')));
  const artifactPath = await realpath(resolve(base, manifest.artifact.file));
  if (dirname(artifactPath) !== base) throw new Error('artifact path escapes its manifest directory');
  const bytes = await readFile(artifactPath);
  if (bytes.byteLength !== manifest.artifact.bytes)
    throw new Error('public docs artifact byte length differs from the manifest');
  if (sha256(bytes) !== manifest.artifact.sha256)
    throw new Error('public docs artifact checksum differs from the manifest');
  const artifact = assertPublicDocsArtifact(JSON.parse(bytes.toString('utf8')));
  if (artifact.docsVersion !== manifest.docsVersion) throw new Error('artifact and manifest docsVersion differ');
  if (JSON.stringify(artifact.source) !== JSON.stringify(manifest.source))
    throw new Error('artifact and manifest source identity differ');
  if (JSON.stringify(artifact.packageVersions) !== JSON.stringify(manifest.packageVersions))
    throw new Error('artifact and manifest package versions differ');
  for (const file of manifest.catalogFiles) {
    const filePath = await realpath(resolve(base, file.path));
    if (!filePath.startsWith(`${base}${sep}`)) throw new Error('catalog example path escapes its manifest directory');
    const fileBytes = await readFile(filePath);
    if (fileBytes.byteLength !== file.bytes || sha256(fileBytes) !== file.sha256)
      throw new Error(`catalog example integrity check failed: ${file.path}`);
  }
  return { artifact, artifactPath, manifest, manifestPath: absoluteManifest };
}
