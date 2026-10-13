import type { VersionRef } from '@varendo/core';
import { createVarendoRuntime } from '@varendo/runtime/app';
import { STANDARD_RECIPES } from '../recipes/standard.js';
import type { VarendoApp, VarendoAppOptions, WebRenderReceipt } from './types.js';
import { createInteractionHandler } from './interaction.js';
import { createMountHandler } from './mount.js';
import { disposeApp, subscribeRegion, unmountRegion } from './lifecycle.js';
import { adaptRegion, renderRequest } from './render.js';
import { registryFor, type WebAppContext } from './context.js';

function assertUniqueRegistrations(values: readonly { readonly ref: VersionRef }[], kind: 'Recipe' | 'View'): void {
  const keys = values.map((value) => JSON.stringify([value.ref.id, value.ref.revision]));
  if (new Set(keys).size !== values.length) throw new TypeError(kind + ' registrations must be unique.');
}

function createContext(options: VarendoAppOptions): WebAppContext {
  const recipes = Object.freeze([...(options.recipes ?? STANDARD_RECIPES)]);
  const views = Object.freeze([...(options.views ?? [])]);
  if (recipes.length === 0 && (options.patterns?.length ?? 0) === 0)
    throw new TypeError('createVarendoApp requires at least one recipe or pattern.');
  assertUniqueRegistrations(recipes, 'Recipe');
  assertUniqueRegistrations(views, 'View');
  const registry = registryFor([], [], views, '', undefined, options);
  if (registry === undefined) throw new TypeError('Invalid presentation registrations.');
  const runtime = createVarendoRuntime(options);
  return {
    options,
    runtime,
    resources: new Map(options.resources.map((binding) => [binding.resource.id, binding.resource])),
    recipes,
    views,
    patterns: registry.patterns ?? [],
    stateMappings:
      registry.stateMappings?.filter((mapping) =>
        options.stateMappings?.some(
          (entry) => entry.ref.id === mapping.ref.id && entry.ref.revision === mapping.ref.revision,
        ),
      ) ?? [],
    regions: new Map(),
    stateListeners: new Map(),
    disposed: false,
  };
}

function observePresentation(context: WebAppContext, receipt: WebRenderReceipt | undefined): void {
  if (receipt?.status !== 'renderer-ready' || context.disposed) return;
  const region = context.regions.get(receipt.regionId);
  if (region?.element.presentation !== receipt.presentation) return;
  try {
    const pending = context.options.onPresentation?.(receipt);
    if (pending !== undefined) void Promise.resolve(pending).catch(() => {});
  } catch {
    /* Observers cannot invalidate a committed presentation. */
  }
}

export function createVarendoApp(options: VarendoAppOptions): VarendoApp {
  const context = createContext(options);
  const adapt = async (region: Parameters<typeof adaptRegion>[1]) => {
    const receipt = await adaptRegion(context, region);
    observePresentation(context, receipt);
    return receipt;
  };
  const handleInteraction = createInteractionHandler(context, (region) => {
    if (!region.pendingAdapt) return;
    queueMicrotask(() => {
      if (context.disposed || context.regions.get(region.id) !== region || region.actionPending) return;
      void adapt(region);
    });
  });
  const mount = createMountHandler(context, handleInteraction, adapt);
  return Object.freeze({
    runtime: context.runtime,
    mount,
    render: async (input) => {
      const receipt = await renderRequest(context, input);
      observePresentation(context, receipt);
      return receipt;
    },
    snapshot: (regionId) => context.runtime.snapshot(regionId),
    subscribe: (regionId, listener) => subscribeRegion(context, regionId, listener),
    unmount: (regionId) => unmountRegion(context, regionId),
    dispose: () => disposeApp(context),
  } satisfies VarendoApp);
}
