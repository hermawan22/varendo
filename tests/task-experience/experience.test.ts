import { describe, expect, it } from 'vitest';
import {
  resolveExperienceConstraints,
  type ExperienceRestriction,
  type Outcome,
} from '../../packages/core/src/index.js';
import { experience, task } from '../contracts/fixtures.js';
const unwrap = <T>(outcome: Outcome<T>): T => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error('Unexpected rejection');
  return outcome.value;
};
const compare = { id: 'compare', revision: '1' };
const need = {
  id: 'joint',
  operation: compare,
  outputId: 'rows',
  fields: ['employee.id', 'employee.name'],
  required: true,
  simultaneousGroup: 'all-at-once',
};
const profile = {
  ...experience,
  mode: 'composable',
  agentAllowed: true,
  allowedRepresentations: ['table', 'plot', 'list'],
  allowedPatterns: ['master-detail', 'comparison'],
  composition: { allowWithoutPreset: true, maxNodes: 30, maxExpansions: 100 },
  requiredOperations: ['compare'],
  extensionAllowlist: [
    { id: 'extension', revision: '1' },
    { id: 'extension', revision: '2' },
  ],
};
const request = { ...task, needs: [need] };
const reject = (value: Outcome<unknown>, code: string) => {
  expect(value.ok).toBe(false);
  if (!value.ok) expect(value.diagnostics.map((item) => item.code)).toContain(code);
};

describe('hard Experience constraints', () => {
  it('intersects all layers without dropping operations or simultaneous comparison', () => {
    const restrictions: ExperienceRestriction[] = [
      {
        id: 'host',
        allowedRepresentations: ['table', 'plot'],
        allowedPatterns: ['comparison'],
        allowedOperations: [compare],
        maxNodes: 20,
      },
      {
        id: 'accessible',
        allowedRepresentations: ['table', 'list'],
        maxNodes: 10,
        maxExpansions: 12,
        transitionPolicy: 'explicit-only',
      },
      { id: 'user', allowedRepresentations: ['table'], extensionAllowlist: [{ id: 'extension', revision: '2' }] },
    ];
    const value = unwrap(resolveExperienceConstraints(profile, request, restrictions));
    expect(value.allowedRepresentations).toEqual(['table']);
    expect(value.allowedPatterns).toEqual(['comparison']);
    expect(value.extensionAllowlist).toEqual([{ id: 'extension', revision: '2' }]);
    expect(value.maxNodes).toBe(10);
    expect(value.maxExpansions).toBe(12);
    expect(value.taskNeeds).toEqual([need]);
    expect(value.transitionPolicy).toBe('explicit-only');
  });
  it('is deterministic under restriction ordering and cannot widen a prior restriction', () => {
    const layers: ExperienceRestriction[] = [
      { id: 'a', allowedRepresentations: ['plot', 'table'], agentAllowed: false, maxNodes: 2, mode: 'fixed' },
      { id: 'b', allowedRepresentations: ['table', 'list'], agentAllowed: true, maxNodes: 100, mode: 'composable' },
    ];
    const forward = unwrap(resolveExperienceConstraints(profile, request, layers));
    const reverse = unwrap(resolveExperienceConstraints(profile, request, [...layers].reverse()));
    expect(reverse).toEqual(forward);
    expect(forward.mode).toBe('fixed');
    expect(forward.agentAllowed).toBe(false);
    expect(forward.maxNodes).toBe(2);
  });
  it('treats explicit representation as hard and preferred representation as soft', () => {
    const explicit = { ...request, viewPreference: { representation: 'cards', strength: 'explicit' } };
    reject(resolveExperienceConstraints(profile, explicit), 'experience.representation-conflict');
    const preferred = unwrap(
      resolveExperienceConstraints(profile, {
        ...request,
        viewPreference: { representation: 'cards', strength: 'preferred' },
      }),
    );
    expect(preferred.allowedRepresentations).toEqual(['list', 'plot', 'table']);
    expect(preferred.preferredRepresentation).toBe('cards');
  });
  it('distinguishes an omitted allowlist from an empty deny-all list', () => {
    expect(unwrap(resolveExperienceConstraints(profile, request, [{ id: 'host' }])).allowedOperations).toBeUndefined();
    reject(
      resolveExperienceConstraints(profile, request, [{ id: 'host', allowedRepresentations: [] }]),
      'experience.representation-conflict',
    );
    reject(
      resolveExperienceConstraints(profile, request, [{ id: 'host', allowedOperations: [] }]),
      'experience.operation-conflict',
    );
  });
  it('does not mistake a different operation revision for required capability', () => {
    reject(
      resolveExperienceConstraints(profile, request, [
        { id: 'host', allowedOperations: [{ id: 'compare', revision: '2' }] },
      ]),
      'experience.operation-conflict',
    );
  });
  it('reports unavailable optional needs without discarding their definitions', () => {
    const optional = { ...need, id: 'optional', operation: { id: 'export', revision: '1' }, required: false };
    const value = unwrap(
      resolveExperienceConstraints(profile, { ...request, needs: [need, optional] }, [
        { id: 'host', allowedOperations: [compare] },
      ]),
    );
    expect(value.unavailableOptionalNeeds).toEqual(['optional']);
    expect(value.taskNeeds).toEqual([need, optional]);
  });
  it('preserves bounded no-preset composition when there are no named patterns', () => {
    const value = unwrap(resolveExperienceConstraints({ ...profile, allowedPatterns: [] }, request));
    expect(value.allowedPatterns).toEqual([]);
    expect(value.allowWithoutPreset).toBe(true);
    expect(value.compositionChangeAllowed).toBe(true);
    expect(value.maxExpansions).toBe(64);
    const restricted = unwrap(
      resolveExperienceConstraints(profile, request, [{ id: 'host', allowWithoutPreset: false }]),
    );
    expect(restricted.allowWithoutPreset).toBe(false);
  });
  it('keeps fixed/adaptive/composable authority separate from agent enablement', () => {
    for (const [mode, replacement, composition] of [
      ['fixed', false, false],
      ['adaptive', true, false],
      ['composable', true, true],
    ] as const) {
      const value = unwrap(resolveExperienceConstraints({ ...profile, mode }, request));
      expect(value.representationReplacementAllowed).toBe(replacement);
      expect(value.compositionChangeAllowed).toBe(composition);
      expect(value.agentAllowed).toBe(true);
      expect(value).not.toHaveProperty('actionGrant');
    }
  });
  it('rejects malformed, duplicate and effect-bearing restriction fields', () => {
    for (const bad of [
      { id: 'x', maxExpansions: 0 },
      { id: 'x', allowedRepresentations: 'table' },
      { id: 'x', actor: 'approved' },
      { id: 'x', css: 'display:none' },
    ])
      reject(resolveExperienceConstraints(profile, request, [bad as never]), 'experience.restriction-shape');
    reject(
      resolveExperienceConstraints(profile, request, [{ id: 'same' }, { id: 'same' }]),
      'experience.restriction-duplicate',
    );
  });
  it('cannot remove comparisons by injecting mobile or keyboard claims', () => {
    reject(
      resolveExperienceConstraints(profile, request, [{ id: 'mobile', keyboard: false, inlineSize: 320 } as never]),
      'experience.restriction-shape',
    );
    const value = unwrap(resolveExperienceConstraints(profile, request));
    expect(value.taskNeeds[0]?.simultaneousGroup).toBe('all-at-once');
    expect(value.taskNeeds[0]?.fields).toHaveLength(2);
  });
});
