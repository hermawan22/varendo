import type { CatalogExampleId } from './types.js';
import { FOUNDATION_MOUNT_SOURCES } from './source-snippets-foundation.js';
import { INPUT_MOUNT_SOURCES } from './source-snippets-input.js';
import { NAVIGATION_MOUNT_SOURCES } from './source-snippets-navigation.js';
import { FEEDBACK_MOUNT_SOURCES } from './source-snippets-feedback.js';
import { DATA_MOUNT_SOURCES } from './source-snippets-data.js';
import { VISUALIZATION_MOUNT_SOURCES } from './source-snippets-visualization.js';
import { COMPOUND_MOUNT_SOURCES } from './source-snippets-compound.js';

export const CATALOG_MOUNT_SOURCES: Record<CatalogExampleId, string> = {
  ...FOUNDATION_MOUNT_SOURCES,
  ...INPUT_MOUNT_SOURCES,
  ...NAVIGATION_MOUNT_SOURCES,
  ...FEEDBACK_MOUNT_SOURCES,
  ...DATA_MOUNT_SOURCES,
  ...VISUALIZATION_MOUNT_SOURCES,
  ...COMPOUND_MOUNT_SOURCES,
};

export function catalogMountSource(id: CatalogExampleId): string {
  const source = CATALOG_MOUNT_SOURCES[id];
  if (source === undefined) throw new Error('Catalog mount source is missing for ' + id);
  return source;
}
