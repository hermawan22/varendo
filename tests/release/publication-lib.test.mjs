import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PUBLIC_PACKAGE_NAMES, sha256, sha512Integrity } from '../../scripts/release/candidate-lib.mjs';
import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
import {
  assertApprovedRc,
  assertApprovedStable,
  assertCandidateIdentity,
  assertCandidateTarball,
  assertRegistryVersionAvailable,
  assertRegistryVersionNotUnpublished,
  assertTagMayAdvance,
  assertTrustedPublishingContext,
  classifyRegistryPackageResponse,
  expectedIntegrity,
  verifyNpmProvenance,
} from '../../scripts/release/publication-lib.mjs';

const sourceRevision = 'a'.repeat(40);
const rc2 = `${RELEASE_VERSION}-rc.2`;
const rc3 = `${RELEASE_VERSION}-rc.3`;
const [releaseMajor, releaseMinor] = RELEASE_VERSION.split('.').map(Number);
const futureLineRc = `${releaseMajor}.${releaseMinor + 1}.0-rc.1`;
const packages = PUBLIC_PACKAGE_NAMES.map((name, index) => ({
  name,
  version: rc2,
  sha256: String(index).padStart(64, '0'),
  integrity: `sha512-${index}`,
  bytes: 1,
  file: `varendo-${name.slice('@varendo/'.length)}-${rc2}.tgz`,
}));
const candidate = {
  schema: 'aeliqo.release-candidate.v1',
  sourceRevision,
  version: rc2,
  publishOrder: PUBLIC_PACKAGE_NAMES,
  packages,
};

test('an empty npm unpublish tombstone remains an absent registry identity', () => {
  const name = '@varendo/core';
  const tombstone = {
    _id: name,
    name,
    _rev: '5-deadbeef',
    time: { unpublished: { time: '2026-09-10T16:30:07.119Z', versions: ['0.2.0'] } },
  };
  assert.deepEqual(classifyRegistryPackageResponse(200, tombstone, name), {
    exists: false,
    selected: undefined,
    tags: {},
    versions: [],
    unpublishedVersions: ['0.2.0'],
    deprecatedVersions: [],
  });
  const state = classifyRegistryPackageResponse(200, tombstone, name);
  assert.throws(() => assertRegistryVersionAvailable(name, '0.2.0', state), /previously unpublished/);
  assert.throws(() => assertRegistryVersionNotUnpublished(name, '0.2.0', state), /cannot be resumed/);
  assert.doesNotThrow(() => assertRegistryVersionAvailable(name, '0.2.1', state));
  assert.throws(
    () => classifyRegistryPackageResponse(200, { name, _rev: tombstone._rev }, name),
    /malformed .* dist-tags/,
  );
});

test('registry availability rejects existing versions without blocking a new version', () => {
  const name = '@varendo/runtime';
  const state = classifyRegistryPackageResponse(
    200,
    {
      name,
      'dist-tags': { latest: '0.1.0' },
      versions: { '0.1.0': { name, version: '0.1.0' } },
      time: {},
    },
    name,
    'latest',
  );
  assert.throws(() => assertRegistryVersionAvailable(name, '0.1.0', state), /already published/);
  assert.doesNotThrow(() => assertRegistryVersionAvailable(name, '0.2.0', state));
  assert.doesNotThrow(() => assertRegistryVersionNotUnpublished(name, '0.1.0', state));
});

test('registry availability treats orphaned version timestamps as unpublished tombstones', () => {
  const name = '@varendo/core';
  const state = classifyRegistryPackageResponse(
    200,
    {
      name,
      'dist-tags': { latest: '0.1.0' },
      versions: { '0.1.0': { name, version: '0.1.0' } },
      time: {
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z',
        '0.1.0': '2026-01-01T00:00:00.000Z',
        '0.2.0': '2026-01-02T00:00:00.000Z',
      },
    },
    name,
    'latest',
  );
  assert.deepEqual(state.unpublishedVersions, ['0.2.0']);
  assert.throws(() => assertRegistryVersionAvailable(name, '0.2.0', state), /previously unpublished/);
});

