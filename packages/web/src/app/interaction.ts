import { parseInteractionState } from '@varendo/core/interaction';
import type { Diagnostic, InteractionPayload } from '@varendo/core';
import type {
  ActionExecution,
  ActionOutcome,
  ActionPort,
  ActionPreview,
  ActionRequest as RuntimeActionRequest,
} from '@varendo/runtime/actions';
import type { AeliqoSemanticInteractionRequest } from '../region/types.js';
import type { AeliqoAppActionEvent } from './types.js';
import { diagnostic, type WebAppContext, type WebRegion } from './context.js';
import { resetSavedFormControls } from './form-reset.js';
import { cancelPendingPresentation } from './presentation-operation.js';

type ActionRequestPayload = Extract<InteractionPayload, { readonly kind: 'action-request' }>;
type RegionValuePayload = Extract<
  InteractionPayload,
  { readonly kind: 'selection' | 'filter' | 'range' | 'group' | 'page' }
>;
type ActionSettled = (region: WebRegion) => void;

const REGION_VALUE_KINDS: ReadonlySet<InteractionPayload['kind']> = new Set([
  'selection',
  'filter',
  'range',
  'group',
  'page',
]);

interface ActionCapture {
  readonly actionSequence: number;
  readonly taskRevision: string;
  readonly authority: string | undefined;
  readonly drafts: ReadonlyMap<string, Extract<InteractionPayload, { readonly kind: 'draft' }>>;
}

interface ActionSession {
  readonly capture: ActionCapture;
  active: boolean;
  readonly controller: AbortController;
  readonly preview: ActionPreview;
  readonly settled?: () => void;
  cancel?: () => boolean;
}

function notifyAction(context: WebAppContext, event: AeliqoAppActionEvent): void {
  try {
    const pending = context.options.onActionEvent?.(event);
    if (pending !== undefined) void Promise.resolve(pending).catch(() => {});
  } catch {
    /* Application observers never control action authority. */
  }
}

export function cancelActiveAction(region: WebRegion): void {
  region.actionAbort?.abort();
  delete region.actionAbort;
  const cancel = region.cancelAction;
  delete region.cancelAction;
  cancel?.();
  region.actionPending = false;
}

function publishInteraction(region: WebRegion): void {
  const state = parseInteractionState({
    version: '1',
    values: [...region.values.values()],
    drafts: [...region.drafts.values()].map((draft) => ({
      domain: 'app.form',
      entity: draft.entity,
      key: draft.key,
      field: draft.field,
      value: draft.value,
      entityRevision: draft.entityRevision,
    })),
  });
  if (state.ok) region.element.interaction = state.value;
}

function saveInteraction(region: WebRegion, request: AeliqoSemanticInteractionRequest): void {
  const payload = request.payload;
  if (payload.kind === 'draft') {
    region.draftRevision = (region.draftRevision ?? 0) + 1;
    region.renderAbort?.abort();
    region.drafts.set(JSON.stringify([payload.entity, payload.key, payload.field]), payload);
    delete region.actionAttempt;
    publishInteraction(region);
    return;
  }
  if (!isRegionValue(payload)) return;
  region.values.set(JSON.stringify([request.nodeId, request.portId]), {
    nodeId: request.nodeId,
    portId: request.portId,
    payload,
  });
  publishInteraction(region);
}

function isRegionValue(payload: InteractionPayload): payload is RegionValuePayload {
  return REGION_VALUE_KINDS.has(payload.kind);
}

function clearPendingAction(region: WebRegion, session: ActionSession): void {
  if (region.actionAbort !== session.controller) return;
  if (region.actionAbort === session.controller) delete region.actionAbort;
  if (region.cancelAction === session.cancel) delete region.cancelAction;
  region.actionPending = false;
  session.settled?.();
}

function cancelPreview(port: ActionPort, region: WebRegion, session: ActionSession): boolean {
  if (!session.active) return false;
  const cancelled = port.cancel(session.preview);
  if (!cancelled) return false;
  session.active = false;
  clearPendingAction(region, session);
  return true;
}

function inactiveAction(): ActionOutcome<ActionExecution> {
  return {
    ok: false,
    diagnostics: [diagnostic('web.action.inactive', 'This action preview is no longer active.')] as const,
  };
}

function createConfirmation(
  context: WebAppContext,
  region: WebRegion,
  port: ActionPort,
  session: ActionSession,
): () => Promise<ActionOutcome<ActionExecution>> {
  return async () => {
    if (!session.active) return inactiveAction();
    const confirmed = await port.confirm(session.preview, { signal: session.controller.signal });
    if (!confirmed.ok) {
      session.active = false;
      clearPendingAction(region, session);
      notifyAction(context, { state: 'failed', regionId: region.id, diagnostics: confirmed.diagnostics });
      return confirmed;
    }
    const executed = await port.execute(confirmed.value, { signal: session.controller.signal });
    if (executed.ok && executed.value.state === 'executed') clearSavedDrafts(context, region, session);
    session.active = false;
    clearPendingAction(region, session);
    if (!executed.ok) {
      notifyAction(context, { state: 'failed', regionId: region.id, diagnostics: executed.diagnostics });
      return executed;
    }
    delete region.actionAttempt;
    notifyAction(context, { state: 'executed', regionId: region.id, execution: executed.value });
    return executed;
  };
}

