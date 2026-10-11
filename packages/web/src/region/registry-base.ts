import type { Outcome, Result, VersionRef } from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationManifest,
  PresentationValues,
  ResolvedPresentationConfig,
} from '@varendo/core/presentation';
import {
  AELIQO_CONFIG_SCHEMAS,
  AELIQO_OPERATION_REFS,
  AELIQO_PRESENTATION_REFS,
  type AeliqoPresentationRegistryOptions,
} from './registry-contracts.js';
import { stackConfig } from './registry-config-common.js';
import { tableConfig } from './registry-config-table.js';
import { assessTrend, suggestTrend, trendConfig } from './registry-config-trend.js';
import { filterConfig, suggestFilter, suggestTable } from './registry-config-filter.js';

export function buildManifests(options: AeliqoPresentationRegistryOptions): readonly PresentationManifest[] {
  const defaultTableConfigs = new WeakMap<Result, Outcome<ResolvedPresentationConfig>>();
  const resolveEntity = options.resolveEntity;
  const manifests: PresentationManifest[] = [
    {
      ref: AELIQO_PRESENTATION_REFS.stack,
      configSchema: AELIQO_CONFIG_SCHEMAS.stack,
      roles: ['structure'],
      operations: [],
      result: 'none',
      children: { min: 0, max: 32 },
      visibility: 'simultaneous',
      extension: false,
      resolveConfig: stackConfig,
      suggestConfig: (): Outcome<PresentationValues> => ({ ok: true, value: {} }),
    },
    {
      ref: AELIQO_PRESENTATION_REFS.table,
      configSchema: AELIQO_CONFIG_SCHEMAS.table,
      roles: ['table'],
      operations: tableOperations(),
      result: 'required',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: false,
      resolveConfig: (values, result) => tableConfig(values, result, resolveEntity, defaultTableConfigs),
      suggestConfig: suggestTable,
      assess: (_config, _result, environment) => assessTable(environment),
    },
    {
      ref: AELIQO_PRESENTATION_REFS.trend,
      configSchema: AELIQO_CONFIG_SCHEMAS.trend,
      roles: ['trend', 'chart'],
      operations: [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze],
      result: 'required',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: false,
      resolveConfig: trendConfig,
      assess: assessTrend,
      suggestConfig: suggestTrend,
    },
    {
      ref: AELIQO_PRESENTATION_REFS.filter,
      configSchema: AELIQO_CONFIG_SCHEMAS.filter,
      roles: ['filter'],
      operations: [AELIQO_OPERATION_REFS.filter],
      result: 'required',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: false,
      resolveConfig: (values, result) => filterConfig(values, result, resolveEntity),
      suggestConfig: suggestFilter,
    },
  ];
  return Object.freeze(manifests);
}

function assessTable(environment: PresentationEnvironment) {
  const narrow = environment.inlineSize.state === 'known' && environment.inlineSize.value < 640;
  return {
    ok: true as const,
    value: {
      taskFit: narrow ? 70 : 90,
      informationDensity: narrow ? 65 : 90,
      interactionEffort: narrow ? 20 : 5,
      legibilityPenalty: narrow ? 10 : 0,
    },
  };
}

function tableOperations(): readonly VersionRef[] {
  return [
    AELIQO_OPERATION_REFS.read,
    AELIQO_OPERATION_REFS.compare,
    AELIQO_OPERATION_REFS.analyze,
    AELIQO_OPERATION_REFS.selection,
  ];
}