test('candidate identity binds the release line to its required dist-tag', () => {
  assert.doesNotThrow(() => assertCandidateIdentity(candidate, { tag: 'next' }));

  const stable = {
    ...candidate,
    version: RELEASE_VERSION,
    packages: packages.map((item) => ({
      ...item,
      version: RELEASE_VERSION,
      file: item.file.replace(rc2, RELEASE_VERSION),
    })),
  };
  assert.doesNotThrow(() => assertCandidateIdentity(stable, { tag: 'latest' }));
  assert.throws(() => assertCandidateIdentity(candidate, { tag: 'latest' }), /Stable candidates require latest/);
  assert.throws(() => assertCandidateIdentity(stable, { tag: 'next' }), /Stable candidates require latest/);
  assert.throws(
    () =>
      assertCandidateIdentity(
        { ...candidate, packages: candidate.packages.map((item, index) => (index ? item : { ...item, bytes: 0 })) },
        { tag: 'next' },
      ),
    /metadata is invalid/,
  );
});

test('candidate identity rejects obsolete-scope and escaping tarball filenames', () => {
  for (const file of [`aeliqo-core-${rc2}.tgz`, `../varendo-core-${rc2}.tgz`]) {
    const invalid = {
      ...candidate,
      packages: candidate.packages.map((item, index) => (index === 0 ? { ...item, file } : item)),
    };
    assert.throws(() => assertCandidateIdentity(invalid, { tag: 'next' }), /metadata is invalid/);
  }
});

test('publication reopens each tarball and binds its internal public identity', () => {
  const item = packages[0];
  const manifest = {
    name: item.name,
    version: candidate.version,
    license: 'Apache-2.0',
    exports: { '.': './dist/index.js' },
  };
  const paths = [
    'package/',
    'package/LICENSE',
    'package/NOTICE',
    'package/README.md',
    'package/dist/index.js',
    'package/package.json',
  ];
  const canonicalLicense = Buffer.from('license');
  const canonicalNotice = Buffer.from('notice');
  const input = {
    item,
    candidateVersion: candidate.version,
    manifest,
    paths,
    license: canonicalLicense,
    notice: canonicalNotice,
    canonicalLicense,
    canonicalNotice,
  };
  assert.doesNotThrow(() => assertCandidateTarball(input));
  assert.throws(
    () => assertCandidateTarball({ ...input, manifest: { ...manifest, name: '@varendo/runtime' } }),
    /Expected @varendo\/core/,
  );
  assert.throws(
    () => assertCandidateTarball({ ...input, manifest: { ...manifest, version: '9.9.9' } }),
    /must be version/,
  );
  assert.throws(() => assertCandidateTarball({ ...input, notice: Buffer.from('changed') }), /NOTICE differs/);
});

test('trusted publishing and dist-tag movement fail closed', () => {
  const environment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'hermawan22/varendo',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_ACTOR: 'hermawan22',
    GITHUB_TRIGGERING_ACTOR: 'hermawan22',
    GITHUB_SHA: sourceRevision,
  };
  assert.doesNotThrow(() => assertTrustedPublishingContext(environment, sourceRevision));
  assert.throws(
    () => assertTrustedPublishingContext({ ...environment, GITHUB_REF: 'refs/heads/other' }, sourceRevision),
    /canonical current-main/,
  );
  assert.doesNotThrow(() =>
    assertTagMayAdvance({
      name: packages[0].name,
      tag: 'next',
      desiredVersion: rc3,
      currentVersion: rc2,
      versionAlreadyExists: false,
    }),
  );
  for (const currentVersion of ['0.0.9-rc.1', '0.0.9']) {
    assert.doesNotThrow(() =>
      assertTagMayAdvance({
        name: packages[0].name,
        tag: 'next',
        desiredVersion: rc2,
        currentVersion,
        versionAlreadyExists: false,
      }),
    );
  }
  assert.throws(
    () =>
      assertTagMayAdvance({
        name: packages[0].name,
        tag: 'next',
        desiredVersion: rc2,
        currentVersion: rc3,
        versionAlreadyExists: false,
      }),
    /Refusing to move/,
  );
  assert.throws(
    () =>
      assertTagMayAdvance({
        name: packages[0].name,
        tag: 'next',
        desiredVersion: rc2,
        currentVersion: futureLineRc,
        versionAlreadyExists: false,
      }),
    /Refusing to move/,
  );
  assert.throws(
    () =>
      assertTagMayAdvance({
        name: packages[0].name,
        tag: 'next',
        desiredVersion: rc2,
        currentVersion: RELEASE_VERSION,
        versionAlreadyExists: false,
      }),
    /Refusing to move/,
  );
  assert.throws(
    () =>
      assertTagMayAdvance({
        name: packages[0].name,
        tag: 'next',
        desiredVersion: rc2,
        currentVersion: undefined,
        versionAlreadyExists: true,
      }),
    /exists but dist-tag/,
  );
  assert.doesNotThrow(() =>
    assertTagMayAdvance({
      name: packages[0].name,
      tag: 'latest',
      desiredVersion: RELEASE_VERSION,
      currentVersion: '0.1.0',
      versionAlreadyExists: false,
    }),
  );
});

