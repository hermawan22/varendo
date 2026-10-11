import { expect, it } from 'vitest';
import { createStandardFunctionRegistry } from '../../packages/core/src/expressions/index.js';
import { parseCatalog, type Catalog } from '@varendo/core';
import { createMeaningAuthoring } from '../../packages/runtime/src/meaning/index.js';

it('accepts schema-loaded field names while retaining literal-catalog typo checks', () => {
  const registry = createStandardFunctionRegistry();
  if (!registry.ok) throw Error('registry');
  const literal = {
    version: '1',
    revision: 'dynamic-catalog',
    functionRegistryDigest: registry.value.digest,
    entities: [
      {
        id: 'items',
        label: 'Items',
        identity: ['id'],
        rowGrain: ['id'],
        fields: [
          { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
          { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'integer', nullable: false } },
        ],
      },
    ],
    relationships: [],
    meanings: [],
    capabilities: [],
  } as const satisfies Catalog;
  const parsed = parseCatalog(literal);
  if (!parsed.ok) throw Error('catalog');
  const dynamic = createMeaningAuthoring({ catalog: parsed.value, registry: registry.value });
  if (!dynamic.ok) throw Error('authoring');
  expect(dynamic.value.field('items', 'amount').ok).toBe(true);
  expect(dynamic.value.field('items', 'missing')).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'semantic.unknown-field' }],
  });
  const known = createMeaningAuthoring({ catalog: literal, registry: registry.value });
  if (!known.ok) throw Error('authoring');
  expect(known.value.field('items', 'amount').ok).toBe(true);
  // @ts-expect-error Literal catalog field names remain checked at compile time.
  expect(known.value.field('items', 'missing').ok).toBe(false);
  // @ts-expect-error Literal catalog entity names remain checked at compile time.
  expect(known.value.field('missing', 'amount').ok).toBe(false);
});
