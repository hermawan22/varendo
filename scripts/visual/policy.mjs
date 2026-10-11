import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function approveInputs(metadata) {
  if (metadata.status !== 'approved') throw Error('Visual baseline has not been approved');
  if (!/^[a-f0-9]{40}$/u.test(metadata.baselineSHA ?? '')) throw Error('Expected immutable baselineSHA');
  if (!/^[a-f0-9]{64}$/u.test(metadata.fixtureSHA ?? '')) throw Error('Expected fixtureSHA');
  if (!hasReviewEvidence(metadata.review)) throw Error('Expected explicit review evidence');
  if (!/^sha256:[a-f0-9]{64}$/u.test(metadata.runner?.container ?? '') && !pinnedHost(metadata.runner?.hostImage)) {
    throw Error('Expected pinned container digest or hosted runner image identity');
  }
}

function hasReviewEvidence(review) {
  return typeof review === 'string' && review.trim().length > 0;
}

function pinnedHost(image) {
  return (
    image?.provider === 'github-actions' &&
    /^ubuntu[0-9]+$/u.test(image.os ?? '') &&
    /^[0-9]{8}\.[0-9]+\.[0-9]+$/u.test(image.version ?? '')
  );
}

export async function imageInventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await imageInventory(directory, path)));
    else if (entry.isFile() && entry.name.endsWith('.png')) files.push(path);
  }
  return files.sort();
}

export function sameInventory(first, second) {
  if (first.length === 0 || second.length === 0) throw Error('No PNG captures; refusing empty comparison');
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw Error('Screenshot inventory changed; review fixtures before replacing baseline');
}

export async function verifyRepeat(first, second) {
  const inventory = await imageInventory(first);
  sameInventory(inventory, await imageInventory(second));
  for (const file of inventory) {
    const a = await readFile(join(first, file));
    const b = await readFile(join(second, file));
    if (!a.equals(b)) throw Error(`Capture is nondeterministic: ${file}`);
  }
  return inventory;
}

export async function runCaptures({ baseline, candidate, capture, verify = verifyRepeat, compare }) {
  const first = await capture(baseline, 'baseline');
  const repeat = await capture(baseline, 'baseline-repeat');
  await verify(first, repeat);
  const next = await capture(candidate, 'candidate');
  const nextRepeat = await capture(candidate, 'candidate-repeat');
  await verify(next, nextRepeat);
  await compare(first, next);
}

export function verifyCandidateSource(before, after) {
  if (before.sha !== after.sha) throw Error('Candidate source changed during capture');
  if (!before.dirty && after.dirty) throw Error('Clean candidate became dirty during capture');
}
