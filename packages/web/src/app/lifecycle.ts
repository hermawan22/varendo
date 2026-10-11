import type { RuntimeRegionState } from '@varendo/runtime/app';
import type { AeliqoApp } from './types.js';
import { cancelActiveAction } from './interaction.js';
import type { WebAppContext, WebRegion } from './context.js';
import { cancelPendingPresentation } from './presentation-operation.js';

type StateListener = Parameters<AeliqoApp['subscribe']>[1];

function notifyListeners(context: WebAppContext, regionId: string, state: RuntimeRegionState): void {
  for (const listener of [...(context.stateListeners.get(regionId) ?? [])]) {
    try {
      listener(state);
    } catch {
      /* State observers never control app lifecycle. */
    }
  }
}

export function bridgeRuntimeState(context: WebAppContext, region: WebRegion): void {
  if (region.runtimeSubscription !== undefined) return;
  region.runtimeSubscription = context.runtime.subscribe(region.id, (state) => {
    if (state.phase === 'denied' || state.phase === 'disposed') {
      region.renderAbort?.abort();
      cancelPendingPresentation(region);
      cancelActiveAction(region);
      region.values.clear();
      region.drafts.clear();
      delete region.last;
      delete region.renderedAuthority;
      region.element.revoke();
    }
    notifyListeners(context, region.id, state);
  });
  const current = context.runtime.snapshot(region.id);
  if (current !== undefined) notifyListeners(context, region.id, current);
}

export function subscribeRegion(context: WebAppContext, regionId: string, listener: StateListener): () => void {
  if (context.disposed) return () => {};
  const listeners = context.stateListeners.get(regionId) ?? new Set<StateListener>();
  listeners.add(listener);
  context.stateListeners.set(regionId, listeners);
  const region = context.regions.get(regionId);
  if (region !== undefined) bridgeRuntimeState(context, region);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    if (listeners.size === 0) context.stateListeners.delete(regionId);
  };
}

function releaseRegion(context: WebAppContext, region: WebRegion): void {
  region.sequence++;
  region.renderAbort?.abort();
  delete region.renderAbort;
  cancelPendingPresentation(region);
  cancelActiveAction(region);
  if (region.adaptFrame !== undefined) {
    region.target.ownerDocument.defaultView?.cancelAnimationFrame(region.adaptFrame);
    delete region.adaptFrame;
  }
  region.resize?.disconnect();
  delete region.resize;
  if (region.media !== undefined) {
    for (const list of region.media.lists) list.removeEventListener('change', region.media.onChange);
    delete region.media;
  }
  region.runtimeSubscription?.();
  region.element.dispose();
  region.element.remove();
  context.regions.delete(region.id);
}

export function unmountRegion(context: WebAppContext, regionId: string): boolean {
  const region = context.regions.get(regionId);
  if (region === undefined) return false;
  releaseRegion(context, region);
  return context.runtime.unmount(regionId);
}

export function disposeApp(context: WebAppContext): void {
  if (context.disposed) return;
  context.disposed = true;
  for (const region of context.regions.values()) releaseRegion(context, region);
  context.regions.clear();
  context.stateListeners.clear();
  context.runtime.dispose();
}
