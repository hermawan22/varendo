import { describe, expect, it } from 'vitest';
import {
  AeliqoFileChangeEvent,
  AeliqoFormSubmitEvent,
  AeliqoInputChangeEvent,
  AeliqoInputCommitEvent,
  AeliqoSearchEvent,
} from '../../packages/web/src/input/events.js';
import {
  createInputPresentationManifests,
  type AeliqoInputBindings,
} from '../../packages/web/src/region/input-registry.js';
import { resolveInputInteraction } from '../../packages/web/src/region/input-renderer.js';
import type { PresentationManifest } from '../../packages/core/src/presentation/index.js';

type InputNode = Parameters<typeof resolveInputInteraction>[0];
const node = (
  manifest: PresentationManifest,
  config: Record<string, unknown>,
  ports: readonly Record<string, unknown>[],
  operations: readonly Record<string, unknown>[] = [],
): InputNode =>
  ({
    manifest: manifest.ref,
    node: {
      id: 'node-1',
      role: 'input',
      representation: manifest.ref,
      config: { schema: manifest.configSchema, values: config },
      children: [],
    },
    config: { values: config, fields: [], ports, operations },
    result: undefined,
  }) as unknown as InputNode;
const draft = {
  entity: 'records',
  key: 'record-1',
  field: 'title',
  entityRevision: '7',
  type: { value: 'text' as const, nullable: false },
};

function manifests(): ReturnType<typeof createInputPresentationManifests> {
  const bindings: AeliqoInputBindings = {
    revision: 'inputs-7',
    inputs: [
      { id: 'title', ref: { id: 'input.text-field', revision: '1' }, config: { label: 'Title' }, draft },
      {
        id: 'number',
        ref: { id: 'input.number-field', revision: '1' },
        config: { label: 'Count' },
        draft: { ...draft, field: 'count', type: { value: 'integer' as const, nullable: false } },
      },
      {
        id: 'slider',
        ref: { id: 'input.slider', revision: '1' },
        config: { label: 'Level', min: 0, max: 10, step: 2 },
        draft: { ...draft, field: 'level', type: { value: 'integer' as const, nullable: false } },
      },
      {
        id: 'search',
        ref: { id: 'input.search-field', revision: '1' },
        config: { label: 'Search' },
        draft: { ...draft, field: 'query' },
      },
      {
        id: 'save',
        ref: { id: 'input.form', revision: '1' },
        config: { label: 'Save' },
        action: { action: { id: 'record.save', revision: '1' }, input: { source: 'test' } },
      },
      {
        id: 'files',
        ref: { id: 'input.file-input', revision: '1' },
        config: { label: 'Files' },
        file: { schema: { id: 'files.metadata', revision: '1' } },
      },
    ],
  };
  return createInputPresentationManifests(bindings);
}

function resolved(
  id: string,
  values: Record<string, unknown>,
  ports: readonly Record<string, unknown>[],
  operations: readonly Record<string, unknown>[] = [],
) {
  const result = manifests();
  if (!result.ok) throw new Error(result.diagnostics[0]!.message);
  const manifest = result.value.find((candidate) => candidate.ref.id === id)!;
  return node(manifest, values, ports, operations);
}

