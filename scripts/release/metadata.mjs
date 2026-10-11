import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(import.meta.dirname, '../../release-metadata.json');
const metadata = JSON.parse(readFileSync(path, 'utf8'));
if (typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(metadata.version))
  throw new Error('Release metadata has an invalid stable version.');
if (
  typeof metadata.line !== 'string' ||
  !/^\d+\.\d+$/u.test(metadata.line) ||
  !metadata.version.startsWith(`${metadata.line}.`)
)
  throw new Error('Release metadata line does not match its stable version.');
if (
  !Array.isArray(metadata.publicPackages) ||
  new Set(metadata.publicPackages).size !== metadata.publicPackages.length ||
  metadata.publicPackages.some((name) => typeof name !== 'string' || !/^[a-z]+$/u.test(name))
)
  throw new Error('Release metadata has an invalid public package order.');

export const RELEASE_VERSION = metadata.version;
export const PUBLIC_PACKAGES = Object.freeze([...metadata.publicPackages]);
export const PUBLIC_PACKAGE_NAMES = Object.freeze(PUBLIC_PACKAGES.map((name) => `@varendo/${name}`));

const escapedVersion = RELEASE_VERSION.replaceAll('.', '\\.');
const candidatePattern = new RegExp(`^${escapedVersion}-rc\\.([1-9]\\d*)$`, 'u');

export function releaseCandidateNumber(value) {
  const match = candidatePattern.exec(value ?? '');
  return match === null ? undefined : Number(match[1]);
}

export function isReleaseVersion(value) {
  return value === RELEASE_VERSION || releaseCandidateNumber(value) !== undefined;
}
