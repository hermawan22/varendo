import { expect, test } from 'vitest';
import { freezePresentation, freezePresentationContainer } from '../../packages/core/src/presentation/registry.js';

test('presentation freezing owns descendants of externally shallow-frozen objects', () => {
  const child = { values: ['owned'] };
  const root = Object.freeze({ child });
  freezePresentation(root);
  expect(Object.isFrozen(child)).toBe(true);
  expect(Object.isFrozen(child.values)).toBe(true);
  expect(() => child.values.push('changed')).toThrow();
  expect(freezePresentation({ first: root, second: root }).first).toBe(root);
});

test('presentation container freezing falls back for unowned descendants', () => {
  const child = Object.freeze({ values: ['owned'] });
  const root = freezePresentationContainer({ child });
  expect(Object.isFrozen(root)).toBe(true);
  expect(Object.isFrozen(child.values)).toBe(true);
  expect(() => child.values.push('changed')).toThrow();
});

test('presentation container freezing preserves already owned descendants', () => {
  const child = freezePresentation({ values: ['owned'] });
  const root = freezePresentationContainer({ child });
  expect(Object.isFrozen(root)).toBe(true);
  expect(root.child).toBe(child);
  expect(() => root.child.values.push('changed')).toThrow();
});
