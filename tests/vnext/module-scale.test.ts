import { expect, it } from 'vitest';
import { createModuleScaleFixture, createTwoSurfaceFixture } from './fixtures/module-scale.js';

it('does not notify an unrelated surface on a production controller intent change', async () => {
  const fixture = createTwoSurfaceFixture();
  let notifications = 0;
  const unsubscribe = fixture.right.subscribe(() => {
    notifications += 1;
  });

  await expect(fixture.left.request(fixture.engineeringIntent)).resolves.toMatchObject({ status: 'committed' });
  expect(notifications).toBe(0);
  expect(fixture.right.getSnapshot().phase).toBe('idle');

  unsubscribe();
  await fixture.dispose();
});

it.each([10, 100, 1_000])(
  'keeps %i declared modules inactive until a selected surface needs real work',
  async (count) => {
    const fixture = createModuleScaleFixture(count);
    const unsubscribe = fixture.subscribeActive();

    expect(fixture.definitions).toHaveLength(count);
    expect(fixture.active).toHaveLength(5);
    expect(fixture.observations()).toMatchObject({
      declaredFeatureCount: count,
      activeSurfaceCount: 5,
      liveSurfaceCount: 5,
      sourceReads: 0,
      normalizations: 0,
    });

    await fixture.changeFirstSurface();
    const afterChange = fixture.observations();
    expect(afterChange.sourceReads).toBe(1);
    expect(afterChange.normalizations).toBe(1);
    expect(afterChange.listenerNotifications[0]).toBeGreaterThan(0);
    expect(afterChange.listenerNotifications.slice(1)).toEqual([0, 0, 0, 0]);

    unsubscribe();
    await fixture.dispose();
    expect(fixture.observations()).toMatchObject({ liveSurfaceCount: 0 });
  },
);

it('rejects unsupported module-scale tiers instead of silently lowering the declared profile', () => {
  expect(() => createModuleScaleFixture(0)).toThrow('1 through 1,000');
  expect(() => createModuleScaleFixture(1_001)).toThrow('1 through 1,000');
});
