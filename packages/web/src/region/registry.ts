import { createAeliqoVisualizationPresentationManifests } from './visualization-registry.js';
import { createAeliqoDataPresentationManifests } from './data-presentation.js';
import { createNavigationFeedbackPresentationManifests } from './navigation-feedback-registry.js';
import { createInputPresentationManifests } from './input-registry.js';
import { createFoundationPresentationManifests } from './foundation-registry.js';
import type { Outcome } from '@varendo/core';
import { createPresentationRegistry } from '@varendo/core/presentation';
import type { InteractionMappingManifest } from '@varendo/core/interaction';
import type { PresentationManifest, PresentationRegistry } from '@varendo/core/presentation';
import {
  AELIQO_CONFIG_SCHEMAS,
  AELIQO_OPERATION_REFS,
  AELIQO_PRESENTATION_REFS,
  type AeliqoPresentationRegistryOptions,
} from './registry-contracts.js';
import { buildManifests } from './registry-base.js';

export { AELIQO_CONFIG_SCHEMAS, AELIQO_OPERATION_REFS, AELIQO_PRESENTATION_REFS };
export type { AeliqoPresentationRegistryOptions };

function configuredGroups(options: AeliqoPresentationRegistryOptions): Outcome<readonly PresentationManifest[]> {
  const foundation = createFoundationPresentationManifests(options.foundation);
  if (!foundation.ok) return foundation;
  const inputs = createInputPresentationManifests(options.inputs);
  if (!inputs.ok) return inputs;
  const navigationFeedback = createNavigationFeedbackPresentationManifests(options.navigationFeedback);
  if (!navigationFeedback.ok) return navigationFeedback;
  const entityOptions = trustedEntityOptions(options.resolveEntity);
  const data = createAeliqoDataPresentationManifests(options.data ?? [], entityOptions);
  if (!data.ok) return data;
  const visualizations = createAeliqoVisualizationPresentationManifests(options.visualizations ?? [], entityOptions);
  if (!visualizations.ok) return visualizations;
  return {
    ok: true,
    value: [...foundation.value, ...inputs.value, ...navigationFeedback.value, ...data.value, ...visualizations.value],
  };
}

function trustedEntityOptions(resolveEntity: AeliqoPresentationRegistryOptions['resolveEntity']) {
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
  readonly options: AeliqoPresentationRegistryOptions;
  readonly mappings: readonly InteractionMappingManifest[];
}

function registryArguments(
  optionsOrMappings: AeliqoPresentationRegistryOptions | readonly InteractionMappingManifest[],
  mappings: readonly InteractionMappingManifest[],
): RegistryArguments {
  if (Array.isArray(optionsOrMappings))
    return { options: {}, mappings: optionsOrMappings as readonly InteractionMappingManifest[] };
  return { options: optionsOrMappings as AeliqoPresentationRegistryOptions, mappings };
}

export function createAeliqoPresentationRegistry(
  options?: AeliqoPresentationRegistryOptions,
  mappings?: readonly InteractionMappingManifest[],
): Outcome<PresentationRegistry>;
export function createAeliqoPresentationRegistry(
  mappings?: readonly InteractionMappingManifest[],
): Outcome<PresentationRegistry>;
export function createAeliqoPresentationRegistry(
  optionsOrMappings: AeliqoPresentationRegistryOptions | readonly InteractionMappingManifest[] = {},
  mappings: readonly InteractionMappingManifest[] = [],
): Outcome<PresentationRegistry> {
  const args = registryArguments(optionsOrMappings, mappings);
  const groups = configuredGroups(args.options);
  if (!groups.ok) return groups;
  return createPresentationRegistry([...buildManifests(args.options), ...groups.value], args.mappings);
}
