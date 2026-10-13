import { createVarendoVisualizationPresentationManifests } from './visualization-registry.js';
import { createVarendoDataPresentationManifests } from './data-presentation.js';
import { createNavigationFeedbackPresentationManifests } from './navigation-feedback-registry.js';
import { createInputPresentationManifests } from './input-registry.js';
import { createFoundationPresentationManifests } from './foundation-registry.js';
import type { Outcome } from '@varendo/core';
import { createPresentationRegistry } from '@varendo/core/presentation';
import type { InteractionMappingManifest } from '@varendo/core/interaction';
import type { PresentationManifest, PresentationRegistry } from '@varendo/core/presentation';
import {
  VARENDO_CONFIG_SCHEMAS,
  VARENDO_OPERATION_REFS,
  VARENDO_PRESENTATION_REFS,
  type VarendoPresentationRegistryOptions,
} from './registry-contracts.js';
import { buildManifests } from './registry-base.js';

export { VARENDO_CONFIG_SCHEMAS, VARENDO_OPERATION_REFS, VARENDO_PRESENTATION_REFS };
export type { VarendoPresentationRegistryOptions };

function configuredGroups(options: VarendoPresentationRegistryOptions): Outcome<readonly PresentationManifest[]> {
  const foundation = createFoundationPresentationManifests(options.foundation);
  if (!foundation.ok) return foundation;
  const inputs = createInputPresentationManifests(options.inputs);
  if (!inputs.ok) return inputs;
  const navigationFeedback = createNavigationFeedbackPresentationManifests(options.navigationFeedback);
  if (!navigationFeedback.ok) return navigationFeedback;
  const entityOptions = trustedEntityOptions(options.resolveEntity);
  const data = createVarendoDataPresentationManifests(options.data ?? [], entityOptions);
  if (!data.ok) return data;
  const visualizations = createVarendoVisualizationPresentationManifests(options.visualizations ?? [], entityOptions);
  if (!visualizations.ok) return visualizations;
  return {
    ok: true,
    value: [...foundation.value, ...inputs.value, ...navigationFeedback.value, ...data.value, ...visualizations.value],
  };
}

function trustedEntityOptions(resolveEntity: VarendoPresentationRegistryOptions['resolveEntity']) {
  if (resolveEntity === undefined) return {};
  return { resolveEntity };
}

export function createSelectionIdentityMapping(
  entity: string,
  identity: readonly string[],
  grain: readonly string[] = identity,
): InteractionMappingManifest {
  const shape = { payload: 'selection' as const, entity, identity: [...identity], grain: [...grain] };
  return { ref: { id: 'selection.identity', revision: '1' }, source: shape, target: shape, kind: 'identity' };
}

interface RegistryArguments {
  readonly options: VarendoPresentationRegistryOptions;
  readonly mappings: readonly InteractionMappingManifest[];
}

function registryArguments(
  optionsOrMappings: VarendoPresentationRegistryOptions | readonly InteractionMappingManifest[],
  mappings: readonly InteractionMappingManifest[],
): RegistryArguments {
  if (Array.isArray(optionsOrMappings))
    return { options: {}, mappings: optionsOrMappings as readonly InteractionMappingManifest[] };
  return { options: optionsOrMappings as VarendoPresentationRegistryOptions, mappings };
}

export function createVarendoPresentationRegistry(
  options?: VarendoPresentationRegistryOptions,
  mappings?: readonly InteractionMappingManifest[],
): Outcome<PresentationRegistry>;
export function createVarendoPresentationRegistry(
  mappings?: readonly InteractionMappingManifest[],
): Outcome<PresentationRegistry>;
export function createVarendoPresentationRegistry(
  optionsOrMappings: VarendoPresentationRegistryOptions | readonly InteractionMappingManifest[] = {},
  mappings: readonly InteractionMappingManifest[] = [],
): Outcome<PresentationRegistry> {
  const args = registryArguments(optionsOrMappings, mappings);
  const groups = configuredGroups(args.options);
  if (!groups.ok) return groups;
  return createPresentationRegistry([...buildManifests(args.options), ...groups.value], args.mappings);
}