test('approved RC records bind source and all candidate integrities', () => {
  const publication = {
    schema: 'aeliqo.npm-publication.v2',
    sourceRevision,
    version: candidate.version,
    tag: 'next',
    mode: 'trusted-publishing',
    completedAt: 'now',
    packages,
  };
  const consumer = {
    schema: 'aeliqo.registry-consumer.v2',
    expectedSourceRevision: sourceRevision,
    provenanceVerified: true,
    version: candidate.version,
    packages,
  };
  assert.doesNotThrow(() =>
    assertApprovedRc({ candidate, publication, consumer, version: candidate.version, sourceRevision }),
  );
  assert.throws(
    () =>
      assertApprovedRc({
        candidate,
        publication: { ...publication, mode: 'interactive-owner-bootstrap' },
        consumer,
        version: candidate.version,
        sourceRevision,
      }),
    /trusted publishing/,
  );
  assert.throws(
    () =>
      assertApprovedRc({
        candidate,
        publication,
        consumer: { ...consumer, packages: consumer.packages.slice(1) },
        version: candidate.version,
        sourceRevision,
      }),
    /each public package/,
  );
});

test('stable image export requires exact-source installed latest packages', () => {
  const stableCandidate = {
    ...candidate,
    version: RELEASE_VERSION,
    packages: packages.map((item) => ({
      ...item,
      version: RELEASE_VERSION,
      file: item.file.replace(rc2, RELEASE_VERSION),
    })),
  };
  const publication = {
    schema: 'aeliqo.npm-publication.v2',
    sourceRevision,
    version: RELEASE_VERSION,
    tag: 'latest',
    mode: 'trusted-publishing',
    completedAt: 'now',
    packages: stableCandidate.packages.map((item) => ({ ...item, distTag: 'latest' })),
  };
  const consumer = {
    schema: 'aeliqo.registry-consumer.v2',
    expectedSourceRevision: sourceRevision,
    provenanceVerified: true,
    version: RELEASE_VERSION,
    packages: stableCandidate.packages,
  };
  const input = { candidate: stableCandidate, publication, consumer, version: RELEASE_VERSION, sourceRevision };
  assert.doesNotThrow(() => assertApprovedStable(input));
  assert.throws(() => assertApprovedStable({ ...input, sourceRevision: 'b'.repeat(40) }), /exact-source/);
  assert.throws(
    () => assertApprovedStable({ ...input, consumer: { ...consumer, provenanceVerified: false } }),
    /registry consumer/,
  );
  assert.throws(
    () => assertApprovedStable({ ...input, publication: { ...publication, packages: publication.packages.slice(1) } }),
    /each public package/,
  );
  assert.throws(() => assertApprovedStable({ ...input, publication: { ...publication, tag: 'next' } }), /exact-source/);
});

