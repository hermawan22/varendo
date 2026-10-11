import { parseWireValue, type Diagnostic, type Outcome } from '@varendo/core';
import type { AppAuthorityContext } from '@varendo/runtime/app';
import type { ScopeLeaveDecision } from '@varendo/runtime/scopes';
import { diagnostic, type WebAppContext, type WebRegion } from './context.js';
import { cancelActiveAction } from './interaction.js';
import type { WebRenderInput, WebRenderReceipt } from './types.js';

const ABORTED = Symbol('draft-exit-aborted');
type Draft = WebRegion['drafts'] extends Map<string, infer Value> ? Value : never;

interface Capture {
  readonly sequence: number;
  readonly revision: number;
  readonly drafts: ReadonlyMap<string, Draft>;
  readonly authority: string;
  readonly previousDenial: ReturnType<WebAppContext['runtime']['snapshot']>;
}

type DraftExitResult =
  | { readonly ok: false; readonly receipt: WebRenderReceipt }
  | {
      readonly ok: true;
      readonly input: WebRenderInput;
      readonly authority: string;
      current(): WebRenderReceipt | undefined;
      committed(): void;
    };

function receipt(
  region: WebRegion,
  status: 'cancelled' | 'denied' | 'failed' | 'needs-input',
  message: string,
  diagnostics?: readonly Diagnostic[],
): WebRenderReceipt {
  const [first, ...rest] = diagnostics ?? [];
  return {
    status,
    regionId: region.id,
    requestId: ('draft-exit-' + region.id + '-' + region.sequence).slice(0, 160),
    diagnostics: first === undefined ? [diagnostic('web.app.draft-' + status, message)] : [first, ...rest],
  };
}

function denied(region: WebRegion, diagnostics?: readonly Diagnostic[]): WebRenderReceipt {
  cancelActiveAction(region);
  region.values.clear();
  region.drafts.clear();
  delete region.last;
  delete region.renderedAuthority;
  region.element.revoke();
  return receipt(region, 'denied', 'The draft owner is no longer authorized.', diagnostics);
}

function authorityKey(authority: AppAuthorityContext): string {
  return JSON.stringify([
    authority.principalKey,
    authority.scopeDigest,
    authority.policyRevision,
    authority.experienceRevision,
    [...authority.grants].sort(),
  ]);
}

function readAuthority(
  context: WebAppContext,
  region: WebRegion,
  signal: AbortSignal,
  enforcePrior: boolean,
): Outcome<string> {
  const unavailable = (): Outcome<never> => ({
    ok: false,
    diagnostics: [diagnostic('web.app.draft-denied', 'The draft owner is no longer authorized.')],
  });
  try {
    const result = context.options.authority.read({
      resourceId: region.resourceId,
      regionId: region.id,
      effect: 'render',
      signal,
    });
    if (!result.ok) return result;
    const value = result.value;
    const prior = enforcePrior ? region.last?.receipt.region.readSet : undefined;
    if (
      prior !== undefined &&
      (prior.scopeDigest !== value.scopeDigest ||
        prior.policyRevision !== value.policyRevision ||
        prior.experienceRevision !== value.experienceRevision)
    )
      return unavailable();
    return { ok: true, value: authorityKey(value) };
  } catch {
    return unavailable();
  }
}

function sameDrafts(region: WebRegion, capture: Capture): boolean {
  return (
    (region.draftRevision ?? 0) === capture.revision &&
    region.drafts.size === capture.drafts.size &&
    [...capture.drafts].every(([key, value]) => region.drafts.get(key) === value)
  );
}

function current(
  context: WebAppContext,
  region: WebRegion,
  capture: Capture,
  signal: AbortSignal,
): WebRenderReceipt | undefined {
  if (context.disposed || context.regions.get(region.id) !== region || region.sequence !== capture.sequence)
    return receipt(region, 'cancelled', 'A newer render or disposal replaced the draft exit.');
  const state = context.runtime.snapshot(region.id);
  if (state?.phase === 'denied' && state !== capture.previousDenial) return denied(region, state.diagnostics);
  if (signal.aborted) return receipt(region, 'cancelled', 'The draft exit was cancelled.');
  const authority = readAuthority(context, region, signal, capture.drafts.size > 0);
  if (!authority.ok) return denied(region, authority.diagnostics);
  if (authority.value !== capture.authority) return denied(region);
  if (!sameDrafts(region, capture)) return receipt(region, 'cancelled', 'The draft changed during the exit decision.');
  return undefined;
}