function actionAuthority(context: WebAppContext, region: WebRegion, signal: AbortSignal): string | undefined {
  try {
    const result = context.options.authority.read({
      regionId: region.id,
      resourceId: region.resourceId,
      effect: 'action',
      signal,
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

function actionStillCurrent(context: WebAppContext, region: WebRegion, session: ActionSession): boolean {
  const capture = session.capture;
  if (
    context.disposed ||
    context.regions.get(region.id) !== region ||
    !session.active ||
    session.controller.signal.aborted
  )
    return false;
  if (region.actionAbort !== session.controller || region.actionSequence !== capture.actionSequence) return false;
  if (context.runtime.snapshot(region.id)?.region?.taskRevision !== capture.taskRevision) return false;
  return (
    capture.authority !== undefined && actionAuthority(context, region, session.controller.signal) === capture.authority
  );
}

function clearSavedDrafts(context: WebAppContext, region: WebRegion, session: ActionSession): void {
  if (!actionStillCurrent(context, region, session)) return;
  const retained = resetSavedFormControls(region, session.capture.drafts);
  let changed = false;
  for (const [key, draft] of session.capture.drafts) {
    if (retained.has(key) || region.drafts.get(key) !== draft) continue;
    region.drafts.delete(key);
    changed = true;
  }
  if (!changed) return;
  region.draftRevision = (region.draftRevision ?? 0) + 1;
  publishInteraction(region);
}

function actionInput(region: WebRegion, payload: ActionRequestPayload): RuntimeActionRequest['input'] {
  const input = { ...payload.input };
  for (const draft of region.drafts.values()) input[draft.field] = draft.value;
  return input;
}

function actionEntity(region: WebRegion): RuntimeActionRequest['entity'] {
  const draft = region.drafts.values().next().value;
  if (draft === undefined) return undefined;
  return { key: draft.key, revision: draft.entityRevision };
}

function previewRequest(region: WebRegion, payload: ActionRequestPayload, taskRevision: string): RuntimeActionRequest {
  const requestId = ('action-' + region.id + '-' + region.actionSequence).slice(0, 160);
  region.actionAttempt ??= ('attempt-' + region.id + '-' + taskRevision + '-' + region.actionSequence).slice(0, 160);
  const entity = actionEntity(region);
  return {
    requestId,
    action: payload.action,
    input: actionInput(region, payload),
    ...(entity === undefined ? {} : { entity }),
    idempotencyKey: region.actionAttempt,
  };
}

function actionUnavailable(context: WebAppContext, region: WebRegion): void {
  notifyAction(context, {
    state: 'failed',
    regionId: region.id,
    diagnostics: [diagnostic('web.action.unconfigured', 'This form action has no registered ActionPort.')],
  });
}

function previewFailed(
  context: WebAppContext,
  region: WebRegion,
  controller: AbortController,
  diagnostics: readonly [Diagnostic, ...Diagnostic[]],
  settled?: ActionSettled,
): void {
  if (region.actionAbort === controller) {
    delete region.actionAbort;
    region.actionPending = false;
    settled?.(region);
  }
  notifyAction(context, { state: 'failed', regionId: region.id, diagnostics });
}

function openPreview(
  context: WebAppContext,
  region: WebRegion,
  port: ActionPort,
  preview: ActionPreview,
  controller: AbortController,
  capture: ActionCapture,
  settled?: ActionSettled,
): void {
  const session: ActionSession = { active: true, preview, controller, capture, settled: () => settled?.(region) };
  const cancel = (): boolean => cancelPreview(port, region, session);
  session.cancel = cancel;
  region.cancelAction = cancel;
  if (context.options.onActionEvent === undefined) {
    cancel();
    return;
  }
  const confirm = createConfirmation(context, region, port, session);
  notifyAction(context, { state: 'preview', regionId: region.id, preview, confirm, cancel });
}

function savedFormDrafts(
  context: WebAppContext,
  region: WebRegion,
  payload: ActionRequestPayload,
): ActionCapture['drafts'] {
  const task = context.runtime.snapshot(region.id)?.region?.state?.task;
  if (task?.kind !== 'form' || task.action.id !== payload.action.id || task.action.revision !== payload.action.revision)
    return new Map();
  return new Map(region.drafts);
}

async function previewAction(
  context: WebAppContext,
  region: WebRegion,
  payload: ActionRequestPayload,
  settled?: ActionSettled,
): Promise<void> {
  const port = context.runtime.actionPort;
  if (port === undefined) {
    actionUnavailable(context, region);
    return;
  }
  if (region.actionPending) return;
  // Keep the latest resize queued when submission interrupts an adaptive commit.
  if (region.presentationAbort !== undefined && region.renderAbort === undefined) region.pendingAdapt = true;
  cancelPendingPresentation(region);
  const snapshot = context.runtime.snapshot(region.id)?.region;
  if (snapshot === undefined) return;
  region.actionSequence += 1;
  const controller = new AbortController();
  region.actionAbort = controller;
  region.actionPending = true;
  const capture: ActionCapture = {
    actionSequence: region.actionSequence,
    taskRevision: snapshot.taskRevision,
    authority: actionAuthority(context, region, controller.signal),
    drafts: savedFormDrafts(context, region, payload),
  };
  const request = previewRequest(region, payload, snapshot.taskRevision);
  const preview = await port.preview(request, { signal: controller.signal });
  if (!preview.ok) {
    previewFailed(context, region, controller, preview.diagnostics, settled);
    return;
  }
  if (controller.signal.aborted || region.actionAbort !== controller) {
    port.cancel(preview.value);
    return;
  }
  openPreview(context, region, port, preview.value, controller, capture, settled);
}

export function createInteractionHandler(
  context: WebAppContext,
  settled?: ActionSettled,
): (region: WebRegion, request: AeliqoSemanticInteractionRequest) => Promise<void> {
  return async (region, request) => {
    if (region.presentationTransaction !== undefined) return;
    if (request.payload.kind !== 'action-request') {
      saveInteraction(region, request);
      return;
    }
    await previewAction(context, region, request.payload, settled);
  };
}
