#!/usr/bin/env node
import { resolve } from 'node:path';
import { readJson } from './candidate-lib.mjs';
import { flagValue } from './cli.mjs';
import { assertApprovedStable } from './publication-lib.mjs';
import { RELEASE_VERSION } from './metadata.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const candidatePath = flagValue(args, '--candidate');
const publicationPath = flagValue(args, '--publication');
const consumerPath = flagValue(args, '--consumer');
const sourceRevision = flagValue(args, '--source');
if (!candidatePath || !publicationPath || !consumerPath || !/^[0-9a-f]{40}$/u.test(sourceRevision ?? ''))
  throw new Error('Stable verification needs candidate, publication, consumer, and source SHA');

const [candidate, publication, consumer] = await Promise.all([
  readJson(resolve(root, candidatePath)),
  readJson(resolve(root, publicationPath)),
  readJson(resolve(root, consumerPath)),
]);
assertApprovedStable({ candidate, publication, consumer, version: RELEASE_VERSION, sourceRevision });
console.log(JSON.stringify({ version: RELEASE_VERSION, sourceRevision, packages: candidate.packages.length }));
