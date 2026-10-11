import {
  PUBLIC_PACKAGE_NAMES,
  assertExportTargets,
  assertPublicManifest,
  assertTarballPaths,
  packagePurl,
  packageTarballName,
  sha256,
  sha512Integrity,
} from './candidate-lib.mjs';
import { isReleaseVersion, RELEASE_VERSION, releaseCandidateNumber } from './metadata.mjs';

export const NPM_REGISTRY = 'https://registry.npmjs.org';
const GITHUB_REPOSITORY = 'hermawan22/varendo';
const GITHUB_OWNER = 'hermawan22';
const RELEASE_WORKFLOW = '.github/workflows/release-publish.yml';

function orphanedPublicationTimes(time, name, publishedVersions) {
  if (time !== undefined && (!time || typeof time !== 'object' || Array.isArray(time))) {
    throw new Error(`Registry returned malformed ${name} publication history`);
  }
  return Object.keys(time ?? {}).filter(
    (key) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(key) && !publishedVersions.includes(key),
  );
}

function unpublishedVersionEntries(unpublished, name) {
  if (unpublished === undefined) return undefined;
  if (!unpublished || typeof unpublished !== 'object' || Array.isArray(unpublished)) {
    throw new Error(`Registry returned malformed ${name} unpublished history`);
  }
  const versions = unpublished.versions;
  if (!Array.isArray(versions) || versions.some((version) => typeof version !== 'string')) {
    throw new Error(`Registry returned malformed ${name} unpublished versions`);
  }
  return versions;
}

function registryUnpublishedVersions(payload, name, publishedVersions) {
  const orphaned = orphanedPublicationTimes(payload?.time, name, publishedVersions);
  const unpublished = unpublishedVersionEntries(payload?.time?.unpublished, name);
  if (unpublished === undefined) return orphaned.sort();
  return [...new Set([...unpublished, ...orphaned])].sort();
}

function emptyRegistryState() {
  return {
    exists: false,
    selected: undefined,
    tags: {},
    versions: [],
    unpublishedVersions: [],
    deprecatedVersions: [],
  };
}

function recordKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value);
}

function isEmptyUnpublishedTombstone(payload, name, tags, versions) {
  const unpublished = payload?.time?.unpublished;
  return (
    payload?.name === name &&
    typeof payload?._rev === 'string' &&
    payload._rev.length > 0 &&
    unpublished !== null &&
    typeof unpublished === 'object' &&
    !Array.isArray(unpublished) &&
    tags === undefined &&
    versions === undefined
  );
}

