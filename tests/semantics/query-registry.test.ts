import { expect, it } from 'vitest';
import {
  createQueryFunctionRegistry,
  createStandardFunctionRegistry,
} from '../../packages/core/src/expressions/index.js';
it('adds explicit versioned window functions under a distinct registry digest', () => {
  const previous = createStandardFunctionRegistry();
  const next = createQueryFunctionRegistry();
  expect(previous.ok && next.ok).toBe(true);
  if (!previous.ok || !next.ok) throw new Error('registry initialization failed');
  expect(previous.value.digest).toBe('core-standard-1');
  expect(next.value.digest).toBe('core-query-1');
  for (const id of ['core.window.sum', 'core.window.lag', 'core.window.rank']) {
    expect(previous.value.resolve({ id, revision: '1' })).toBeUndefined();
    const signature = next.value.resolve({ id, revision: '1' });
    expect(signature?.contexts).toEqual(['window']);
    expect(signature?.deterministic).toBe(true);
    expect(next.value.resolve({ id, revision: '2' })).toBeUndefined();
  }
  expect(next.value.resolve({ id: 'core.window.lag', revision: '1' })?.output).toEqual({
    kind: 'nullable-same-as',
    argument: 0,
  });
  for (const signature of previous.value.signatures) expect(next.value.resolve(signature.ref)).toEqual(signature);
});
