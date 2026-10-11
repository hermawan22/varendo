import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ControlledHostFixtureContract } from './fixtures/host';
import { fixtureRows } from './fixtures/people';
import type { LocalPeople } from './types/local.js';
import type { ScopedPeopleApplication } from './types/advanced.js';
import type * as InvalidConsumer from './types/invalid.js';

describe('vNext test harness', () => {
  it('uses deterministic synthetic identities and no production data', () => {
    expect(fixtureRows.map((row) => row.id)).toEqual(['ada', 'sam']);
    expect(fixtureRows.map((row) => row.team)).toEqual(['Design', 'Engineering']);
  });

  it('keeps controlled ownership as a type-only fixture contract', () => {
    type Contract = ControlledHostFixtureContract<{ readonly kind: 'browse' }, { readonly revision: string }>;
    expectTypeOf<Contract['accept']>().toBeFunction();
    expectTypeOf<Contract['proposals'][number]['intent']>().toEqualTypeOf<{ readonly kind: 'browse' }>();
  });

  it('keeps declaration-only API consumers in the strict typecheck graph', () => {
    expectTypeOf<typeof LocalPeople>().toBeFunction();
    expectTypeOf<typeof ScopedPeopleApplication>().toBeFunction();
    expectTypeOf<keyof typeof InvalidConsumer>().toBeNever();
  });
});
