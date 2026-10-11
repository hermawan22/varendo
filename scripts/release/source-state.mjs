/** Shared fail-closed source-state contract for release and public-doc artifacts. */

export const RELEASE_SOURCE_STATUS_ARGS = Object.freeze(['status', '--porcelain=v1', '--untracked-files=all']);

export function isReleaseSourceClean(status) {
  if (typeof status !== 'string') throw new TypeError('Git source status must be text');
  return status.trim() === '';
}

export function assertReleaseSourceClean(status, action) {
  if (!isReleaseSourceClean(status)) {
    throw new Error(`${action} requires a clean worktree with no tracked or non-ignored untracked changes`);
  }
}
