#!/usr/bin/env node
/** Fail-closed, resumable publication of an already verified candidate. */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { classifyRegistryVersionResponse, packageTarballName, readJson } from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import {
  NPM_REGISTRY,
  assertCandidateIdentity,
  assertCandidateTarball,
  classifyRegistryPackageResponse,
  assertRegistryVersionNotUnpublished,
  assertTagMayAdvance,
  assertTrustedPublishingContext,
  expectedIntegrity,
  fetchRegistryJson,
} from './publication-lib.mjs';
import { run, runBuffer } from './run.mjs';
import { RELEASE_SOURCE_STATUS_ARGS, assertReleaseSourceClean } from './source-state.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const candidatePath = resolve(root, flagValue(args, '--candidate') ?? 'artifacts/release-candidate/manifest.json');
const output = resolve(root, flagValue(args, '--output') ?? 'artifacts/release-candidate/publication.json');
const tag = flagValue(args, '--tag');
if (!/^(next|latest)$/.test(tag ?? '')) throw new Error('--tag must be next for an RC or latest for a stable release');
if (relative(root, candidatePath).startsWith('..') || relative(root, output).startsWith('..'))
  throw new Error('Release paths must remain inside the repository');
const candidate = await readJson(candidatePath);
assertCandidateIdentity(candidate, { tag });

function gitOutput(commandArgs) {
  return run('git', commandArgs, {
    cwd: root,
    timeout: 30_000,
    describeFailure: () => new Error(`git ${commandArgs.join(' ')} failed`),
  });
}
function tarBuffer(commandArgs) {
  return runBuffer('tar', commandArgs, {
    cwd: root,
    timeout: 30_000,
    describeFailure: () => new Error(`tar ${commandArgs.join(' ')} failed`),
  });
}
function publishTarball(path) {
  const publishArgs = ['publish', path, '--access', 'public', '--registry', NPM_REGISTRY, '--provenance'];
  publishArgs.push('--tag', tag);
  run('npm', publishArgs, {
    cwd: root,
    timeout: 300_000,
    describeFailure: (result) => new Error(`npm publish failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`),
  });
}

async function waitForRegistryPublication(item, expectedVersion) {
  let after;
  let afterPackage;
  // The versioned registry document can take several minutes to propagate
  // after publish; allow up to ten minutes before declaring failure.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (attempt) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));
    try {
      after = await registryState(item);
      afterPackage = await registryPackage(item);
    } catch (error) {
      if (attempt === 23) throw error;
    }
    if (after?.state === 'verified-existing' && afterPackage?.selected === expectedVersion) break;
  }
  return { after, afterPackage };
}
async function registryState(item) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(item.name)}/${encodeURIComponent(candidate.version)}`;
  const { status, payload } = await fetchRegistryJson(url);
  return classifyRegistryVersionResponse(status, payload, item.name, candidate.version, item.integrity);
}
async function registryPackage(item) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(item.name)}`;
  const { status, payload } = await fetchRegistryJson(url, { strictJson: true });
  return classifyRegistryPackageResponse(status, payload, item.name, tag);
}

const head = gitOutput(['rev-parse', 'HEAD']);
if (candidate.sourceRevision !== head) throw new Error('Candidate source revision differs from the checked-out source');
assertReleaseSourceClean(gitOutput(RELEASE_SOURCE_STATUS_ARGS), 'Publishing a release candidate');
assertTrustedPublishingContext(process.env, candidate.sourceRevision);

const prepared = [];
const [canonicalLicense, canonicalNotice] = await Promise.all([
  readFile(resolve(root, 'LICENSE')),
  readFile(resolve(root, 'NOTICE')),
]);
for (const item of candidate.packages) {
  if (basename(item.file) !== item.file || item.file !== packageTarballName(item.name, candidate.version))
    throw new Error(`Unsafe candidate tarball name for ${item.name}`);
  const tarball = resolve(dirname(candidatePath), item.file);
  if (relative(dirname(candidatePath), tarball).startsWith('..'))
    throw new Error(`Candidate tarball escapes its directory for ${item.name}`);
  expectedIntegrity(await readFile(tarball), item);
  const paths = tarBuffer(['-tzf', tarball]).toString('utf8').split('\n').filter(Boolean).sort();
  let manifest;
  try {
    manifest = JSON.parse(tarBuffer(['-xOzf', tarball, 'package/package.json']).toString('utf8'));
  } catch {
    throw new Error(`${item.name} packed package.json is invalid`);
  }
  assertCandidateTarball({
    item,
    candidateVersion: candidate.version,
    manifest,
    paths,
    license: tarBuffer(['-xOzf', tarball, 'package/LICENSE']),
    notice: tarBuffer(['-xOzf', tarball, 'package/NOTICE']),
    canonicalLicense,
    canonicalNotice,
  });
  const before = await registryState(item);
  const registryPackageState = await registryPackage(item);
  assertRegistryVersionNotUnpublished(item.name, candidate.version, registryPackageState);
  assertTagMayAdvance({
    name: item.name,
    tag,
    desiredVersion: candidate.version,
    currentVersion: registryPackageState.selected,
    versionAlreadyExists: before.state === 'verified-existing',
  });
  prepared.push({ item, tarball, before });
}

const report = {
  schema: 'varendo.npm-publication.v2',
  sourceRevision: candidate.sourceRevision,
  version: candidate.version,
  tag,
  mode: 'trusted-publishing',
  startedAt: new Date().toISOString(),
  packages: [],
};
for (const { item, tarball, before } of prepared) {
  let action = 'verified-existing';
  if (before.state === 'absent') {
    publishTarball(tarball);
    action = 'published';
  }
  const { after, afterPackage } = await waitForRegistryPublication(item, candidate.version);
  if (after?.state !== 'verified-existing')
    throw new Error(`Registry did not expose verified ${item.name}@${candidate.version} after publication`);
  if (afterPackage?.selected !== candidate.version)
    throw new Error(`Registry dist-tag ${tag} does not select verified ${item.name}@${candidate.version}`);
  report.packages.push({ name: item.name, integrity: item.integrity, distTag: tag, action });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
report.completedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    { version: report.version, tag, mode: report.mode, packages: report.packages.length, publicationRecord: output },
    null,
    2,
  ),
);
