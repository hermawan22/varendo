import { describe, expect, it } from 'vitest';
import { stableDataRecordKey, stableDataValueKey } from '../../packages/web/src/data/shared.js';
import { calculateVarendoDelta } from '../../packages/web/src/data/delta.js';
import {
  buildVarendoPredicate,
  combineVarendoPredicates,
  validateVarendoPredicate,
} from '../../packages/web/src/data/filter-builder.js';
import {
  VarendoDataLoadMoreEvent,
  VarendoDataSelectionEvent,
  VarendoFilterChangeEvent,
} from '../../packages/web/src/data/events.js';
import { stableTableRowKey } from '../../packages/web/src/elements/varendo-table.js';

describe('data identity', () => {
  it('tags scalar identities and never falls back to row position', () => {
    expect(stableDataValueKey('1')).toBe('string:1:1');
    expect(stableDataValueKey(1)).toBe('number:1');
    expect(stableDataValueKey({ decimal: '1.00' })).toContain('decimal:');
    expect(stableDataValueKey(undefined)).toBeUndefined();
    expect(stableDataRecordKey({ id: 'a', name: 'Ada' }, ['id'])).toBe('string:1:a');
    expect(stableDataRecordKey({ name: 'Ada' }, ['id'])).toBeUndefined();
    expect(stableTableRowKey({ id: 'a', name: 'Ada' }, ['id'])).toBe('string:1:a');
  });
});

describe('delta semantics', () => {
  it('separates absolute, relative and percentage-point changes', () => {
    expect(calculateVarendoDelta(12, 10, 'absolute')).toMatchObject({ status: 'ready', value: 2, display: '+2' });
    expect(calculateVarendoDelta(12, 10, 'relative')).toMatchObject({ status: 'ready', display: '+20%' });
    expect(calculateVarendoDelta(0.62, 0.5, 'percentage-point')).toMatchObject({ status: 'ready', display: '+12 pp' });
  });

  it('does not invent a baseline or divide by zero', () => {
    expect(calculateVarendoDelta(3, 0, 'relative')).toMatchObject({
      status: 'unavailable',
      reason: 'zero-denominator',
    });
    expect(calculateVarendoDelta(3, 2, 'absolute', false)).toMatchObject({
      status: 'unavailable',
      reason: 'incompatible',
    });
    expect(calculateVarendoDelta(undefined, 2)).toMatchObject({ status: 'unavailable', reason: 'missing-current' });
  });

  it('does not coerce invalid exact decimal text through Number', () => {
    for (const decimal of ['0x10', '', ' 12 ', '1e2', '1'.repeat(513)]) {
      expect(calculateVarendoDelta({ decimal }, { decimal: '1' })).toMatchObject({
        status: 'unavailable',
        reason: 'invalid',
      });
    }
  });

  it('keeps decimal percentage points exact at sub-percent differences', () => {
    expect(calculateVarendoDelta({ decimal: '0.0001' }, { decimal: '0' }, 'percentage-point')).toMatchObject({
      status: 'ready',
      value: '0.0001',
      display: '+0.01 pp',
    });
    expect(
      calculateVarendoDelta({ decimal: '9007199254740993' }, { decimal: '9007199254740992' }, 'absolute'),
    ).toMatchObject({ status: 'ready', value: '1', display: '+1' });
    expect(calculateVarendoDelta({ decimal: '-0.0001' }, { decimal: '0' }, 'percentage-point')).toMatchObject({
      status: 'ready',
      value: '-0.0001',
      display: '-0.01 pp',
    });
    expect(calculateVarendoDelta(1e-7, 0, 'percentage-point')).toMatchObject({
      status: 'ready',
      display: '+0.00001 pp',
    });
  });

  it('does not claim an exact decimal relative result for a repeating ratio', () => {
    expect(calculateVarendoDelta({ decimal: '1' }, { decimal: '3' }, 'relative')).toMatchObject({
      status: 'unavailable',
      reason: 'invalid',
    });
    expect(calculateVarendoDelta({ decimal: '1' }, { decimal: '0' }, 'relative')).toMatchObject({
      status: 'unavailable',
      reason: 'zero-denominator',
    });
    expect(calculateVarendoDelta({ decimal: '3' }, { decimal: '2' }, 'relative')).toMatchObject({
      status: 'ready',
      value: '0.5',
      display: '+50%',
    });
  });
});

describe('filter application', () => {
  it('combines inherited scope only at explicit apply time', () => {
    const local = { op: 'compare' as const, field: 'department', comparison: 'eq' as const, value: 'Sales' };
    const inherited = { op: 'is-null' as const, field: 'deletedAt', negate: true };
    expect(combineVarendoPredicates(local, inherited)).toEqual({ op: 'and', predicates: [inherited, local] });
    expect(validateVarendoPredicate(undefined).ok).toBe(false);
    expect(validateVarendoPredicate(local).ok).toBe(true);
  });

  it('rejects unknown fields and validates typed temporal/integer values', () => {
    expect(buildVarendoPredicate({ field: 'missing', operator: 'eq', value: 'x' }, undefined)).toBeUndefined();
    expect(
      buildVarendoPredicate(
        { field: 'id', operator: 'eq', value: '9007199254740993' },
        { id: 'id', label: 'ID', type: 'integer' },
      ),
    ).toBeUndefined();
    expect(
      buildVarendoPredicate(
        { field: 'created', operator: 'eq', value: 'not-a-date' },
        { id: 'created', label: 'Created', type: 'date' },
      ),
    ).toBeUndefined();
    expect(
      buildVarendoPredicate(
        { field: 'created', operator: 'eq', value: '2026-09-08' },
        { id: 'created', label: 'Created', type: 'date' },
      ),
    ).toEqual({ op: 'compare', field: 'created', comparison: 'eq', value: '2026-09-08' });
  });
});

describe('data events', () => {
  it('uses explicit event names and typed details', () => {
    expect(new VarendoDataSelectionEvent('varendo-record-list-selection', { mode: 'ids', keys: ['id-1'] }).type).toBe(
      'varendo-record-list-selection',
    );
    expect(new VarendoFilterChangeEvent({ applied: true }).detail.applied).toBe(true);
    expect(new VarendoDataLoadMoreEvent().detail.requested).toBe(true);
  });
});
