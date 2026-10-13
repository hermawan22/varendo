import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { VARENDO_WEB_VERSION, registerVarendoElements } from '../../packages/web/src/register.js';

it('registers all shared component constructors at the actual package version', () => {
  const version = (
    JSON.parse(readFileSync(new URL('../../packages/web/package.json', import.meta.url), 'utf8')) as { version: string }
  ).version;
  const constructors = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => constructors.get(name),
    define: (name: string, constructor: CustomElementConstructor) => constructors.set(name, constructor),
  } as unknown as CustomElementRegistry;
  expect(VARENDO_WEB_VERSION).toBe(version);
  registerVarendoElements(registry);
  expect(constructors.size).toBeGreaterThanOrEqual(71);
  for (const [name, constructor] of constructors)
    expect((constructor as CustomElementConstructor & { varendoVersion?: string }).varendoVersion, name).toBe(version);
  registerVarendoElements(registry);
  expect(() =>
    registerVarendoElements({
      get: () =>
        class {
          static varendoVersion = '0.1.0-m0';
        },
    } as unknown as CustomElementRegistry),
  ).toThrow('incompatible');
});