test('npm provenance binds package bytes to canonical workflow and source', () => {
  const bytes = Buffer.from('candidate');
  const integrity = sha512Integrity(bytes);
  const name = '@varendo/core';
  const version = rc2;
  const statement = {
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: [
      {
        name: `pkg:npm/%40varendo/core@${rc2}`,
        digest: { sha512: Buffer.from(integrity.slice(7), 'base64').toString('hex') },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/hermawan22/varendo',
            ref: 'refs/heads/main',
            path: '/.github/workflows/release-publish.yml',
          },
        },
        internalParameters: { github: { event_name: 'workflow_dispatch' } },
        resolvedDependencies: [
          { uri: 'git+https://github.com/hermawan22/varendo@refs/heads/main', digest: { gitCommit: sourceRevision } },
        ],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } },
    },
  };
  const audit = {
    verified: [
      {
        name,
        version,
        attestationBundles: [
          {
            predicateType: statement.predicateType,
            bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
          },
        ],
      },
    ],
  };
  assert.equal(verifyNpmProvenance(audit, { name, version, integrity, sourceRevision }).sourceRevision, sourceRevision);
  assert.throws(
    () => verifyNpmProvenance(audit, { name, version, integrity, sourceRevision: 'b'.repeat(40) }),
    /lacks canonical/,
  );
  assert.equal(expectedIntegrity(bytes, { name, bytes: bytes.length, sha256: sha256(bytes), integrity }), integrity);
});

test('all public packages carry the canonical full LICENSE and NOTICE', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const [license, notice] = await Promise.all([readFile(resolve(root, 'LICENSE')), readFile(resolve(root, 'NOTICE'))]);
  assert.ok(license.length > 10_000);
  for (const name of PUBLIC_PACKAGE_NAMES) {
    const directory = name.slice('@varendo/'.length);
    assert.deepEqual(await readFile(resolve(root, 'packages', directory, 'LICENSE')), license);
    assert.deepEqual(await readFile(resolve(root, 'packages', directory, 'NOTICE')), notice);
  }
});

test('package workflow serializes publication and binds quality plus approved RC evidence', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const workflow = await readFile(resolve(root, '.github/workflows/release-publish.yml'), 'utf8');
  assert.match(workflow, /group: aeliqo-npm-publication\n/);
  assert.match(workflow, /test "\$GH_REPO" = "hermawan22\/varendo"/);
  assert.match(workflow, /test "\$ACTOR" = "hermawan22"/);
  assert.match(workflow, /branches\/main/);
  assert.match(workflow, /actions\/workflows\/quality\.yml\/runs/);
  assert.match(workflow, /aeliqo-quality-evidence-\$GITHUB_SHA/);
  assert.match(workflow, /artifacts\/quality-evidence\/artifacts\/product-ci\/ci\.json/);
  assert.match(workflow, /scripts\/release\/verify-quality-evidence\.mjs/);
  assert.match(workflow, /PUBLIC_PACKAGE_NAMES/);
  assert.match(workflow, /JSON\.stringify\(packageNames\) !== JSON\.stringify\(PUBLIC_PACKAGE_NAMES\)/);
  assert.doesNotMatch(workflow, /candidate\.packages\.length !== 6/);
  assert.doesNotMatch(workflow, /AELIQO_CI_EVIDENCE_PATH=artifacts\/quality-evidence\/harness\/evidence\/ci\.json/);
  assert.match(workflow, /verify-approved-rc\.mjs/);
  assert.match(workflow, /\[ "\$RC_SOURCE_SHA" = "\$SOURCE_SHA" \]/);
  assert.match(workflow, /--require-provenance-source "\$RC_SOURCE_SHA"/);
  assert.doesNotMatch(workflow, /bootstrap-first-rc/);
});

test('publication, registry consumer, and legacy mutations are pinned to npmjs', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const [publish, consumer, legacy] = await Promise.all([
    readFile(resolve(root, 'scripts/release/publish.mjs'), 'utf8'),
    readFile(resolve(root, 'scripts/release/registry-consumer.mjs'), 'utf8'),
    readFile(resolve(root, 'scripts/release/deprecate-legacy.mjs'), 'utf8'),
  ]);
  for (const source of [publish, consumer, legacy]) assert.match(source, /NPM_REGISTRY/);
  assert.doesNotMatch(publish, /dist-tag', 'rm'/);
  assert.match(consumer, /install'.*--registry/);
  assert.match(legacy, /\.\.\.args, '--registry'/);
});
