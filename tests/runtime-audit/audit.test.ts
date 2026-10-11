import { describe, expect, it } from 'vitest';
import { createLocalAuditExporter } from '../../packages/runtime/src/audit/exporter.js';
import type { LocalAuditEvent } from '../../packages/runtime/src/audit/types.js';

function value<T>(outcome: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!outcome.ok) throw new Error('Expected a successful audit outcome.');
  return outcome.value;
}

describe('bounded local audit export', () => {
  it('exports the documented low-cardinality event families without application data', () => {
    let at = 1_000;
    const audit = createLocalAuditExporter({ now: () => at++ });
    const events: readonly LocalAuditEvent[] = [
      { kind: 'plan', phase: 'query', status: 'completed', durationMs: 12 },
      { kind: 'capability', operation: 'evaluate', status: 'rejected', code: 'policy.denied' },
      { kind: 'cancellation', operation: 'present', code: 'host.cancelled' },
      { kind: 'source', transport: 'http', status: 'error', code: 'source.timeout' },
      { kind: 'cache', cache: 'result', status: 'hit' },
      { kind: 'renderer', renderer: 'plot', status: 'partial', resourceCount: 8 },
      { kind: 'resource', resource: 'rows', status: 'exhausted', count: 1_001, limit: 1_000 },
    ];
    for (const event of events) expect(audit.record(event).ok).toBe(true);
    const exported = value(audit.exportSnapshot());
    expect(exported).toMatchObject({ version: '1', dropped: 0, complete: true });
    expect(exported.records).toHaveLength(events.length);
    expect(exported.records.map(({ version, sequence, at, ...event }) => event)).toEqual(events);
    expect(exported.records.map((record) => record.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(exported.records.map((record) => record.at)).toEqual([1_000, 1_001, 1_002, 1_003, 1_004, 1_005, 1_006]);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported.records)).toBe(true);
    expect(Object.isFrozen(exported.records[0])).toBe(true);
  });

  it('rejects arbitrary context, messages, prompts, records and malformed codes', () => {
    const audit = createLocalAuditExporter();
    const invalid = [
      { kind: 'source', transport: 'http', status: 'error', code: 'source.timeout', url: 'https://secret.invalid' },
      {
        kind: 'capability',
        operation: 'evaluate',
        status: 'rejected',
        code: 'policy.denied',
        principalKey: 'person-1',
      },
      { kind: 'cancellation', operation: 'present', prompt: 'private prompt' },
      { kind: 'renderer', renderer: 'plot', status: 'error', message: 'record contents' },
      { kind: 'source', transport: 'http', status: 'error', code: 'Bearer secret' },
      { kind: 'source', transport: 'http', status: 'error', code: 'sk-secret-value' },
      { kind: 'plan', phase: 'query', status: 'completed', durationMs: -1 },
    ];
    for (const event of invalid) {
      const outcome = audit.record(event as never);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.diagnostics[0]?.code).toBe('audit.invalid');
    }
    expect(value(audit.exportSnapshot()).records).toEqual([]);
  });

  it('evicts oldest records under count and byte budgets and discloses incompleteness', () => {
    const byCount = createLocalAuditExporter({ maxEvents: 2, now: () => 1 });
    expect(byCount.record({ kind: 'cache', cache: 'catalog', status: 'miss' }).ok).toBe(true);
    expect(byCount.record({ kind: 'cache', cache: 'result', status: 'hit' }).ok).toBe(true);
    expect(byCount.record({ kind: 'cache', cache: 'meaning', status: 'miss' }).ok).toBe(true);
    const counted = value(byCount.exportSnapshot());
    expect(counted.records.map((record) => record.sequence)).toEqual([2, 3]);
    expect(counted).toMatchObject({ dropped: 1, complete: false });

    const byBytes = createLocalAuditExporter({ maxBytes: 256, now: () => 1 });
    for (let index = 0; index < 8; index++)
      expect(
        byBytes.record({ kind: 'capability', operation: 'read', status: 'rejected', code: 'policy.denied' }).ok,
      ).toBe(true);
    const bounded = value(byBytes.exportSnapshot());
    expect(bounded.retainedBytes).toBeLessThanOrEqual(256);
    expect(bounded.dropped).toBeGreaterThan(0);
    expect(bounded.complete).toBe(false);
    expect(bounded.records.at(-1)?.sequence).toBe(8);
  });

  it('fails closed for invalid clocks and releases retained records on clear and dispose', () => {
    const invalidClock = createLocalAuditExporter({ now: () => Number.NaN });
    const rejected = invalidClock.record({ kind: 'cache', cache: 'catalog', status: 'hit' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.diagnostics[0]?.code).toBe('audit.clock');
    const thrownClock = createLocalAuditExporter({
      now: () => {
        throw new Error('clock detail must not escape');
      },
    });
    const thrown = thrownClock.record({ kind: 'cache', cache: 'catalog', status: 'hit' });
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) {
      expect(thrown.diagnostics[0]?.code).toBe('audit.clock');
      expect(JSON.stringify(thrown)).not.toContain('clock detail');
    }

    const audit = createLocalAuditExporter({ now: () => 1 });
    const recorded = value(audit.record({ kind: 'renderer', renderer: 'component', status: 'ready' }));
    expect(audit.clear()).toBe(true);
    expect(value(audit.exportSnapshot())).toMatchObject({ records: [], dropped: 0, complete: true, retainedBytes: 0 });
    expect(recorded.kind).toBe('renderer');
    audit.dispose();
    expect(audit.clear()).toBe(false);
    expect(audit.record({ kind: 'cache', cache: 'catalog', status: 'hit' }).ok).toBe(false);
    expect(audit.exportSnapshot().ok).toBe(false);
  });

  it('rejects semantically contradictory codes and resource claims', () => {
    const audit = createLocalAuditExporter({ now: () => 1 });
    const invalid = [
      { kind: 'source', transport: 'http', status: 'error', code: 'action.ambiguous' },
      { kind: 'capability', operation: 'evaluate', status: 'accepted', code: 'policy.denied' },
      { kind: 'capability', operation: 'evaluate', status: 'rejected', code: 'source.timeout' },
      { kind: 'cancellation', operation: 'present', code: 'runtime.failed' },
      { kind: 'resource', resource: 'rows', status: 'within-budget', count: 101, limit: 100 },
      { kind: 'resource', resource: 'rows', status: 'exhausted', count: 100, limit: 100 },
      { kind: 'resource', resource: 'rows', status: 'exhausted', count: 101 },
    ];
    for (const event of invalid) expect(audit.record(event as never).ok).toBe(false);
    expect(value(audit.exportSnapshot()).records).toEqual([]);
  });

  it('validates configuration bounds', () => {
    expect(() => createLocalAuditExporter({ maxEvents: 0 })).toThrow(TypeError);
    expect(() => createLocalAuditExporter({ maxEvents: 4_097 })).toThrow(TypeError);
    expect(() => createLocalAuditExporter({ maxBytes: 255 })).toThrow(TypeError);
    expect(() => createLocalAuditExporter({ maxBytes: 4 * 1024 * 1024 + 1 })).toThrow(TypeError);
  });
});
