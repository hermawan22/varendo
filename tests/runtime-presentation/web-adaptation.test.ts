import { describe, expect, it } from 'vitest';
import { measureAeliqoRegionEnvironment } from '../../packages/web/src/region/adaptation.js';

describe('web adaptation measurement', () => {
  it('keeps SSR/browserless facts explicit and never infers keyboard absence', () => {
    const environment = measureAeliqoRegionEnvironment(undefined);
    expect(environment.inlineSize).toEqual({ state: 'unknown' });
    expect(environment.blockSize).toEqual({ state: 'unknown' });
    expect(environment.textScale).toEqual({ state: 'unknown' });
    expect(environment.keyboard).toBe('unknown');
    expect(environment.pointer).toBe('unknown');
    expect(environment.hover).toBe('unknown');
  });

  it('accepts explicit host facts for native/SSR integration', () => {
    const environment = measureAeliqoRegionEnvironment(undefined, {
      locale: 'id-ID',
      direction: 'rtl',
      textScale: 2,
      pointer: 'mixed',
      hover: 'available',
      keyboard: 'available',
    });
    expect(environment.locale).toBe('id-ID');
    expect(environment.direction).toBe('rtl');
    expect(environment.textScale).toEqual({ state: 'known', value: 2 });
    expect(environment.pointer).toBe('mixed');
    expect(environment.keyboard).toBe('available');
  });
});
