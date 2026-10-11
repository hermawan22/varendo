import type { AeliqoDataComponentId, AeliqoDataManifest } from './data-registry-types.js';
import { AELIQO_DATA_CONFIG_SCHEMAS, AELIQO_DATA_REFS } from './data-registry-types.js';
import { resolveCollection, resolveFilterBuilder, resolveSelectionSummary } from './data-registry-views-collections.js';
import { resolveDelta, resolveDetail, resolveKeyValue, resolveMetric } from './data-registry-views-scalar.js';

function manifest(
  component: AeliqoDataComponentId,
  resolveConfig: AeliqoDataManifest['resolveConfig'],
): AeliqoDataManifest {
  return Object.freeze({
    ref: AELIQO_DATA_REFS[component],
    configSchema: AELIQO_DATA_CONFIG_SCHEMAS[component],
    result: 'required',
    resolveConfig,
  });
}

export function createDataManifests(): readonly AeliqoDataManifest[] {
  return Object.freeze([
    manifest('metric', (values, binding) => resolveMetric(values, binding)),
    manifest('delta', (values, binding) => resolveDelta(values, binding)),
    manifest('keyValue', (values, binding) => resolveKeyValue(values, binding)),
    manifest('detail', (values, binding) => resolveDetail(values, binding)),
    manifest('recordList', (values, binding, options) => resolveCollection(values, binding, options, 'recordList')),
    manifest('cardCollection', (values, binding, options) =>
      resolveCollection(values, binding, options, 'cardCollection'),
    ),
    manifest('table', (values, binding, options) => resolveCollection(values, binding, options, 'table')),
    manifest('filterBuilder', (values, binding) => resolveFilterBuilder(values, binding)),
    manifest('selectionSummary', (values, binding, options) => resolveSelectionSummary(values, binding, options)),
  ]);
}
