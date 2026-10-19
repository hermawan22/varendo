import type { Outcome, Result, VersionRef } from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationManifest,
  PresentationValues,
  ResolvedPresentationConfig,
} from '@varendo/core/presentation';
import {
  VARENDO_CONFIG_SCHEMAS,
  VARENDO_OPERATION_REFS,
  VARENDO_PRESENTATION_REFS,
  type VarendoPresentationRegistryOptions,
} from './registry-contracts.js';
import { stackConfig } from './registry-config-common.js';
import { tableConfig } from './registry-config-table.js';
import { assessTrend, suggestTrend, trendConfig } from './registry-config-trend.js';
import { filterConfig, suggestFilter, suggestTable } from './registry-config-filter.js';

export function buildManifests(options: VarendoPresentationRegistryOptions): readonly PresentationManifest[] {
  const defaultTableConfigs = new WeakMap<Result, Outcome<ResolvedPresentationConfig>>();
  const resolveEntity = options.resolveEntity;
  const manifests: PresentationManifest[] = [
    {
      ref: VARENDO_PRESENTATION_REFS.stack,
      configSchema: VARENDO_CONFIG_SCHEMAS.stack,
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
      ref: VARENDO_PRESENTATION_REFS.table,
      configSchema: VARENDO_CONFIG_SCHEMAS.table,
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
      ref: VARENDO_PRESENTATION_REFS.trend,
      configSchema: VARENDO_CONFIG_SCHEMAS.trend,
      roles: ['trend', 'chart'],
      operations: [VARENDO_OPERATION_REFS.read, VARENDO_OPERATION_REFS.compare, VARENDO_OPERATION_REFS.analyze],
      result: 'required',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: false,
      resolveConfig: trendConfig,
      assess: assessTrend,
      suggestConfig: suggestTrend,
    },
    {
      ref: VARENDO_PRESENTATION_REFS.filter,
      configSchema: VARENDO_CONFIG_SCHEMAS.filter,
      roles: ['filter'],
      operations: [VARENDO_OPERATION_REFS.filter],
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
    VARENDO_OPERATION_REFS.read,
    VARENDO_OPERATION_REFS.compare,
    VARENDO_OPERATION_REFS.analyze,
    VARENDO_OPERATION_REFS.selection,
  ];
}
