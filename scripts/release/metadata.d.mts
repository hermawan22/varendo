export const RELEASE_VERSION: string;
export const PUBLIC_PACKAGES: readonly string[];
export const PUBLIC_PACKAGE_NAMES: readonly string[];
export function releaseCandidateNumber(value: string | undefined): number | undefined;
export function isReleaseVersion(value: string | undefined): boolean;
