import { describe, expect, it } from 'vitest';
import { parseInteractionState } from '../../packages/core/src/interaction/index.js';
import type { InteractionState } from '../../packages/core/src/index.js';

const ref = { id: 'result', revision: '1', outputId: 'employees', queryDigest: 'query', scopeDigest: 'scope' } as const;
const entry = {
  nodeId: 'table',
  portId: 'selection',
  payload: { kind: 'selection', selection: { mode: 'ids', entity: 'employees', keys: ['e1'], result: ref } },
} as const;
const draft = {
  domain: 'employee-records',
  entity: 'employees',
  key: 'e1',
  field: 'name',
  value: 'Draft name',
  entityRevision: '1',
} as const;
const state = { version: '1', values: [entry], drafts: [draft] } as const satisfies InteractionState;

describe('canonical interaction state', () => {
  it('round trips independent port values and domain drafts as immutable data', () => {
    const input = {
      ...state,
      values: [entry, { ...entry, nodeId: 'other-table' }],
      drafts: [draft, { ...draft, domain: 'other-domain' }],
    };
    const parsed = parseInteractionState(JSON.stringify(input));
    expect(parsed).toEqual({ ok: true, value: input });
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.value.values[0]?.payload)).toBe(true);
    expect(Object.isFrozen(parsed.value.drafts[0])).toBe(true);
  });

  it('rejects duplicate routes, selection identities and conflicting drafts', () => {
    expect(parseInteractionState({ ...state, values: [entry, entry] }).ok).toBe(false);
    expect(
      parseInteractionState({
        ...state,
        values: [
          { ...entry, payload: { kind: 'selection', selection: { ...entry.payload.selection, keys: ['e1', 'e1'] } } },
        ],
      }).ok,
    ).toBe(false);
    expect(parseInteractionState({ ...state, drafts: [draft, { ...draft, entityRevision: '2' }] }).ok).toBe(false);
    expect(
      parseInteractionState({
        ...state,
        drafts: [{ ...draft, conflict: { kind: 'entity-stale', entityRevision: '1' } }],
      }).ok,
    ).toBe(false);
    expect(
      parseInteractionState({
        ...state,
        drafts: [{ ...draft, conflict: { kind: 'entity-stale', entityRevision: '2' } }],
      }).ok,
    ).toBe(true);
  });

  it('excludes effect requests, authority fields, arbitrary objects and unsupported versions', () => {
    const effects = [
      { kind: 'action-request', action: { id: 'delete', revision: '1' }, input: {} },
      { kind: 'navigate', route: { id: 'detail', revision: '1' }, params: {} },
      { kind: 'extension', schema: { id: 'unknown', revision: '1' }, value: { rows: [] } },
    ];
    for (const payload of effects)
      expect(parseInteractionState({ ...state, values: [{ ...entry, payload }] }).ok).toBe(false);
    expect(parseInteractionState({ ...state, actor: 'human' }).ok).toBe(false);
    expect(parseInteractionState({ ...state, drafts: [{ ...draft, approved: true }] }).ok).toBe(false);
    expect(parseInteractionState({ ...state, drafts: [{ ...draft, value: { arbitrary: 'object' } }] }).ok).toBe(false);
    expect(parseInteractionState({ ...state, version: '2' }).ok).toBe(false);
    expect(parseInteractionState({ ...state, drafts: undefined }).ok).toBe(false);
  });
});
