import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AELIQO_WEB_VERSION, registerAeliqoElements } from '../../packages/web/src/register.js';

it('registers all shared component constructors at the actual package version', () => {
  const version = (
    JSON.parse(readFileSync(new URL('../../packages/web/package.json', import.meta.url), 'utf8')) as { version: string }
  ).version;
  const constructors = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => constructors.get(name),
    define: (name: string, constructor: CustomElementConstructor) => constructors.set(name, constructor),
  } as unknown as CustomElementRegistry;
  expect(AELIQO_WEB_VERSION).toBe(version);
  registerAeliqoElements(registry);
  expect(constructors.size).toBeGreaterThanOrEqual(71);
  for (const [name, constructor] of constructors)
    expect((constructor as CustomElementConstructor & { aeliqoVersion?: string }).aeliqoVersion, name).toBe(version);
  registerAeliqoElements(registry);
  expect(() =>
    registerAeliqoElements({
      get: () =>
        class {
          static aeliqoVersion = '0.1.0-m0';
        },
    } as unknown as CustomElementRegistry),
  ).toThrow('incompatible');
});