function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function awaitDecision<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const abort = () => resolve(ABORTED);
    signal.addEventListener('abort', abort, { once: true });
    try {
      Promise.resolve(work())
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

async function saveDecision(
  decision: Extract<ScopeLeaveDecision, { status: 'save' }>,
  signal: AbortSignal,
): Promise<boolean | typeof ABORTED> {
  try {
    const saved = await awaitDecision<Outcome<void>>(() => decision.save({ signal }), signal);
    if (saved === ABORTED) return ABORTED;
    return saved?.ok === true;
  } catch {
    return false;
  }
}

function permittedDecision(
  decision: ScopeLeaveDecision | typeof ABORTED,
  region: WebRegion,
): WebRenderReceipt | undefined {
  if (decision === ABORTED) return receipt(region, 'cancelled', 'The draft exit was cancelled.');
  if (decision?.status === 'discard' || (decision?.status === 'save' && typeof decision.save === 'function'))
    return undefined;
  return receipt(region, 'needs-input', 'Save or discard the current draft before rendering another intent.');
}

async function resolveDecision(
  context: WebAppContext,
  region: WebRegion,
  input: WebRenderInput,
  capture: Capture,
  signal: AbortSignal,
): Promise<WebRenderReceipt | undefined> {
  const decision = await awaitDecision(
    () =>
      context.options.onDraftExit?.(
        Object.freeze({
          regionId: region.id,
          intent: input.intent,
          drafts: frozen(structuredClone([...capture.drafts.values()])),
          revision: String(capture.revision),
          signal,
        }),
      ) ?? { status: 'needs-input' as const },
    signal,
  );
  const blocked = current(context, region, capture, signal) ?? permittedDecision(decision, region);
  if (blocked !== undefined) return blocked;
  if (decision === ABORTED || decision.status !== 'save') return undefined;
  const saved = await saveDecision(decision, signal);
  const afterSave = current(context, region, capture, signal);
  if (afterSave !== undefined) return afterSave;
  return saved === true ? undefined : receipt(region, 'failed', 'The host could not save the current draft.');
}

function captureDrafts(context: WebAppContext, region: WebRegion, authority: string): Capture {
  const previous = context.runtime.snapshot(region.id);
  return {
    sequence: region.sequence,
    revision: region.draftRevision ?? 0,
    drafts: new Map(region.drafts),
    authority,
    previousDenial: previous?.phase === 'denied' ? previous : undefined,
  };
}

/** A host exit choice cannot override current ownership, authority, or a later edit. */
export async function guardDraftExit(
  context: WebAppContext,
  region: WebRegion,
  input: WebRenderInput,
  signal: AbortSignal,
): Promise<DraftExitResult> {
  const cancelled = () => receipt(region, 'cancelled', 'The draft exit was cancelled.');
  if (signal.aborted) return { ok: false, receipt: cancelled() };
  const dirty = region.drafts.size > 0;
  const authority = readAuthority(context, region, signal, dirty);
  if (!authority.ok) return { ok: false, receipt: denied(region, authority.diagnostics) };
  if (dirty && region.renderedAuthority !== undefined && region.renderedAuthority !== authority.value)
    return { ok: false, receipt: denied(region) };
  const wire = parseWireValue(input.intent);
  if (!wire.ok)
    return { ok: false, receipt: receipt(region, 'failed', 'The requested intent is not a bounded wire value.') };
  const capturedInput = { ...input, intent: frozen(structuredClone(wire.value)) };
  const capture = captureDrafts(context, region, authority.value);
  try {
    const blocked = dirty ? await resolveDecision(context, region, capturedInput, capture, signal) : undefined;
    if (blocked !== undefined) return { ok: false, receipt: blocked };
    return {
      ok: true,
      input: capturedInput,
      authority: authority.value,
      current: () => current(context, region, capture, signal),
      committed: () => {
        region.renderedAuthority = authority.value;
      },
    };
  } catch {
    return {
      ok: false,
      receipt:
        current(context, region, capture, signal) ?? receipt(region, 'failed', 'The host draft exit decision failed.'),
    };
  }
}
