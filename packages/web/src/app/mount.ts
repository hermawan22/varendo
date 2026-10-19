import type { VarendoApp } from './types.js';
import type { VarendoSemanticInteractionRequest } from '../region/types.js';
import { registerBaseElements } from '../register-base.js';
import { VarendoRegionElement } from '../region/varendo-region.js';
import { bridgeRuntimeState } from './lifecycle.js';
import {
  ADAPTIVE_MEDIA_QUERIES,
  category,
  diagnostic,
  interactionLocked,
  type WebAppContext,
  type WebRegion,
} from './context.js';
import type { WebMountInput } from './types.js';

type MountResult = ReturnType<VarendoApp['mount']>;
type InteractionHandler = (region: WebRegion, request: VarendoSemanticInteractionRequest) => Promise<void>;
type AdaptRegion = (region: WebRegion) => Promise<unknown>;
type ResizeObserverConstructor = new (callback: ResizeObserverCallback) => ResizeObserver;
type WindowWithResizeObserver = Window & { readonly ResizeObserver?: ResizeObserverConstructor };

function mountFailure(code: string, message: string): MountResult {
  return { ok: false, diagnostics: [diagnostic(code, message)] };
}

function targetWindow(input: WebMountInput): Window | undefined {
  const view = input.target?.ownerDocument?.defaultView;
  if (view === null || view === undefined || !(input.target instanceof view.HTMLElement)) return undefined;
  return view;
}

function registerElements(view: Window): boolean {
  try {
    registerBaseElements(view.customElements);
    return true;
  } catch {
    return false;
  }
}

function attachRegion(input: WebMountInput): VarendoRegionElement | undefined {
  try {
    const element = input.target.ownerDocument.createElement('varendo-region') as VarendoRegionElement;
    element.setAttribute('data-varendo-app-region', input.regionId);
    input.target.append(element);
    return element;
  } catch {
    return undefined;
  }
}

function createRegion(input: WebMountInput, element: VarendoRegionElement): WebRegion {
  return {
    id: input.regionId,
    resourceId: input.resourceId,
    target: input.target,
    element,
    sequence: 0,
    category: category(input.target.getBoundingClientRect().width, 'unknown'),
    composing: false,
    pendingAdapt: false,
    actionPending: false,
    actionSequence: 0,
    values: new Map(),
    drafts: new Map(),
  };
}

function scheduleAdapt(region: WebRegion, view: Window, adapt: AdaptRegion): void {
  if (region.adaptFrame !== undefined) return;
  region.adaptFrame = view.requestAnimationFrame(() => {
    delete region.adaptFrame;
    if (region.resize === undefined && region.media === undefined) return;
    void adapt(region);
  });
}

function observeSize(region: WebRegion, view: Window, adapt: AdaptRegion): void {
  const Observer = (view as WindowWithResizeObserver).ResizeObserver;
  if (Observer === undefined) return;
  let previous = region.target.getBoundingClientRect();
  const resize = new Observer(() => {
    const bounds = region.target.getBoundingClientRect();
    if (bounds.width === previous.width && bounds.height === previous.height) return;
    previous = bounds;
    region.category = category(bounds.width, region.category);
    scheduleAdapt(region, view, adapt);
  });
  region.resize = resize;
  resize.observe(region.target, { box: 'border-box' });
}

function observeMedia(region: WebRegion, view: Window, adapt: AdaptRegion): void {
  if (typeof view.matchMedia !== 'function') return;
  const onChange = (): void => {
    scheduleAdapt(region, view, adapt);
  };
  const lists: MediaQueryList[] = [];
  for (const query of ADAPTIVE_MEDIA_QUERIES) {
    const list = view.matchMedia(query);
    if (typeof list.addEventListener !== 'function') continue;
    list.addEventListener('change', onChange);
    lists.push(list);
  }
  if (lists.length === 0) return;
  region.media = { lists: Object.freeze(lists), onChange };
}

function releasePendingAdapt(region: WebRegion, adapt: AdaptRegion): void {
  if (!region.pendingAdapt) return;
  void adapt(region);
}

function installCompositionListeners(region: WebRegion, adapt: AdaptRegion): void {
  region.element.addEventListener('compositionstart', () => {
    region.composing = true;
  });
  region.element.addEventListener('compositionend', () => {
    region.composing = false;
    releasePendingAdapt(region, adapt);
  });
}

function installFocusListener(region: WebRegion, adapt: AdaptRegion): void {
  region.element.addEventListener('focusout', () => {
    if (!region.pendingAdapt) return;
    queueMicrotask(() => {
      if (!interactionLocked(region)) void adapt(region);
    });
  });
}

function installRegionListeners(
  region: WebRegion,
  view: Window,
  interaction: InteractionHandler,
  adapt: AdaptRegion,
): void {
  region.element.onSemanticInteraction = (request) => {
    void interaction(region, request);
  };
  observeSize(region, view, adapt);
  observeMedia(region, view, adapt);
  installCompositionListeners(region, adapt);
  installFocusListener(region, adapt);
}

function mountRegion(
  context: WebAppContext,
  input: WebMountInput,
  view: Window,
  interaction: InteractionHandler,
  adapt: AdaptRegion,
): MountResult {
  const mounted = context.runtime.mount({ regionId: input.regionId, resourceId: input.resourceId });
  if (!mounted.ok) return mounted;
  const element = attachRegion(input);
  if (element === undefined) {
    context.runtime.unmount(input.regionId);
    return mountFailure('web.app.mount', 'The Varendo Region could not be attached to the target.');
  }
  const region = createRegion(input, element);
  installRegionListeners(region, view, interaction, adapt);
  context.regions.set(input.regionId, region);
  bridgeRuntimeState(context, region);
  return { ok: true, value: element };
}

export function createMountHandler(
  context: WebAppContext,
  interaction: InteractionHandler,
  adapt: AdaptRegion,
): VarendoApp['mount'] {
  return (input) => {
    if (context.disposed) return mountFailure('web.app.disposed', 'The Varendo app is disposed.');
    const view = targetWindow(input);
    if (view === undefined) return mountFailure('web.app.target', 'Mount target must be an HTMLElement.');
    if (context.regions.has(input.regionId))
      return mountFailure('web.app.duplicate', 'Region ' + input.regionId + ' is already mounted.');
    if (!registerElements(view))
      return mountFailure('web.app.registration', 'Varendo elements could not be registered in this document.');
    return mountRegion(context, input, view, interaction, adapt);
  };
}
