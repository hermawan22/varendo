import { expect, test } from 'vitest';
import { inspectWire, utf8Bytes } from '../../packages/core/src/contracts/ingress.js';
import { WIRE_LIMITS } from '../../packages/core/src/contracts/limits.js';

test('wire inspection returns fresh public outcomes with the original input identity', () => {
  const input = { values: [null, true, false, 0, 'value', {}, []] };
  const first = inspectWire(input);
  const second = inspectWire(input);
  expect(first).toEqual({ ok: true, value: input });
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  if (!first.ok || !second.ok) throw Error('Expected valid wire data');
  expect(first.value).toBe(input);
  expect(second.value).toBe(input);
});

test('wire success reuse does not retain failures or state across inspections', () => {
  const shared = { valid: true };
  const valid = { first: shared, second: shared };
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw Error('Hostile inspection');
      },
    },
  );
  for (const invalid of [{ nested: NaN }, hostile, { absent: undefined }]) {
    expect(inspectWire(valid)).toEqual({ ok: true, value: valid });
    const first = inspectWire(invalid);
    const second = inspectWire(invalid);
    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(inspectWire(valid)).toEqual({ ok: true, value: valid });
  }
});

test('wire diagnostics retain exact object and array paths', () => {
  const invalid = inspectWire({ output: [{ values: [0, NaN] }] });
  expect(invalid).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.number', path: ['output', 0, 'values', 1] }],
  });
  const accessor = Object.defineProperty({}, 'hidden', {
    get() {
      throw Error('Must not execute');
    },
    enumerable: true,
  });
  expect(inspectWire({ output: [accessor] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.accessor', path: ['output', 0, 'hidden'] }],
  });
});
test('wire paths distinguish shared references from ancestor cycles', () => {
  const shared = { value: 1 };
  expect(inspectWire({ a: shared, b: shared }).ok).toBe(true);
  const cyclic: { child?: unknown } = {};
  cyclic.child = [cyclic];
  expect(inspectWire(cyclic)).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.cycle', path: ['child', 0] }] });
});
test('wire inspection does not invoke array value traps', () => {
  let reads = 0;
  const input = new Proxy([{ value: 1 }], {
    get(target, property, receiver) {
      reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  expect(inspectWire(input).ok).toBe(true);
  expect(reads).toBe(0);
});
test('reused summaries still enforce the depth limit at every occurrence', () => {
  let shared: unknown = { leaf: true };
  for (let index = 0; index < 63; index++) shared = { child: shared };
  expect(inspectWire({ first: shared, second: { deep: shared } })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.depth' }],
  });
});
test('depth limits retain the bounded diagnostic path', () => {
  let deep: unknown = false;
  for (let index = 0; index < 66; index++) deep = { child: deep };
  const checked = inspectWire(deep);
  expect(checked).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.depth', path: Array(64).fill('child') }] });
});
test('ASCII byte fast path preserves UTF-8 accounting', () => {
  for (const text of ['', 'plain ASCII\n', '\u0000\u007f', 'café', '漢字', '🚀', '\ud800']) {
    expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).byteLength);
  }
});
test('object byte accounting matches JSON at the exact boundary without a second serialization pass', () => {
  const unit = 'x'.repeat(16_000);
  const base = utf8Bytes(JSON.stringify({ values: [] }));
  const fullCount = Math.floor((WIRE_LIMITS.bytes - base + 1) / (unit.length + 3));
  const values = Array.from({ length: fullCount }, () => unit);
  const used = base + fullCount * (unit.length + 2) + Math.max(0, fullCount - 1);
  const remainder = WIRE_LIMITS.bytes - used;
  expect(remainder).toBeGreaterThanOrEqual(3);
  values.push('x'.repeat(remainder - 3));
  const exact = { values };
  expect(utf8Bytes(JSON.stringify(exact))).toBe(WIRE_LIMITS.bytes);
  expect(inspectWire(exact).ok).toBe(true);
  expect(inspectWire({ values: [...values, 'x'] })).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.bytes' }] });
});
test('escaped and unicode JSON strings use exact object byte accounting', () => {
  const marker = '"\\\b\t\n\f\r\u0000\u001f\u0080\u07ff\u0800🚀\ud800\udfff';
  const unit = 'x'.repeat(16_000);
  const base = utf8Bytes(JSON.stringify({ [marker]: [] }));
  const fullCount = Math.floor((WIRE_LIMITS.bytes - base) / (unit.length + 3));
  const values = [marker, ...Array.from({ length: fullCount }, () => unit)];
  const used = base + utf8Bytes(JSON.stringify(marker)) + fullCount * (unit.length + 3);
  const remainder = WIRE_LIMITS.bytes - used;
  expect(remainder).toBeGreaterThanOrEqual(3);
  values.push('x'.repeat(remainder - 3));
  const exact = { [marker]: values };
  expect(utf8Bytes(JSON.stringify(exact))).toBe(WIRE_LIMITS.bytes);
  expect(inspectWire(exact).ok).toBe(true);
  expect(inspectWire({ ...exact, [marker]: [...values, 'x'] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.bytes' }],
  });
});

test('undefined data properties are rejected while array length remains structural', () => {
  expect(inspectWire([])).toEqual({ ok: true, value: [] });
  expect(inspectWire({ missing: undefined })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.type', path: ['missing'] }],
  });
  expect(inspectWire([undefined])).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.type', path: [0] }],
  });
});

test('array descriptor inspection keeps trap order without reading property values', () => {
  const events: string[] = [];
  const input = new Proxy([1, undefined], {
    get(target, key, receiver) {
      events.push(`get:${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
    getPrototypeOf(target) {
      events.push('prototype');
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      events.push('keys');
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      events.push(`descriptor:${String(key)}`);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  expect(inspectWire(input)).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.type', path: [1] }] });
  expect(events).toEqual([
    'prototype',
    'keys',
    'descriptor:length',
    'descriptor:length',
    'descriptor:1',
    'descriptor:length',
    'descriptor:0',
  ]);
});

test('descriptor mutations preserve inspection order and accessors never execute', () => {
  const events: string[] = [];
  const target: { first: number | undefined; last: number } = { first: 1, last: 2 };
  const input = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      events.push(`descriptor:${String(key)}`);
      if (key === 'last') object.first = undefined;
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  expect(inspectWire(input)).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.type', path: ['first'] }] });
  expect(events).toEqual(['descriptor:length', 'descriptor:last', 'descriptor:first']);
  let reads = 0;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  expect(inspectWire(accessor)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'wire.accessor', path: ['value'] }],
  });
  expect(reads).toBe(0);
});
