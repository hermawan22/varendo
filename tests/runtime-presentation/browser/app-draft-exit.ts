import { defineResource } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { ActionRegistry, createActionPort } from '@varendo/runtime/actions';
import { z } from 'zod';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';

const control = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id)!;
const formMode = new URLSearchParams(location.search).get('form');
const editing = formMode === 'edit';
const actionRef = { id: editing ? 'people.update' : 'people.create', revision: '1' };
let entityRevision = 'entity-1';
let savedValues = { id: 'ada', name: 'Ada', team: 'Research' };
const people = defineResource({
  id: 'people',
  revision: '1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
  fields: { id: { label: 'ID', hidden: formMode !== 'empty' }, name: { label: 'Name' }, team: { label: 'Team' } },
  presentation: { allowedViews: ['table'] },
  forms: {
    create: { schema: { id: 'people.create', revision: '1' }, action: { id: 'people.create', revision: '1' } },
    edit: { schema: { id: 'people.edit', revision: '1' }, action: { id: 'people.update', revision: '1' } },
  },
});
const functions = createQueryFunctionRegistry({ version: '2' });
if (!functions.ok) throw new Error('registry');
const data = createLocalDataService({
  snapshot: { catalog: people.catalog, sourceRevision: '1', records: { people: [savedValues] } },
  functionRegistry: functions.value,
  authorize: () => ({ ok: true, value: { scopeDigest: 'scope', policyRevision: '1' } }),
});
let queryCalls = 0;
let guardCalls = 0;
let saves = 0;
let savedName = '';
let releaseAction: (() => void) | undefined;
let confirmPreview: (() => void) | undefined;
let cancelPreview: (() => void) | undefined;
const execute = data.execute;
data.execute = (...args) => {
  queryCalls++;
  return execute(...args);
};
const registry = new ActionRegistry();
const registered = registry.register({
  descriptor: {
    ref: actionRef,
    input: { id: 'people.input', revision: '1' },
    output: { id: 'people.output', revision: '1' },
    sideEffect: 'domain-write',
    confirmation: 'required',
    idempotency: 'required',
    entityRevision: editing ? 'required' : 'none',
  },
  inputSchema: { ref: { id: 'people.input', revision: '1' }, parse: people.parseRecord },
  outputSchema: { ref: { id: 'people.output', revision: '1' }, parse: people.parseRecord },
  async dispatch({ input }) {
    const mode = control<HTMLSelectElement>('action-mode').value;
    control('action-status').textContent = 'dispatching';
    if (mode === 'held')
      await new Promise<void>((resolve) => {
        releaseAction = resolve;
      });
    if (mode === 'failed')
      return {
        state: 'rejected',
        diagnostics: [{ code: 'fixture.save-failed', message: 'Save failed', retryable: false }],
      };
    savedName = input.name;
    savedValues = input;
    if (editing) entityRevision = 'entity-2';
    return { state: 'completed', output: input };
  },
});
if (!registered.ok) throw new Error('action registry');
const actionPort = createActionPort({
  registry,
  host: {
    readContext: () => ({
      ok: true,
      value: {
        principalKey: 'user',
        actorKey: 'user',
        scopeDigest: 'scope',
        policyRevision: '1',
        domainRevision: '1',
        confirmationEpoch: '1',
        entityRevisions: { [JSON.stringify({ id: 'ada' })]: entityRevision },
        grants: ['action.propose', 'action.execute'],
      },
    }),
    issueConfirmation: () => ({ ok: true, value: undefined }),
  },
});
const app = createVarendoApp({
  resources: [{ resource: people, data }],
  actionPort,
  authority: {
    read: () => ({
      ok: true,
      value: {
        principalKey: 'user',
        scopeDigest: 'scope',
        policyRevision: '1',
        experienceRevision: '1',
        grants: ['task.evaluate', 'result.inspect', 'experience.commit', 'action.propose', 'action.execute'],
        readContext: { principal: 'user' },
      },
    }),
  },
  formState: { read: () => ({ ok: true, value: { values: formMode === 'empty' ? {} : savedValues, entityRevision } }) },
  onDraftExit(request) {
    guardCalls++;
    const choice = control<HTMLSelectElement>('choice').value;
    if (choice === 'stay' || choice === 'discard') return { status: choice };
    return {
      status: 'save',
      save: () => {
        if (choice === 'failed-save')
          return {
            ok: false,
            diagnostics: [{ code: 'fixture.save-failed', message: 'Save failed', retryable: false }],
          };
        saves++;
        savedName = String(request.drafts.find((draft) => draft.field === 'name')?.value);
        return { ok: true, value: undefined };
      },
    };
  },
  async onActionEvent(event) {
    if (event.state === 'preview' && control<HTMLSelectElement>('action-mode').value === 'preview') {
      control('action-status').textContent = 'preview';
      confirmPreview = () => void event.confirm();
      cancelPreview = () => {
        event.cancel();
        control('action-status').textContent = 'cancelled';
      };
    } else if (event.state === 'preview') await event.confirm();
    else control('action-status').textContent = event.state;
  },
});
const mounted = app.mount({ target: control('target'), regionId: 'main', resourceId: 'people' });
if (!mounted.ok) throw new Error('mount');
const initial = await app.render({
  regionId: 'main',
  intent: editing
    ? { version: '1', id: 'edit-person', kind: 'edit', resource: 'people', identity: { id: 'ada' } }
    : { version: '1', id: 'create-person', kind: 'create', resource: 'people' },
});
control('status').textContent = initial.status;
if (initial.status !== 'renderer-ready') throw new Error(JSON.stringify(initial.diagnostics));
async function browse(invalid = false) {
  const receipt = await app.render({
    regionId: 'main',
    intent: {
      version: '1',
      id: 'browse-people',
      kind: 'browse',
      resource: 'people',
      fields: [invalid ? 'unknown' : 'name'],
    },
  });
  control('status').textContent = receipt.status;
}
control('browse').onclick = () => {
  void browse();
};
control('invalid').onclick = () => {
  void browse(true);
};
control('release').onclick = () => releaseAction?.();
control('confirm-preview').onclick = () => confirmPreview?.();
control('cancel-preview').onclick = () => cancelPreview?.();
control('dispose').onclick = () => app.dispose();
Object.assign(window, {
  draftFixture: {
    snapshot: () => ({
      guardCalls,
      saves,
      queryCalls,
      savedName,
      savedValues,
      taskRevision: app.snapshot('main')?.region?.taskRevision,
      inlineSize: mounted.value.presentation?.environment.inlineSize,
      drafts: mounted.value.interaction?.drafts ?? [],
    }),
  },
});
