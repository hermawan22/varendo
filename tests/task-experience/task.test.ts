import { describe, expect, it } from 'vitest';
import { validateTaskStructure, parseTask, type Outcome } from '../../packages/core/src/index.js';
import { task, query, ref, formTask, presentationTask } from '../contracts/fixtures.js';
const output = (id: string, dependsOn: string[] = [], delivery: 'eager' | 'on-demand' = 'eager') => ({
  id,
  kind: 'query' as const,
  query,
  dependsOn,
  delivery,
});
const unwrap = <T>(outcome: Outcome<T>): T => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error('Unexpected rejection');
  return outcome.value;
};
const reject = (input: unknown, code: string) => {
  const value = validateTaskStructure(input);
  expect(value.ok).toBe(false);
  if (!value.ok) expect(value.diagnostics.map((item) => item.code)).toContain(code);
};

describe('named output structure', () => {
  it('orders multiple grains and delayed outputs without flattening their queries', () => {
    const outputs = [output('detail', ['ranking'], 'on-demand'), output('weekly', ['ranking']), output('ranking')];
    const value = unwrap(validateTaskStructure({ ...task, outputs }));
    expect(value.outputOrder).toEqual(['ranking', 'detail', 'weekly']);
    expect(value.task).toEqual({ ...task, outputs });
  });
  it('uses deterministic input order for independent nodes', () => {
    expect(
      unwrap(validateTaskStructure({ ...task, outputs: [output('b'), output('a'), output('c', ['a', 'b'])] }))
        .outputOrder,
    ).toEqual(['b', 'a', 'c']);
  });
  it('checks every generated dependency before its dependent without recursion', () => {
    for (const count of [2, 17, 128]) {
      const outputs = Array.from({ length: count }, (_, index) =>
        output(`o${index}`, index ? [`o${index - 1}`] : []),
      ).reverse();
      const actual = unwrap(validateTaskStructure({ ...task, outputs })).outputOrder;
      expect(actual).toEqual(Array.from({ length: count }, (_, index) => `o${index}`));
    }
  });
  it('rejects duplicates, missing edges, self loops and longer cycles after shape validation', () => {
    for (const [outputs, code] of [
      [[output('a'), output('a')], 'task.duplicate'],
      [[output('a', ['absent'])], 'task.dependency-missing'],
      [[output('a'), output('b', ['a', 'a'])], 'task.duplicate'],
      [[output('a', ['a'])], 'task.output-cycle'],
      [[output('a', ['c']), output('b', ['a']), output('c', ['b'])], 'task.output-cycle'],
    ] as const) {
      const input = { ...task, outputs };
      expect(parseTask(input).ok).toBe(true);
      reject(input, code);
    }
  });
  it('requires a live cohort edge, preserving its explicit membership policy', () => {
    const downstream = {
      ...output('weekly'),
      query: { ...query, population: { kind: 'live-output', outputId: 'ranking', identityKeys: ['employee.id'] } },
    };
    reject({ ...task, outputs: [output('ranking'), downstream] }, 'task.cohort-dependency');
    const bound = { ...downstream, dependsOn: ['ranking'] };
    reject(
      { ...task, outputs: [bound, { id: 'ranking', kind: 'reuse', dependsOn: [], result: ref }] },
      'task.cohort-source',
    );
    const value = unwrap(validateTaskStructure({ ...task, outputs: [bound, output('ranking')] }));
    expect(value.outputOrder).toEqual(['ranking', 'weekly']);
    expect(value.resultReferences).toEqual([]);
  });
  it('pins fixed membership to the complete result reference and does not fabricate an edge', () => {
    const fixed = {
      ...output('weekly'),
      query: {
        ...query,
        population: { kind: 'fixed', source: ref, identityKeys: ['employee.id'], cohortDigest: 'cohort-1' },
      },
    };
    const alias = { id: 'earlier', kind: 'reuse', dependsOn: [], result: ref };
    const value = unwrap(validateTaskStructure({ ...task, outputs: [fixed, alias] }));
    expect(value.outputOrder).toEqual(['weekly', 'earlier']);
    expect(value.resultReferences).toEqual([ref]);
    const differentScope = { ...ref, scopeDigest: 'other-scope' };
    expect(
      unwrap(validateTaskStructure({ ...task, outputs: [fixed, { ...alias, result: differentScope }] }))
        .resultReferences,
    ).toEqual([ref, differentScope]);
  });
  it('rejects duplicate cohort identity keys', () => {
    const value = {
      ...output('weekly'),
      query: {
        ...query,
        population: {
          kind: 'fixed',
          source: ref,
          identityKeys: ['employee.id', 'employee.id'],
          cohortDigest: 'cohort-1',
        },
      },
    };
    reject({ ...task, outputs: [value] }, 'task.duplicate');
  });
});

describe('queryless tasks and operation requirements', () => {
  const need = {
    id: 'compare',
    operation: { id: 'compare', revision: '1' },
    outputId: 'rows',
    fields: ['employee.id'],
    required: true,
    simultaneousGroup: 'joint',
  };
  it('retains operation fields and simultaneous groups exactly', () => {
    expect(unwrap(validateTaskStructure({ ...task, needs: [need] })).task.needs).toEqual([need]);
  });
  it('rejects ambiguous or missing operation targets and duplicate needs/fields', () => {
    reject({ ...task, needs: [{ ...need, outputId: 'absent' }] }, 'task.operation-output');
    reject({ ...task, needs: [need, need] }, 'task.duplicate');
    reject({ ...task, needs: [{ ...need, fields: ['employee.id', 'employee.id'] }] }, 'task.duplicate');
    reject(
      { ...presentationTask, inputs: [ref, { ...ref, id: 'other-result' }], needs: [need] },
      'task.output-ambiguous',
    );
  });
  it('permits presentation over handles and forms without fake reads', () => {
    const presentation = unwrap(validateTaskStructure({ ...presentationTask, needs: [need] }));
    expect(presentation.outputOrder).toEqual([]);
    expect(presentation.resultReferences).toEqual([ref]);
    const form = unwrap(validateTaskStructure(formTask));
    expect(form.outputOrder).toEqual([]);
    expect(form.resultReferences).toEqual([]);
    reject({ ...formTask, needs: [need] }, 'task.operation-output');
  });
  it('keeps different full handles when no operation uses their colliding output names', () => {
    const other = { ...ref, id: 'other-result' };
    expect(unwrap(validateTaskStructure({ ...presentationTask, inputs: [ref, other] })).resultReferences).toEqual([
      ref,
      other,
    ]);
    expect(
      unwrap(validateTaskStructure({ ...presentationTask, inputs: [ref, ref], needs: [need] })).resultReferences,
    ).toEqual([ref]);
  });
  it('rejects executable additions before structural traversal', () => {
    reject({ ...task, sql: 'SELECT *' }, 'wire.unrecognized_keys');
    reject({ ...task, actor: { approved: true } }, 'wire.unrecognized_keys');
  });
  it('does not confuse structure with catalog, result or action authorization', () => {
    const value = unwrap(validateTaskStructure({ ...formTask, action: { id: 'unbound-action', revision: '999' } }));
    expect(value.task.kind).toBe('form');
    expect(value).not.toHaveProperty('authorized');
    expect(value).not.toHaveProperty('executable');
  });
});