function assertRegistryRecord(value, name, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Registry returned malformed ${name} ${kind}`);
}

function deprecatedVersionNames(versions) {
  return Object.entries(versions)
    .filter(([, manifest]) => typeof manifest?.deprecated === 'string' && manifest.deprecated.trim())
    .map(([version]) => version)
    .sort();
}

export function classifyRegistryPackageResponse(status, payload, name, tag = 'next') {
  const absent = emptyRegistryState();
  if (status === 404) return absent;
  if (status !== 200) throw new Error(`Registry returned HTTP ${status} for ${name} dist-tags`);

  const tags = payload?.['dist-tags'];
  const versions = payload?.versions;
  const publishedVersions = recordKeys(versions);
  const unpublishedVersions = registryUnpublishedVersions(payload, name, publishedVersions);
  if (isEmptyUnpublishedTombstone(payload, name, tags, versions)) return { ...absent, unpublishedVersions };
  assertRegistryRecord(tags, name, 'dist-tags');
  assertRegistryRecord(versions, name, 'version history');

  const selected = tags[tag];
  if (selected !== undefined && typeof selected !== 'string')
    throw new Error(`Registry returned malformed ${name} dist-tag ${tag}`);
  return {
    exists: true,
    selected,
    tags,
    versions: Object.keys(versions).sort(),
    unpublishedVersions,
    deprecatedVersions: deprecatedVersionNames(versions),
  };
}

export async function fetchRegistryJson(url, { timeoutMs = 20_000, strictJson = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const payload = strictJson ? await response.json() : await response.json().catch(() => undefined);
    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

export function assertRegistryVersionAvailable(name, version, state) {
  if (state.unpublishedVersions.includes(version)) {
    throw new Error(`${name}@${version} was previously unpublished and npm will not accept that version again`);
  }
  if (state.versions.includes(version)) {
    throw new Error(`${name}@${version} is already published`);
  }
}

export function assertRegistryVersionNotUnpublished(name, version, state) {
  if (state.unpublishedVersions.includes(version)) {
    throw new Error(`${name}@${version} was previously unpublished and cannot be resumed or republished`);
  }
}

function assertCandidatePackageOrder(candidate) {
  const names = candidate?.packages?.map((item) => item.name);
  if (
    !Array.isArray(names) ||
    names.length !== PUBLIC_PACKAGE_NAMES.length ||
    names.join('\n') !== PUBLIC_PACKAGE_NAMES.join('\n') ||
    candidate.publishOrder?.join('\n') !== PUBLIC_PACKAGE_NAMES.join('\n')
  ) {
    throw new Error('Candidate must contain the five public packages in dependency order');
  }
  return candidate.packages;
}

function assertCandidateVersionAndTag(version, tag) {
  if (!isReleaseVersion(version)) throw new Error('Candidate release version is invalid');
  const rc = releaseCandidateNumber(version);
  if ((rc === undefined && tag !== 'latest') || (rc !== undefined && tag !== 'next'))
    throw new Error('Stable candidates require latest; RC candidates require next');
}

function assertCandidatePackageMetadata(item, version) {
  const expectedFile = packageTarballName(item.name, version);
  const invalid =
    item.version !== version ||
    item.file !== expectedFile ||
    !/^[0-9a-f]{64}$/.test(item.sha256 ?? '') ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity ?? '') ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes <= 0;
  if (invalid) throw new Error(`Candidate package metadata is invalid for ${item.name}`);
}

export function assertCandidateIdentity(candidate, { tag } = {}) {
  const packages = assertCandidatePackageOrder(candidate);
  assertCandidateVersionAndTag(candidate.version, tag);
  for (const item of packages) assertCandidatePackageMetadata(item, candidate.version);
}

export function assertCandidateTarball({
  item,
  candidateVersion,
  manifest,
  paths,
  license,
  notice,
  canonicalLicense,
  canonicalNotice,
}) {
  assertPublicManifest(manifest, item.name, candidateVersion);
  assertTarballPaths(paths, item.name);
  assertExportTargets(manifest, paths, item.name);
  if (!Buffer.isBuffer(license) || !license.equals(canonicalLicense)) {
    throw new Error(`${item.name} packed LICENSE differs from the canonical Apache-2.0 text`);
  }
  if (!Buffer.isBuffer(notice) || !notice.equals(canonicalNotice)) {
    throw new Error(`${item.name} packed NOTICE differs from the canonical attribution`);
  }
}

export function assertTrustedPublishingContext(environment, sourceRevision) {
  if (
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.GITHUB_REPOSITORY !== GITHUB_REPOSITORY ||
    environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    environment.GITHUB_REF !== 'refs/heads/main' ||
    environment.GITHUB_ACTOR !== GITHUB_OWNER ||
    environment.GITHUB_TRIGGERING_ACTOR !== GITHUB_OWNER ||
    environment.GITHUB_SHA !== sourceRevision
  ) {
    throw new Error('Trusted publication requires the owner-dispatched canonical current-main workflow context');
  }
}

function releaseTagVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/u.exec(value ?? '');
  if (!match) return undefined;
  return {
    base: match.slice(1, 4).map(BigInt),
    rc: match[4] === undefined ? undefined : BigInt(match[4]),
  };
}

function canAdvanceRc(tag, desiredVersion, currentVersion) {
  if (tag !== 'next') return false;
  const desired = releaseTagVersion(desiredVersion);
  const current = releaseTagVersion(currentVersion);
  if (!desired || !current || desired.rc === undefined) return false;
  const comparison = desired.base.findIndex((part, index) => part !== current.base[index]);
  if (comparison >= 0) return desired.base[comparison] > current.base[comparison];
  return current.rc !== undefined && current.rc < desired.rc;
}

function stableVersionParts(value) {
  return /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value)?.slice(1, 4).map(Number);
}

function canAdvanceStable(tag, desiredVersion, currentVersion) {
  if (tag !== 'latest' || desiredVersion !== RELEASE_VERSION) return false;
  const desired = stableVersionParts(desiredVersion);
  const current = stableVersionParts(currentVersion);
  if (desired === undefined || current === undefined) return false;
  const comparison = desired.findIndex((part, index) => part !== current[index]);
  if (comparison >= 0) return desired[comparison] > current[comparison];
  return currentVersion !== desiredVersion;
}

export function assertTagMayAdvance({ name, tag, desiredVersion, currentVersion, versionAlreadyExists }) {
  if (currentVersion === desiredVersion) return;
  if (versionAlreadyExists) throw new Error(`${name}@${desiredVersion} exists but dist-tag ${tag} does not select it`);
  if (currentVersion === undefined) return;
  if (canAdvanceRc(tag, desiredVersion, currentVersion)) return;
  if (canAdvanceStable(tag, desiredVersion, currentVersion)) return;
  throw new Error(`Refusing to move ${name} dist-tag ${tag} from ${currentVersion} to ${desiredVersion}`);
}

function assertRecordIdentity(record, version, sourceRevision, message) {
  if (
    record?.schema !== 'aeliqo.release-candidate.v1' ||
    record.version !== version ||
    record.sourceRevision !== sourceRevision
  ) {
    throw new Error(message);
  }
}

function assertPublication(publication, tag, version, sourceRevision, message) {
  if (
    publication?.schema !== 'aeliqo.npm-publication.v2' ||
    publication.version !== version ||
    publication.sourceRevision !== sourceRevision ||
    publication.tag !== tag ||
    publication.mode !== 'trusted-publishing' ||
    typeof publication.completedAt !== 'string'
  ) {
    throw new Error(message);
  }
}

function assertConsumerRecord(consumer, version, sourceRevision, message) {
  if (
    consumer?.schema !== 'aeliqo.registry-consumer.v2' ||
    consumer.version !== version ||
    consumer.expectedSourceRevision !== sourceRevision ||
    consumer.provenanceVerified !== true
  ) {
    throw new Error(message);
  }
}

function assertApprovedPackageLists(publication, consumer) {
  if (
    publication.packages?.length !== PUBLIC_PACKAGE_NAMES.length ||
    consumer.packages?.length !== PUBLIC_PACKAGE_NAMES.length ||
    new Set(publication.packages.map((item) => item.name)).size !== PUBLIC_PACKAGE_NAMES.length ||
    new Set(consumer.packages.map((item) => item.name)).size !== PUBLIC_PACKAGE_NAMES.length
  ) {
    throw new Error('Approved RC records must contain each public package exactly once');
  }
}

function assertApprovedPackageIntegrity(candidate, publication, consumer) {
  for (const item of candidate.packages ?? []) {
    const published = publication.packages?.find((entry) => entry.name === item.name);
    const installed = consumer.packages?.find((entry) => entry.name === item.name);
    if (published?.integrity !== item.integrity || installed?.integrity !== item.integrity) {
      throw new Error(`Approved RC integrity mismatch for ${item.name}`);
    }
  }
}

export function assertApprovedRc({ candidate, publication, consumer, version, sourceRevision }) {
  assertCandidateIdentity(candidate, { tag: 'next' });
  assertRecordIdentity(
    candidate,
    version,
    sourceRevision,
    'Approved RC candidate identity does not match the selected predecessor',
  );
  assertPublication(
    publication,
    'next',
    version,
    sourceRevision,
    'Approved RC publication record is incomplete or was not created by trusted publishing',
  );
  assertConsumerRecord(
    consumer,
    version,
    sourceRevision,
    'Approved RC consumer record lacks source-bound provenance verification',
  );
  assertApprovedPackageLists(publication, consumer);
  assertApprovedPackageIntegrity(candidate, publication, consumer);
}

/** Require one exact stable publication and installed consumer from this source. */
export function assertApprovedStable({ candidate, publication, consumer, version, sourceRevision }) {
  const publicationMessage = 'Stable publication needs an exact-source candidate and trusted latest publish';
  assertCandidateIdentity(candidate, { tag: 'latest' });
  assertRecordIdentity(candidate, version, sourceRevision, publicationMessage);
  assertPublication(publication, 'latest', version, sourceRevision, publicationMessage);
  assertConsumerRecord(
    consumer,
    version,
    sourceRevision,
    'Stable publication needs exact-source registry consumer proof',
  );
  assertApprovedPackageLists(publication, consumer);
  assertApprovedPackageIntegrity(candidate, publication, consumer);
  if (publication.packages.some((item) => item.distTag !== 'latest'))
    throw new Error('Stable publication packages must use the latest tag');
}

function decodedStatements(verified) {
  const statements = [];
  for (const attestation of verified?.attestationBundles ?? []) {
    if (attestation?.predicateType !== 'https://slsa.dev/provenance/v1') continue;
    const payload = attestation?.bundle?.dsseEnvelope?.payload;
    if (typeof payload !== 'string') continue;
    try {
      statements.push(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')));
    } catch {
      /* rejected below */
    }
  }
  return statements;
}

export function verifyNpmProvenance(audit, { name, version, integrity, sourceRevision }) {
  const verified = audit?.verified?.find((item) => item.name === name && item.version === version);
  const expectedSubject = packagePurl(name, version);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? ''))
    throw new Error(`${name}@${version} has malformed expected integrity`);
  const expectedSha512 = Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex');
  const matched = decodedStatements(verified).some((statement) =>
    matchesNpmProvenance(statement, expectedSubject, expectedSha512, sourceRevision),
  );
  if (matched) return { name, version, sourceRevision, workflow: RELEASE_WORKFLOW };
  throw new Error(`${name}@${version} lacks canonical source-bound npm provenance`);
}

function hasExpectedSubject(statement, expectedSubject, expectedSha512) {
  return statement?.subject?.some((item) => item.name === expectedSubject && item.digest?.sha512 === expectedSha512);
}

function hasExpectedSource(statement, sourceRevision) {
  const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies;
  if (!Array.isArray(dependencies)) return false;
  return dependencies.some(
    (item) =>
      item?.digest?.gitCommit === sourceRevision &&
      item?.uri === `git+https://github.com/${GITHUB_REPOSITORY}@refs/heads/main`,
  );
}

