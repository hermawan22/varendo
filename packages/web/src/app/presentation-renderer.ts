import type { Outcome } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import type { RegionSnapshot } from '@varendo/runtime/regions';
import type { RuntimePreparedRender } from '@varendo/runtime/app';
import type { AeliqoRegionResult } from '../region/types.js';
import { diagnostic, type WebAppContext, type WebRegion } from './context.js';
import type { PreparedPresentation } from './presentation-plan.js';
import { registerPresentationElements } from './presentation-elements.js';

function failure(code: string, message: string): Outcome<never> {
  return { ok: false, diagnostics: [diagnostic(code, message)] };
}

function owner(context: WebAppContext, region: WebRegion): string | undefined {
  try {
    const result = context.options.authority.read({
      regionId: region.id,
      resourceId: region.resourceId,
      effect: 'commit',
    });
    if (!result.ok) return undefined;
    const value = result.value;
    return JSON.stringify([
      value.principalKey,
      value.scopeDigest,
      value.policyRevision,
      value.experienceRevision,
      [...value.grants].sort(),
    ]);
  } catch {
    return undefined;
  }
}

export async function prepareRegisteredRenderer(
  context: WebAppContext,
  region: WebRegion,
  prepared: PreparedPresentation,
  results: readonly AeliqoRegionResult[],
  active: () => boolean,
): Promise<Outcome<ReturnType<typeof prepareRenderer>>> {
  const previousPresentation = region.element.presentation;
  const previousInteraction = region.element.interaction;
  const authority = owner(context, region);
  let loaded = true;
  try {
    const registry = region.element.ownerDocument.defaultView?.customElements;
    if (registry === undefined) throw new Error('No browser registry.');
    await registerPresentationElements(prepared.presentation, registry, context.views);
  } catch {
    loaded = false;
  }
  if (!active()) return failure('web.app.cancelled', 'The presentation was cancelled during element loading.');
  if (authority === undefined || owner(context, region) !== authority) {
    region.element.revoke();
    return failure('web.app.denied', 'Presentation authority changed during element loading.');
  }
  if (!loaded) return failure('web.app.registration', 'The required view elements could not be registered.');
  // Projection was prepared before loading; never overwrite an interaction accepted during that await.
  if (region.element.presentation !== previousPresentation || region.element.interaction !== previousInteraction)
    return failure('web.app.cancelled', 'The presentation or interaction changed during element loading.');
  return { ok: true, value: prepareRenderer(context, region, prepared, results, active) };
}

/** Reuses the mounted keyed tree; no candidate can publish outside the Region's final recheck. */
export function prepareRenderer(
  context: WebAppContext,
  region: WebRegion,
  prepared: PreparedPresentation,
  results: readonly AeliqoRegionResult[],
  active: () => boolean,
) {
  const element = region.element;
  const transaction = Symbol('presentation');
  const releaseGuard = () => {
    if (region.presentationTransaction === transaction) delete region.presentationTransaction;
  };
  const previous = {
    presentation: element.presentation,
    results: element.results,
    interaction: element.interaction,
    viewRenderers: element.viewRenderers,
  };
  const publication = element.preparePublication();
  const authority = owner(context, region);
  let applied: ValidatedPresentation | undefined;
  const live = () => !context.disposed && context.regions.get(region.id) === region;
  const unchanged = () =>
    element.presentation === previous.presentation && element.interaction === previous.interaction;
  function rollback(): void {
    if (applied === undefined || element.presentation !== applied || !live()) return;
    if (
      authority === undefined ||
      owner(context, region) !== authority ||
      context.runtime.snapshot(region.id)?.phase === 'denied'
    ) {
      element.revoke();
      return;
    }
    Object.assign(element, previous);
    try {
      publication.rollback();
    } catch {
      element.revoke();
    }
    applied = undefined;
  }
  function apply(next: RegionSnapshot): Outcome<void> {
    if (!live() || !active() || !unchanged())
      return failure('web.app.cancelled', 'The presentation or interaction changed during preparation.');
    if (authority === undefined || owner(context, region) !== authority)
      return failure('web.app.denied', 'Presentation authority changed during preparation.');
    const plan = next.state?.presentation;
    if (plan === undefined) return failure('web.app.renderer', 'The staged presentation is unavailable.');
    applied = { ...prepared.presentation, plan };
    region.presentationTransaction = transaction;
    try {
      element.viewRenderers = context.views;
      element.results = results;
      element.interaction = prepared.interaction;
      element.presentation = applied;
      publication.apply();
    } catch {
      rollback();
      return failure(
        'web.app.renderer',
        'The renderer failed before publication. Inspect the view callback before retrying.',
      );
    }
    if (!active() || !live()) return failure('web.app.cancelled', 'The presentation was cancelled during rendering.');
    return { ok: true, value: undefined };
  }
  const projection: RuntimePreparedRender = {
    presentation: prepared.presentation.plan,
    interaction: prepared.interaction ?? { version: '1', values: [], drafts: [] },
    apply,
    rollback,
  };
  const close = () => completePublication(publication, releaseGuard);
  return { projection, applied: () => applied, close };
}

function completePublication(publication: { complete(): void }, releaseGuard: () => void): void {
  try {
    publication.complete();
  } finally {
    releaseGuard();
  }
}
