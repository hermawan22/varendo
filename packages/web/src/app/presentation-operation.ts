import type { WebRegion } from './context.js';

export interface PresentationOperation {
  readonly signal: AbortSignal;
  active(): boolean;
  close(): void;
}

/** Stops a previous presentation commit as soon as a newer render takes ownership. */
export function cancelPendingPresentation(region: WebRegion): void {
  const controller = region.presentationAbort;
  if (controller === undefined) return;
  delete region.presentationAbort;
  controller.abort();
}

export function beginPresentation(region: WebRegion, parent?: AbortSignal): PresentationOperation {
  cancelPendingPresentation(region);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  region.presentationAbort = controller;
  return {
    signal: controller.signal,
    active: () => region.presentationAbort === controller && !controller.signal.aborted,
    close: () => {
      parent?.removeEventListener('abort', abort);
      if (region.presentationAbort === controller) delete region.presentationAbort;
    },
  };
}

export function presentationCurrent(
  region: WebRegion,
  expectedSequence: number,
  operation: PresentationOperation,
): boolean {
  return region.sequence === expectedSequence && operation.active();
}
