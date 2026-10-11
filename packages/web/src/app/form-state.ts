import type { Intent, Outcome, Task } from '@varendo/core';
import type { RuntimeCommittedReceipt } from '@varendo/runtime/app';
import type { AeliqoInputBindings } from '../region/input-registry.js';
import { createFormBindings } from './form-bindings.js';
import { diagnostic, type WebAppContext, type WebRegion } from './context.js';
import type { AeliqoFormState } from './types.js';

function formStateFailure(code: string, message: string): Outcome<never> {
  return { ok: false, diagnostics: [diagnostic(code, message)] };
}

async function readFormState(
  context: WebAppContext,
  region: WebRegion,
  intent: Extract<Intent, { readonly kind: 'create' | 'edit' }>,
  task: Extract<Task, { readonly kind: 'form' }>,
  resource: NonNullable<ReturnType<WebAppContext['resources']['get']>>,
  signal?: AbortSignal,
): Promise<Outcome<AeliqoFormState>> {
  const adapter = context.options.formState;
  if (adapter === undefined) {
    if (intent.kind === 'edit')
      return formStateFailure(
        'web.form-state.required',
        'Edit requires a trusted formState adapter to load current values and entity revision.',
      );
    return { ok: true, value: { values: {}, entityRevision: 'new' } };
  }
  const fallback = new AbortController();
  try {
    return await adapter.read({
      regionId: region.id,
      resource,
      intent,
      task,
      signal: signal ?? fallback.signal,
    });
  } catch {
    return formStateFailure('web.form-state.failed', 'The trusted formState adapter failed safely.');
  }
}

export async function resolveFormBindings(
  context: WebAppContext,
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  signal?: AbortSignal,
): Promise<Outcome<AeliqoInputBindings | undefined>> {
  if (receipt.task.kind !== 'form') return { ok: true, value: undefined };
  if (receipt.intent.kind !== 'create' && receipt.intent.kind !== 'edit')
    return formStateFailure('web.form-state.intent', 'A form Task requires a create or edit intent.');
  const resource = context.resources.get(region.resourceId);
  if (resource === undefined)
    return formStateFailure('web.form-state.resource', 'The mounted form resource is unavailable.');
  const state = await readFormState(context, region, receipt.intent, receipt.task, resource, signal);
  if (!state.ok) return state;
  return createFormBindings(resource, receipt.intent, receipt.task, state.value);
}
