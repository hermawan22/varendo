import { describe, expect, it } from 'vitest';
import { stableDataRecordKey, stableDataValueKey } from '../../packages/web/src/data/shared.js';
import { calculateAeliqoDelta } from '../../packages/web/src/data/delta.js';
import {
  buildAeliqoPredicate,
  combineAeliqoPredicates,
  validateAeliqoPredicate,
} from '../../packages/web/src/data/filter-builder.js';
import {
  AeliqoDataLoadMoreEvent,
  AeliqoDataSelectionEvent,
  AeliqoFilterChangeEvent,
} from '../../packages/web/src/data/events.js';
import { stableTableRowKey } from '../../packages/web/src/elements/aeliqo-table.js';

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
    expect(calculateAeliqoDelta(12, 10, 'absolute')).toMatchObject({ status: 'ready', value: 2, display: '+2' });
    expect(calculateAeliqoDelta(12, 10, 'relative')).toMatchObject({ status: 'ready', display: '+20%' });
    expect(calculateAeliqoDelta(0.62, 0.5, 'percentage-point')).toMatchObject({ status: 'ready', display: '+12 pp' });
  });

  it('does not invent a baseline or divide by zero', () => {
    expect(calculateAeliqoDelta(3, 0, 'relative')).toMatchObject({ status: 'unavailable', reason: 'zero-denominator' });
    expect(calculateAeliqoDelta(3, 2, 'absolute', false)).toMatchObject({
      status: 'unavailable',
      reason: 'incompatible',
    });
    expect(calculateAeliqoDelta(undefined, 2)).toMatchObject({ status: 'unavailable', reason: 'missing-current' });
  });

  it('does not coerce invalid exact decimal text through Number', () => {
    for (const decimal of ['0x10', '', ' 12 ', '1e2', '1'.repeat(513)]) {
      expect(calculateAeliqoDelta({ decimal }, { decimal: '1' })).toMatchObject({
        status: 'unavailable',
        reason: 'invalid',
      });
    }
  });

  it('keeps decimal percentage points exact at sub-percent differences', () => {
    expect(calculateAeliqoDelta({ decimal: '0.0001' }, { decimal: '0' }, 'percentage-point')).toMatchObject({
      status: 'ready',
      value: '0.0001',
      display: '+0.01 pp',
    });
    expect(
      calculateAeliqoDelta({ decimal: '9007199254740993' }, { decimal: '9007199254740992' }, 'absolute'),
    ).toMatchObject({ status: 'ready', value: '1', display: '+1' });
    expect(calculateAeliqoDelta({ decimal: '-0.0001' }, { decimal: '0' }, 'percentage-point')).toMatchObject({
      status: 'ready',
      value: '-0.0001',
      display: '-0.01 pp',
    });
    expect(calculateAeliqoDelta(1e-7, 0, 'percentage-point')).toMatchObject({
      status: 'ready',
      display: '+0.00001 pp',
    });
  });

  it('does not claim an exact decimal relative result for a repeating ratio', () => {
    expect(calculateAeliqoDelta({ decimal: '1' }, { decimal: '3' }, 'relative')).toMatchObject({
      status: 'unavailable',
      reason: 'invalid',
    });
    expect(calculateAeliqoDelta({ decimal: '1' }, { decimal: '0' }, 'relative')).toMatchObject({
      status: 'unavailable',
      reason: 'zero-denominator',
    });
    expect(calculateAeliqoDelta({ decimal: '3' }, { decimal: '2' }, 'relative')).toMatchObject({
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
    expect(combineAeliqoPredicates(local, inherited)).toEqual({ op: 'and', predicates: [inherited, local] });
    expect(validateAeliqoPredicate(undefined).ok).toBe(false);
    expect(validateAeliqoPredicate(local).ok).toBe(true);
  });

  it('rejects unknown fields and validates typed temporal/integer values', () => {
    expect(buildAeliqoPredicate({ field: 'missing', operator: 'eq', value: 'x' }, undefined)).toBeUndefined();
    expect(
      buildAeliqoPredicate(
        { field: 'id', operator: 'eq', value: '9007199254740993' },
        { id: 'id', label: 'ID', type: 'integer' },
      ),
    ).toBeUndefined();
    expect(
      buildAeliqoPredicate(
        { field: 'created', operator: 'eq', value: 'not-a-date' },
        { id: 'created', label: 'Created', type: 'date' },
      ),
    ).toBeUndefined();
    expect(
      buildAeliqoPredicate(
        { field: 'created', operator: 'eq', value: '2026-09-08' },
        { id: 'created', label: 'Created', type: 'date' },
      ),
    ).toEqual({ op: 'compare', field: 'created', comparison: 'eq', value: '2026-09-08' });
  });
});

describe('data events', () => {
  it('uses explicit event names and typed details', () => {
    expect(new AeliqoDataSelectionEvent('aeliqo-record-list-selection', { mode: 'ids', keys: ['id-1'] }).type).toBe(
      'aeliqo-record-list-selection',
    );
    expect(new AeliqoFilterChangeEvent({ applied: true }).detail.applied).toBe(true);
    expect(new AeliqoDataLoadMoreEvent().detail.requested).toBe(true);
  });
});
