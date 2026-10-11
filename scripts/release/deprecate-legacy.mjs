#!/usr/bin/env node
/**
 * Inspect, then optionally deprecate the exact allowlisted obsolete lineages.
 * npm has no archive operation for a package lineage; deprecation is the
 * reversible registry marker while Git/source history remains preserved.
 */
import { resolve } from 'node:path';
import { PUBLIC_PACKAGE_NAMES, RELEASE_VERSION, readJson } from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import { NPM_REGISTRY, fetchRegistryJson } from './publication-lib.mjs';
import { LEGACY_LINEAGES, classifyExactPackage, legacyDeprecationMessage } from './legacy-lineage-lib.mjs';
import { run } from './run.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const confirmation = process.env.AELIQO_CONFIRM_LEGACY_DEPRECATION;
const expectedConfirmation = 'deprecate-devtools-after-v0.4.0';
const candidatePath = resolve(flagValue(argv, '--candidate') ?? 'artifacts/release-candidate/manifest.json');

async function registryPackage(name, version, expectedIntegrity) {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const { status, payload } = await fetchRegistryJson(url);
  return classifyExactPackage(status, payload, name, version, expectedIntegrity);
}

function npm(args) {
  return run('npm', [...args, '--registry', NPM_REGISTRY], {
    cwd: process.cwd(),
    timeout: 120_000,
    describeFailure: (result) =>
      new Error(`npm ${args[0]} failed\n${result.error?.message ?? ''}\n${result.stderr ?? ''}`),
  });
}

let candidateByName = new Map();
if (apply) {
  const candidate = await readJson(candidatePath);
  if (candidate.version !== RELEASE_VERSION || candidate.packages?.length !== PUBLIC_PACKAGE_NAMES.length) {
    throw new Error('Verified stable candidate has an unexpected release identity');
  }
  candidateByName = new Map(candidate.packages.map((item) => [item.name, item]));
  if (
    candidateByName.size !== PUBLIC_PACKAGE_NAMES.length ||
    PUBLIC_PACKAGE_NAMES.some((name) => !candidateByName.has(name))
  ) {
    throw new Error('Verified stable candidate does not contain the exact public package set');
  }
}

const replacements = [];
for (const name of PUBLIC_PACKAGE_NAMES) {
  replacements.push({
    name,
    version: RELEASE_VERSION,
    ...(await registryPackage(name, RELEASE_VERSION, candidateByName.get(name)?.integrity)),
  });
}
const missingReplacements = replacements.filter((item) => item.state !== 'visible');

const legacy = [];
for (const lineage of LEGACY_LINEAGES) {
  const state = await registryPackage(lineage.name, lineage.version);
  legacy.push({
    name: lineage.name,
    version: lineage.version,
    replacement: lineage.replacement,
    state: state.state,
    currentDeprecation: state.deprecated,
    intendedDeprecation: legacyDeprecationMessage(lineage),
  });
}

if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: 'read-only',
        replacements,
        legacy,
        readyToDeprecate: missingReplacements.length === 0,
        blockers: missingReplacements.map((item) => `${item.name}@${item.version} is not visible`),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (missingReplacements.length) {
  throw new Error(
    `Refusing legacy deprecation until every replacement is visible: ${missingReplacements.map((item) => item.name).join(', ')}`,
  );
}
if (confirmation !== expectedConfirmation) {
  throw new Error(`Set AELIQO_CONFIRM_LEGACY_DEPRECATION=${expectedConfirmation} after owner approval`);
}
const authenticatedUser = npm(['whoami']);
const actions = [];
for (const item of legacy) {
  if (item.state === 'absent') {
    actions.push({ name: item.name, version: item.version, action: 'already-unpublished' });
    continue;
  }
  if (item.currentDeprecation === item.intendedDeprecation) {
    actions.push({ name: item.name, version: item.version, action: 'verified-existing' });
    continue;
  }
  npm(['deprecate', `${item.name}@${item.version}`, item.intendedDeprecation]);
  const after = await registryPackage(item.name, item.version);
  if (after.state !== 'visible' || after.deprecated !== item.intendedDeprecation) {
    throw new Error(`Registry did not expose the intended deprecation for ${item.name}@${item.version}`);
  }
  actions.push({ name: item.name, version: item.version, action: 'deprecated' });
}
console.log(JSON.stringify({ mode: 'applied', authenticatedUser, actions }, null, 2));