function hasCanonicalWorkflow(statement) {
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
  return hasCanonicalWorkflowReference(workflow) && hasCanonicalWorkflowRun(statement);
}

function hasCanonicalWorkflowReference(workflow) {
  return (
    workflow?.repository === `https://github.com/${GITHUB_REPOSITORY}` &&
    workflow?.ref === 'refs/heads/main' &&
    String(workflow?.path ?? '').replace(/^\//, '') === RELEASE_WORKFLOW
  );
}

function hasCanonicalWorkflowRun(statement) {
  const github = statement?.predicate?.buildDefinition?.internalParameters?.github;
  return (
    github?.event_name === 'workflow_dispatch' &&
    statement?.predicate?.runDetails?.builder?.id === 'https://github.com/actions/runner/github-hosted'
  );
}

function matchesNpmProvenance(statement, expectedSubject, expectedSha512, sourceRevision) {
  if (statement?.predicateType !== 'https://slsa.dev/provenance/v1') return false;
  return (
    hasExpectedSubject(statement, expectedSubject, expectedSha512) &&
    hasExpectedSource(statement, sourceRevision) &&
    hasCanonicalWorkflow(statement)
  );
}

export function expectedIntegrity(bytes, item) {
  if (bytes.byteLength !== item.bytes)
    throw new Error(`${item.name} tarball byte length differs from the candidate manifest`);
  if (sha256(bytes) !== item.sha256)
    throw new Error(`${item.name} tarball SHA-256 differs from the candidate manifest`);
  const integrity = sha512Integrity(bytes);
  if (integrity !== item.integrity)
    throw new Error(`${item.name} tarball integrity differs from the candidate manifest`);
  return integrity;
}
