import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseContract, serializeContract, compareScalars, WIRE_LIMITS } from '../../packages/core/src/index.js';
import type { NarrativeClaim, OperationGrant } from '../../packages/core/src/contracts/agent/index.js';
import { ref, taskProposal } from './fixtures.js';

const grants: readonly OperationGrant[] = [
  'catalog.read',
  'result.inspect',
  'task.propose',
  'task.evaluate',
  'experience.propose',
  'experience.commit',
  'meaning.propose',
  'meaning.activate',
  'action.propose',
  'action.execute',
  'model.egress',
];
const cell = {
  result: ref,
  field: 'absence.rate',
  identity: { 'employee.id': 'e1' },
  type: { value: 'decimal', nullable: false },
  definition: { id: 'absence.rate', revision: '1' },
  populationDigest: 'ranked-five',
  filters: [],
} as const;
const claim: NarrativeClaim = { version: '1', id: 'rate-claim', kind: 'value', cell, value: { decimal: '0.1250' } };

describe('agent wire authority and narrative contracts', () => {
  it('recognizes independent grants and rejects authority presets or model labels', () => {
    for (const grant of grants) expect(parseContract('operation-grant', JSON.stringify(grant)).ok).toBe(true);
    for (const input of [
      'act',
      'observe',
      'suggest',
      'compose',
      'admin',
      'gpt-6',
      '*',
      { grant: 'action.execute', approved: true },
    ])
      expect(parseContract('operation-grant', input).ok).toBe(false);
    for (const extra of [
      { actor: 'human' },
      { approved: true },
      { grants: ['action.execute'] },
      { model: 'strong' },
      { confidence: 1 },
    ])
      expect(parseContract('task-proposal', { ...taskProposal, ...extra }).ok).toBe(false);
  });
  it('round-trips exact scoped values and comparisons without adding authorizing prose', () => {
    const serialized = serializeContract('narrative-claim', claim);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error('Expected a serializable claim.');
    const restored = parseContract('narrative-claim', serialized.value);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error('Expected a parsed claim.');
    expect(restored.value).toEqual(claim);
    expect(restored.value).not.toBe(claim);
    expect(
      parseContract('narrative-claim', {
        version: '1',
        id: 'comparison',
        kind: 'comparison',
        left: cell,
        right: { ...cell, identity: { 'employee.id': 'e2' } },
        relation: 'gt',
      }).ok,
    ).toBe(true);
    expect(parseContract('narrative-claim', { ...claim, text: 'This proves the cause.' }).ok).toBe(false);
  });
  it('keeps inference text a separate claim class, even when references are present', () => {
    const result = parseContract('narrative-claim', {
      version: '1',
      id: 'inference',
      kind: 'inference',
      text: 'A possible explanation.',
      references: [ref],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe('inference');
    expect(
      parseContract('narrative-claim', {
        version: '1',
        id: 'inference',
        kind: 'inference',
        text: 'A possible explanation.',
        references: [ref],
        verified: true,
      }).ok,
    ).toBe(false);
  });
  it('rejects malformed, nonfinite, over-budget and unversioned claims before binding', () => {
    for (const input of [
      { ...claim, version: '2' },
      { ...claim, value: NaN },
      { ...claim, value: Infinity },
      { ...claim, value: { decimal: '0x10' } },
      { ...claim, cell: { ...cell, identity: [] } },
      { ...claim, cell: { ...cell, type: { ...cell.type, actor: 'human' } } },
      { ...claim, sql: 'select 1' },
    ])
      expect(parseContract('narrative-claim', input).ok).toBe(false);
    const budget = { maxTurns: 8, maxRepairs: 2, maxMilliseconds: 1000, maxProposalBytes: 4096 };
    expect(parseContract('agent-loop-budget', budget).ok).toBe(true);
    for (const extra of [
      { maxTurns: 0 },
      { maxTurns: 65 },
      { maxRepairs: -1 },
      { maxMilliseconds: Infinity },
      { maxProposalBytes: WIRE_LIMITS.bytes + 1 },
      { model: 'strong' },
    ])
      expect(parseContract('agent-loop-budget', { ...budget, ...extra }).ok).toBe(false);
  });
  it('does not equate shape validity with field, scope or business truth', () => {
    expect(
      parseContract('narrative-claim', {
        ...claim,
        cell: { ...cell, field: 'some-other-valid-id', populationDigest: 'other-population' },
      }).ok,
    ).toBe(true);
    // Matching values use the existing scalar semantics; the runtime must still resolve real authorized rows.
    expect(compareScalars({ decimal: '0.125' }, { decimal: '0.1250' }, cell.type)).toEqual({ ok: true, value: 0 });
    expect(compareScalars({ decimal: '0.125' }, { decimal: '0.126' }, cell.type)).toEqual({ ok: true, value: -1 });
  });
  it('generates strict schemas from the canonical source', () => {
    for (const kind of ['operation-grant', 'agent-loop-budget', 'agent-stop-reason', 'narrative-claim']) {
      const schema = JSON.parse(
        readFileSync(new URL(`../../packages/core/schemas/${kind}.schema.json`, import.meta.url), 'utf8'),
      );
      expect(schema.$id).toBe(`https://hermawan22.github.io/varendo/schemas/1/${kind}.schema.json`);
      expect(JSON.stringify(schema)).not.toContain('modelQuality');
    }
  });
});
