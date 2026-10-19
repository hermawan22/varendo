import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { DOC_ROUTES } from '../../docs/public-site/routes.mjs';
import { readVerifiedPublicDocs, sha256 } from '../../scripts/docs/public-docs-contract.mjs';
import { PUBLIC_PACKAGE_NAMES, RELEASE_VERSION } from '../../scripts/release/metadata.mjs';

const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(root, `artifacts/public-docs/${RELEASE_VERSION}/manifest.json`);
const rcVersion = `${RELEASE_VERSION}-rc.2`;
const execFileAsync = promisify(execFile);
const activeCatalogIds = JSON.parse(await readFile(resolve(root, 'catalog/components.json'), 'utf8')).components.map(
  ({ id }) => id,
);
const activeCatalogCount = activeCatalogIds.length;

test('public docs artifact binds exact source, packages, API metadata, and runnable examples', async () => {
  const { artifact, manifest } = await readVerifiedPublicDocs(manifestPath);
  assert.equal(artifact.docsVersion, RELEASE_VERSION);
  assert.match(artifact.source.revision, /^[a-f0-9]{40}$/u);
  assert.equal(artifact.pages.length, DOC_ROUTES.length + activeCatalogCount);
  assert.equal(new Set(artifact.pages.map((page) => page.id)).size, artifact.pages.length);
  assert.equal(artifact.pages.filter((page) => page.component !== undefined).length, activeCatalogCount);
  assert.ok(artifact.pages.every((page) => page.body.length > 0));
  const componentPages = artifact.pages.filter((page) => page.component !== undefined);
  assert.equal(componentPages.filter((page) => page.body.includes('component-minimal-example')).length, 0);
  for (const page of componentPages) {
    assert.match(page.body, /data-component-preview=/u, `Missing live preview for ${page.component}`);
    assert.match(page.body, /data-example-code=/u, `Missing complete source for ${page.component}`);
    assert.match(page.body, /@varendo\/web\//u, `Missing public web package import for ${page.component}`);
    assert.match(page.body, /registerVarendoElements\(\)/u, `Missing registration example for ${page.component}`);
    assert.match(page.body, /aria-label="Integration levels"/u, `Missing adoption levels for ${page.component}`);
    assert.match(page.body, /<strong>Standalone<\/strong>/u);
    assert.match(page.body, /<strong>Semantic binding<\/strong>/u);
    assert.match(page.body, /<strong>Automatic adaptation<\/strong>/u);
  }
  const catalogPage = artifact.pages.find((page) => page.path === '/docs/components/');
  assert.ok(catalogPage);
  assert.doesNotMatch(catalogPage.body, /Standalone only/u);
  for (const id of activeCatalogIds.filter((component) => component.startsWith('compound.'))) {
    const start = catalogPage.body.indexOf(`href="/components/${id}/"`);
    assert.ok(start >= 0, `Missing catalog entry for ${id}`);
    assert.match(
      catalogPage.body.slice(start, catalogPage.body.indexOf('</a>', start)),
      /No built-in semantic binding/u,
    );
  }
  assert.match(
    artifact.pages.find((page) => page.path === '/docs/components/foundation.button/').body,
    /export declare class VarendoButtonElement/u,
  );
  assert.match(
    artifact.pages.find((page) => page.path === '/docs/components/foundation.button/').body,
    /data-example-code="button"/u,
  );
  for (const scenario of ['people', 'products', 'support', 'knowledge']) {
    const page = artifact.pages.find((candidate) => candidate.path === `/docs/examples/${scenario}/`);
    assert.ok(page, `Missing ${scenario} example page`);
    assert.equal((page.body.match(/data-project-scenario=/gu) ?? []).length, 6);
    assert.match(page.body, /src\/main\.ts · compiled export source/u);
    assert.match(page.body, /createVarendoApp/u);
  }
  const migration = artifact.pages.find((page) => page.path === '/docs/ship/migration-0.3/');
  assert.ok(migration, 'Missing migration page');
  assert.match(migration.title, /Migrate from 0\.3 to 0\.4/u);
  assert.match(migration.body, /@aeliqo\/core\/expressions/u);
  const sums = await readFile(resolve(root, `artifacts/public-docs/${RELEASE_VERSION}/SHA256SUMS`), 'utf8');
  assert.equal(
    sums,
    [
      `${manifest.artifact.sha256}  ${manifest.artifact.file}`,
      ...manifest.catalogFiles.map((file) => `${file.sha256}  ${file.path}`),
    ].join('\n') + '\n',
  );
  assert.ok(manifest.catalogFiles.length > 10);
  assert.ok(
    manifest.inputs.some((input) => input.path.startsWith('packages/web/dist/') && input.path.endsWith('.d.ts')),
  );
  const componentSources = (await readdir(resolve(root, 'docs/site/components')))
    .filter((file) => file.endsWith('.md'))
    .sort();
  assert.equal(componentSources.length, activeCatalogCount);
  const componentInputPaths = manifest.inputs
    .map((input) => input.path)
    .filter((path) => path.startsWith('docs/site/components/'))
    .sort();
  assert.deepEqual(
    componentInputPaths,
    componentSources.map((file) => `docs/site/components/${file}`),
  );
  const inputsByPath = new Map(manifest.inputs.map((input) => [input.path, input]));
  for (const file of componentSources) {
    const path = `docs/site/components/${file}`;
    const bytes = await readFile(resolve(root, path));
    assert.deepEqual(inputsByPath.get(path), { path, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
});

test('the Varendo migration documents current package identities and renamed API names', async () => {
  const { artifact } = await readVerifiedPublicDocs(manifestPath);
  const migration = artifact.pages.find((page) => page.path === '/docs/ship/migration-varendo/');
  assert.ok(migration, 'Missing Varendo migration page');
  const renderedText = migration.body.replace(/<[^>]+>/gu, '');
  for (const name of PUBLIC_PACKAGE_NAMES) {
    assert.ok(renderedText.includes(`${name}@${RELEASE_VERSION}`), `Missing exact install version for ${name}`);
    assert.ok(renderedText.includes(name.replace('@varendo/', '@aeliqo/')), `Missing old package mapping for ${name}`);
  }
  assert.match(migration.body, /@varendo\/web\/app/u);
  assert.match(migration.body, /createVarendoApp/u);
  assert.match(migration.body, /VarendoProvider/u);
  assert.match(migration.body, /createAeliqoApp/u);
});

test('an external consumer can accept the verified public artifact without private site source', async () => {
  const { artifact, manifest } = await readVerifiedPublicDocs(manifestPath);
  assert.equal(artifact.pages.length, DOC_ROUTES.length + activeCatalogCount);
  assert.equal(manifest.packageVersions['@varendo/web'], RELEASE_VERSION);
  assert.equal(JSON.stringify(manifest).includes('packages/web/src'), true);
});

test('the current docs artifact follows canonical release status and binds its metadata inputs', async () => {
  const { artifact, manifest } = await readVerifiedPublicDocs(manifestPath);
  const metadata = JSON.parse(await readFile(resolve(root, 'release-metadata.json'), 'utf8'));
  assert.ok(['candidate', 'stable'].includes(metadata.status));
  const notes = artifact.pages.flatMap((page) =>
    [...page.body.matchAll(/<p class="release-status-note">([^<]+)<\/p>/gu)].map((match) => match[1]),
  );
  assert.ok(notes.length > 0, 'Missing current release status banners');
  for (const note of notes) {
    if (metadata.status === 'stable') {
      assert.ok(note.startsWith(`Varendo ${RELEASE_VERSION} is the published stable release.`));
      assert.doesNotMatch(note, /source candidate|only after registry publication/u);
    } else {
      assert.ok(note.startsWith(`Varendo ${RELEASE_VERSION} is a source candidate.`));
      assert.doesNotMatch(note, /published stable release/u);
    }
  }
  const inputsByPath = new Map(manifest.inputs.map((input) => [input.path, input]));
  for (const path of ['release-metadata.json', 'scripts/release/metadata.mjs']) {
    const bytes = await readFile(resolve(root, path));
    assert.deepEqual(inputsByPath.get(path), { path, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
});

test('verification rejects changed bytes, path traversal, and forged package identity', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-docs-test-'));
  await cp(resolve(root, `artifacts/public-docs/${RELEASE_VERSION}`), scratch, { recursive: true });
  const copiedManifest = join(scratch, 'manifest.json');
  const manifest = JSON.parse(await readFile(copiedManifest, 'utf8'));
  const artifactPath = join(scratch, manifest.artifact.file);
  await writeFile(artifactPath, `${await readFile(artifactPath, 'utf8')} `);
  await assert.rejects(readVerifiedPublicDocs(copiedManifest), /checksum|byte length/u);

  manifest.artifact.file = '../escape.json';
  await writeFile(copiedManifest, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(readVerifiedPublicDocs(copiedManifest), /local file name/u);

  await cp(resolve(root, `artifacts/public-docs/${RELEASE_VERSION}`), scratch, { recursive: true, force: true });
  const forgedManifest = JSON.parse(await readFile(copiedManifest, 'utf8'));
  const forgedArtifactPath = join(scratch, forgedManifest.artifact.file);
  const forgedArtifact = JSON.parse(await readFile(forgedArtifactPath, 'utf8'));
  forgedArtifact.packageVersions['@varendo/web'] = '9.9.9';
  const forgedBytes = Buffer.from(`${JSON.stringify(forgedArtifact, null, 2)}\n`);
  forgedManifest.artifact.sha256 = sha256(forgedBytes);
  forgedManifest.artifact.bytes = forgedBytes.byteLength;
  await writeFile(forgedArtifactPath, forgedBytes);
  await writeFile(copiedManifest, `${JSON.stringify(forgedManifest, null, 2)}\n`);
  await assert.rejects(readVerifiedPublicDocs(copiedManifest), /packageVersions/u);
});

test('verification rejects a changed executable catalog example', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-example-test-'));
  await cp(resolve(root, `artifacts/public-docs/${RELEASE_VERSION}`), scratch, { recursive: true });
  const copiedManifest = join(scratch, 'manifest.json');
  const indexPath = join(scratch, 'catalog-examples/index.ts');
  await writeFile(indexPath, `${await readFile(indexPath, 'utf8')} `);
  await assert.rejects(readVerifiedPublicDocs(copiedManifest), /catalog example integrity/u);
});

test('producer can bind the docs artifact to one exact release-candidate package set', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-docs-rc-test-'));
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const revision = stdout.trim();
  await execFileAsync(
    process.execPath,
    ['scripts/docs/build-public-docs.mjs', '--output', scratch, '--source-revision', revision, '--version', rcVersion],
    { cwd: root },
  );
  const { artifact, manifest } = await readVerifiedPublicDocs(join(scratch, `${rcVersion}/manifest.json`));
  assert.equal(artifact.docsVersion, rcVersion);
  assert.equal(artifact.source.revision, revision);
  assert.ok(Object.values(artifact.packageVersions).every((version) => version === rcVersion));
  assert.deepEqual(artifact.packageVersions, manifest.packageVersions);
  const notes = artifact.pages.flatMap((page) =>
    [...page.body.matchAll(/<p class="release-status-note">([^<]+)<\/p>/gu)].map((match) => match[1]),
  );
  assert.ok(notes.length > 0, 'Missing release-candidate status banners');
  for (const note of notes) {
    assert.ok(note.startsWith(`Varendo ${RELEASE_VERSION} is a source candidate.`));
    assert.doesNotMatch(note, /published stable release/u);
  }
});

test('producer rejects a shaped source revision that is not a repository commit', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-docs-forged-revision-'));
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        'scripts/docs/build-public-docs.mjs',
        '--output',
        scratch,
        '--source-revision',
        'a'.repeat(40),
        '--version',
        rcVersion,
      ],
      { cwd: root },
    ),
    /source revision must identify a commit/u,
  );
});

test('producer rejects an existing repository commit that is not checked-out HEAD', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-docs-stale-revision-'));
  const { stdout: tree } = await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['commit-tree', tree.trim(), '-m', 'stale docs producer test'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Varendo test',
      GIT_AUTHOR_EMAIL: 'test@varendo.invalid',
      GIT_COMMITTER_NAME: 'Varendo test',
      GIT_COMMITTER_EMAIL: 'test@varendo.invalid',
    },
  });
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        'scripts/docs/build-public-docs.mjs',
        '--output',
        scratch,
        '--source-revision',
        stdout.trim(),
        '--version',
        rcVersion,
      ],
      { cwd: root },
    ),
    /source revision must match the checked-out HEAD/u,
  );
});

test('verification rejects a catalog symlink that escapes the artifact directory', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'varendo-public-docs-symlink-test-'));
  await cp(resolve(root, `artifacts/public-docs/${RELEASE_VERSION}`), scratch, { recursive: true });
  const outside = join(scratch, '..', `varendo-outside-${process.pid}.ts`);
  const indexPath = join(scratch, 'catalog-examples/index.ts');
  await writeFile(outside, await readFile(indexPath));
  await rm(indexPath);
  await symlink(outside, indexPath);
  await assert.rejects(readVerifiedPublicDocs(join(scratch, 'manifest.json')), /escapes/u);
  await rm(outside);
});