describe('semantic input renderer boundary', () => {
  it('revalidates settled text and rejects foreign/composing events', () => {
    const target = resolved('input.text-field', { ...draft, bindingRevision: 'inputs-7' }, [
      { id: 'draft', payload: 'draft', type: draft.type },
    ]);
    const valid = resolveInputInteraction(target, new AeliqoInputCommitEvent({ source: 'user', value: 'updated' }));
    expect(valid).toEqual([
      {
        portId: 'draft',
        payload: {
          kind: 'draft',
          entity: 'records',
          key: 'record-1',
          field: 'title',
          entityRevision: '7',
          value: 'updated',
        },
      },
    ]);
    expect(
      resolveInputInteraction(
        target,
        new CustomEvent('aeliqo-input-commit', {
          bubbles: true,
          composed: true,
          detail: { source: 'user', value: 'forged' },
        }),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputChangeEvent({ source: 'user', value: 'drafting', composing: true }),
      ),
    ).toEqual([]);
  });

  it('does not emit an invalid number draft and canonicalizes valid integer text', () => {
    const target = resolved(
      'input.number-field',
      {
        entity: 'records',
        key: 'record-1',
        field: 'count',
        entityRevision: '7',
        type: { value: 'integer', nullable: false },
        min: '0',
        max: '20',
        step: '2',
        bindingRevision: 'inputs-7',
      },
      [{ id: 'draft', payload: 'draft', type: { value: 'integer', nullable: false } }],
    );
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { text: 'bad', value: undefined, valid: false } } as never),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { text: '13', value: '13', valid: true } }),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { text: '22', value: '22', valid: true } }),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { text: '12', value: '12', valid: true } }),
      ),
    ).toEqual([
      {
        portId: 'draft',
        payload: { kind: 'draft', entity: 'records', key: 'record-1', field: 'count', entityRevision: '7', value: 12 },
      },
    ]);
    const forgedType = resolved(
      'input.number-field',
      {
        entity: 'records',
        key: 'record-1',
        field: 'count',
        entityRevision: '7',
        type: { value: 'integer', nullable: false, grain: ['forged'] },
        bindingRevision: 'inputs-7',
      },
      [{ id: 'draft', payload: 'draft', type: { value: 'integer', nullable: false } }],
    );
    expect(
      resolveInputInteraction(
        forgedType,
        new AeliqoInputCommitEvent({ source: 'user', value: { text: '12', value: '12', valid: true } }),
      ),
    ).toEqual([]);
  });

  it('revalidates slider bounds and exact step increments', () => {
    const result = manifests();
    if (!result.ok) throw new Error(result.diagnostics[0]!.message);
    const manifest = result.value.find((candidate) => candidate.ref.id === 'input.slider')!;
    const target = node(
      manifest,
      {
        entity: 'records',
        key: 'record-1',
        field: 'level',
        entityRevision: '7',
        type: { value: 'integer', nullable: false },
        min: 0,
        max: 10,
        step: 2,
        bindingRevision: 'inputs-7',
      },
      [{ id: 'draft', payload: 'draft', type: { value: 'integer', nullable: false } }],
    );
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { value: 3, unit: '' } } as never),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { value: 12, unit: '' } } as never),
      ),
    ).toEqual([]);
    expect(
      resolveInputInteraction(
        target,
        new AeliqoInputCommitEvent({ source: 'user', value: { value: 4, unit: '' } } as never),
      ),
    ).toEqual([
      {
        portId: 'draft',
        payload: { kind: 'draft', entity: 'records', key: 'record-1', field: 'level', entityRevision: '7', value: 4 },
      },
    ]);
  });

  it('treats search as a settled typed draft while ignoring ordinary query typing', () => {
    const target = resolved('input.search-field', { ...draft, field: 'query', bindingRevision: 'inputs-7' }, [
      { id: 'draft', payload: 'draft', type: draft.type },
    ]);
    expect(resolveInputInteraction(target, new AeliqoSearchEvent({ source: 'user', query: 'Ada' }))).toHaveLength(1);
    expect(
      resolveInputInteraction(
        target,
        new CustomEvent('aeliqo-input-change', {
          bubbles: true,
          composed: true,
          detail: { source: 'user', value: 'Ada' },
        }),
      ),
    ).toEqual([]);
  });

  it('emits only registered static form actions and metadata-only file extensions', () => {
    const form = resolved(
      'input.form',
      {
        action: { id: 'record.save', revision: '1' },
        actionInput: { source: 'test', profile: { roles: ['admin', 'editor'] } },
        bindingRevision: 'inputs-7',
      },
      [{ id: 'submit', payload: 'action-request' }],
      [{ id: 'record.save', revision: '1' }],
    );
    expect(resolveInputInteraction(form, new AeliqoFormSubmitEvent({ source: 'user', submitter: undefined }))).toEqual([
      {
        portId: 'submit',
        payload: {
          kind: 'action-request',
          action: { id: 'record.save', revision: '1' },
          input: { source: 'test', profile: { roles: ['admin', 'editor'] } },
        },
      },
    ]);
    const missingOperation = resolved(
      'input.form',
      { action: { id: 'record.save', revision: '1' }, actionInput: { source: 'test' }, bindingRevision: 'inputs-7' },
      [{ id: 'submit', payload: 'action-request' }],
    );
    expect(
      resolveInputInteraction(missingOperation, new AeliqoFormSubmitEvent({ source: 'user', submitter: undefined })),
    ).toEqual([]);
    const files = resolved(
      'input.file-input',
      { fileSchema: { id: 'files.metadata', revision: '1' }, bindingRevision: 'inputs-7' },
      [{ id: 'files', payload: 'extension', extension: { id: 'files.metadata', revision: '1' } }],
    );
    expect(
      resolveInputInteraction(
        files,
        new AeliqoFileChangeEvent({
          source: 'user',
          files: [{ name: 'a.txt', size: 4, type: 'text/plain', lastModified: 2 }],
        }),
      ),
    ).toEqual([
      {
        portId: 'files',
        payload: {
          kind: 'extension',
          schema: { id: 'files.metadata', revision: '1' },
          value: { files: [{ name: 'a.txt', size: 4, type: 'text/plain', lastModified: 2 }] },
        },
      },
    ]);
    expect(
      resolveInputInteraction(
        files,
        new CustomEvent('aeliqo-file-change', {
          bubbles: true,
          composed: true,
          detail: {
            source: 'user',
            files: [{ name: 'a.txt', size: 4, type: 'text/plain', lastModified: 2, bytes: 'secret' }],
          },
        }),
      ),
    ).toEqual([]);
  });
});
