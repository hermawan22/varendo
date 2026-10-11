import { describe, expect, it } from 'vitest';
import {
  compareScalars,
  scalarIdentity,
  scalarInstantParts,
  validateScalar,
} from '../../packages/core/src/contracts/scalars.js';
import type { SemanticType } from '../../packages/core/src/contracts/types.js';
const type = (value: SemanticType['value'], nullable = false): SemanticType => ({ value, nullable });
const same = (a: unknown, b: unknown, kind: SemanticType['value']) => {
  expect(compareScalars(a, b, type(kind))).toEqual({ ok: true, value: 0 });
  expect(scalarIdentity(a, type(kind))).toEqual(scalarIdentity(b, type(kind)));
};

describe('canonical scalar semantics', () => {
  it('orders exact decimals above the safe integer range without numeric coercion', () => {
    expect(
      compareScalars(
        { decimal: '9007199254740993.00000000000000000001' },
        { decimal: '9007199254740993.00000000000000000002' },
        type('decimal'),
      ),
    ).toEqual({ ok: true, value: -1 });
    expect(compareScalars({ decimal: '-0.0002' }, { decimal: '-0.0001' }, type('decimal'))).toEqual({
      ok: true,
      value: -1,
    });
    same({ decimal: '1.0' }, { decimal: '1.0000' }, 'decimal');
    same({ decimal: '-0.000' }, { decimal: '0' }, 'decimal');
    same(-0, 0, 'float');
  });
  it('compares instants by actual time and preserves arbitrary bounded fractional precision', () => {
    expect(compareScalars('2026-01-01T01:00:00+02:00', '2026-01-01T00:00:00Z', type('instant'))).toEqual({
      ok: true,
      value: -1,
    });
    expect(
      compareScalars(
        '2026-01-01T00:00:00.00000000000000000001Z',
        '2026-01-01T00:00:00.00000000000000000002Z',
        type('instant'),
      ),
    ).toEqual({ ok: true, value: -1 });
    same('2026-01-01T07:00:00.1000+07:00', '2026-01-01T00:00:00.1Z', 'instant');
    same('0000-01-01T23:30:00-01:00', '0000-01-02T00:30:00Z', 'instant');
    expect(scalarInstantParts('0000-01-01T00:00:00+01:00')).toBeDefined();
  });
  it('supports explicit years zero through ninety-nine and rejects calendar rollover or leap seconds', () => {
    for (const value of ['0000-02-29', '0099-01-01', '2000-02-29'])
      expect(validateScalar(value, type('date')).ok).toBe(true);
    for (const value of ['1900-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00'])
      expect(validateScalar(value, type('date')).ok).toBe(false);
    for (const value of [
      '2026-02-30T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+24:00',
      '2026-01-01T00:00:00+00:60',
      '2026-01-01T00:00Z',
    ])
      expect(validateScalar(value, type('instant')).ok).toBe(false);
  });
  it('preserves SQL unknown without masking malformed operands and uses Unicode code point order', () => {
    expect(compareScalars(null, 0, type('integer', true))).toEqual({ ok: true, value: null });
    expect(compareScalars(null, 'not-a-number', type('integer', true)).ok).toBe(false);
    expect(compareScalars(null, 0, type('integer')).ok).toBe(false);
    expect(compareScalars('\uE000', '\u{10000}', type('text'))).toEqual({ ok: true, value: -1 });
    expect(compareScalars('a', 'aa', type('text'))).toEqual({ ok: true, value: -1 });
  });
  it('rejects unsafe, nonfinite, untyped and overlong values', () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.5, Infinity, NaN, '2', undefined])
      expect(validateScalar(value, type('integer')).ok).toBe(false);
    expect(validateScalar('x'.repeat(16385), type('text')).ok).toBe(false);
    for (const decimal of ['1e3', '+1', '01', '.1', '1.', '1'.repeat(513)])
      expect(validateScalar({ decimal }, type('decimal')).ok).toBe(false);
    expect(validateScalar(0, { value: 'other', nullable: false } as unknown as SemanticType).ok).toBe(false);
  });
  it('rejects accessors without invoking them and isolates validated decimal values from mutation', () => {
    let calls = 0;
    const accessor = {
      get decimal() {
        calls++;
        return '1';
      },
    };
    expect(validateScalar(accessor, type('decimal')).ok).toBe(false);
    expect(calls).toBe(0);
    expect(
      validateScalar(
        {
          decimal: '1',
          toJSON() {
            throw new Error('must not run');
          },
        },
        type('decimal'),
      ).ok,
    ).toBe(false);
    const source = { decimal: '1.20' };
    const checked = validateScalar(source, type('decimal'));
    source.decimal = '9';
    expect(checked).toEqual({ ok: true, value: { decimal: '1.20' } });
    if (checked.ok) expect(Object.isFrozen(checked.value)).toBe(true);
  });
});
