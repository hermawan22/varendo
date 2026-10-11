#!/usr/bin/env node
import { resolve } from 'node:path';
import { readJson } from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import { assertApprovedRc } from './publication-lib.mjs';
import { RELEASE_VERSION, releaseCandidateNumber } from './metadata.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const candidatePath = flagValue(args, '--candidate');
const publicationPath = flagValue(args, '--publication');
const consumerPath = flagValue(args, '--consumer');
const version = flagValue(args, '--version');
const sourceRevision = flagValue(args, '--source');
const rc = releaseCandidateNumber(version);
if (
  !candidatePath ||
  !publicationPath ||
  !consumerPath ||
  rc === undefined ||
  rc < 1 ||
  !/^[0-9a-f]{40}$/.test(sourceRevision ?? '')
) {
  throw new Error(
    `Approved RC verification requires candidate/publication/consumer files, ${RELEASE_VERSION}-rc.N, and a full source SHA`,
  );
}
const [candidate, publication, consumer] = await Promise.all([
  readJson(resolve(root, candidatePath)),
  readJson(resolve(root, publicationPath)),
  readJson(resolve(root, consumerPath)),
]);
assertApprovedRc({ candidate, publication, consumer, version, sourceRevision });
console.log(
  JSON.stringify({ version, sourceRevision, packages: candidate.packages.length, provenanceVerified: true }, null, 2),
);
