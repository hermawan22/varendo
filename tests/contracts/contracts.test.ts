import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT_VERSION,
  WIRE_LIMITS,
  parseCatalog,
  parseContract,
  parseExperience,
  parseInteraction,
  parsePresentationPlan,
  parseQuery,
  parseResult,
  parseResultEvent,
  parseTask,
  serializeContract,
} from '../../packages/core/src/index.js';

import {
  bindingOutcome,
  catalog,
  environment,
  experience,
  expression,
  familyFixtures,
  formTask,
  interaction,
  meaningDraft,
  modelEvaluation,
  presentationPlan,
  presentationTask,
  query,
  ref,
  result,
  resultEvents,
  task,
  taskProposal,
} from './fixtures.js';

type AnyRecord = Record<string, any>;

describe('JSON text key uniqueness', () => {
  it('rejects duplicate and escaped duplicate keys before schema parsing', () => {
    for (const input of [
      '{"version":"2","version":"1"}',
      '{"version":"2","\\u0076ersion":"1"}',
      '{"nested":{"key":1,"key":2}}',
      '[{"key":1,"key":2}]',
    ]) {
      const result = parseCatalog(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0].code).toBe('wire.duplicate-key');
    }
  });
  it('allows repeated keys in separate objects and punctuation inside strings', () => {
    const value = structuredClone(catalog) as AnyRecord;
    value.entities[0].label = 'A \\"quoted\\" label: { } [ ]';
    value.entities.push({ ...value.entities[0], id: 'another-entity' });
    expect(parseCatalog(JSON.stringify(value)).ok).toBe(true);
  });
});

const clone = <T>(value: T): T => structuredClone(value);

describe('entity-qualified field references', () => {
  it('preserves explicit entity identity through wire serialization', () => {
    for (const entity of ['employees', 'departments']) {
      const parsed = parseContract('expression', { kind: 'field', ref: 'name', entity });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const wire = serializeContract('expression', parsed.value);
        expect(wire.ok).toBe(true);
        if (wire.ok) expect(JSON.parse(wire.value)).toEqual({ kind: 'field', ref: 'name', entity });
      }
    }
    expect(parseContract('expression', { kind: 'field', ref: 'employees.name' }).ok).toBe(true);
    expect(parseContract('expression', { kind: 'field', ref: 'name', entity: 3 }).ok).toBe(false);
  });
});

function parse(kind: string, input: unknown): any {
  return parseContract(kind as never, input);
}

function expectOk<T extends { ok: boolean }>(outcome: T): asserts outcome is T & { ok: true; value: unknown } {
  expect(outcome.ok, diagnostics(outcome)).toBe(true);
}

function expectRejected(outcome: { ok: boolean; diagnostics?: readonly unknown[] }): void {
  expect(outcome.ok).toBe(false);
  expect(Array.isArray(outcome.diagnostics)).toBe(true);
  expect(outcome.diagnostics?.length).toBeGreaterThan(0);
}

function diagnostics(outcome: { ok: boolean; diagnostics?: readonly unknown[] }): string {
  return outcome.ok ? '' : JSON.stringify(outcome.diagnostics);
}

function firstDiagnostic(outcome: { ok: boolean; diagnostics?: readonly AnyRecord[] }): AnyRecord {
  expectRejected(outcome);
  return outcome.diagnostics?.[0] ?? {};
}

function deepExpression(depth: number): AnyRecord {
  let value: AnyRecord = { kind: 'literal', value: 1, type: { value: 'integer', nullable: false } };
  for (let index = 0; index < depth; index += 1) {
    value = {
      kind: 'call',
      function: { id: 'math.identity', revision: '1' },
      arguments: [value],
    };
  }
  return value;
}

function assertSortedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSortedKeys);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const object = value as AnyRecord;
  const keys = Object.keys(object);
  expect(keys).toEqual([...keys].sort());
  keys.forEach((key) => assertSortedKeys(object[key]));
}

function serialized(kind: string, input: unknown): string {
  const outcome = serializeContract(kind as never, input as never);
  expectOk(outcome);
  return outcome.value as string;
}

describe('canonical contract wire fixtures', () => {
  it('pins the public contract version and accepts the four document families', () => {
    expect(CONTRACT_VERSION).toBe('1');
    for (const [kind, fixture] of Object.entries(familyFixtures)) {
      const outcome = parse(kind, fixture);
      expectOk(outcome);
      expect(outcome.value).toEqual(fixture);
    }
  });

  it('accepts the independent wire contracts without making semantic claims', () => {
    const cases: Array<[string, unknown]> = [
      ['expression', expression],
      ['query', query],
      ['interaction', interaction],
      ['environment', environment],
      ['presentation-plan', presentationPlan],
      ['task-proposal', taskProposal],
      ['meaning-draft', meaningDraft],
      ['binding-outcome', bindingOutcome],
      ['model-evaluation', modelEvaluation],
    ];
    for (const [kind, fixture] of cases) {
      const outcome = parse(kind, fixture);
      expectOk(outcome);
      expect(outcome.value).toEqual(fixture);
    }
  });

  it('accepts every result-event variant and retains the discriminant', () => {
    for (const event of Object.values(resultEvents)) {
      const outcome = parse('result-event', event);
      expectOk(outcome);
      expect((outcome.value as AnyRecord).kind).toBe(event.kind);
    }
  });

  it('accepts JSON text as well as already parsed plain objects', () => {
    for (const [kind, fixture] of Object.entries(familyFixtures)) {
      const textOutcome = parse(kind, JSON.stringify(fixture));
      const objectOutcome = parse(kind, fixture);
      expectOk(textOutcome);
      expectOk(objectOutcome);
      expect(textOutcome.value).toEqual(objectOutcome.value);
    }
  });

  it('accepts queryless presentation and form task variants', () => {
    const presentation = parseTask(presentationTask);
    const form = parseTask(formTask);
    expectOk(presentation);
    expectOk(form);
    expect((presentation.value as AnyRecord).kind).toBe('presentation');
    expect((form.value as AnyRecord).kind).toBe('form');
  });

  it('validates an independent checked-in JSON wire fixture', () => {
    const fixturePath = fileURLToPath(new URL('./fixtures/family-wire.json', import.meta.url));
    const wire = JSON.parse(readFileSync(fixturePath, 'utf8')) as AnyRecord;
    for (const [kind, fixture] of Object.entries(wire)) {
      const outcome = parse(kind, fixture);
      expectOk(outcome);
    }
  });

  it('keeps aliases equivalent to the generic parser', () => {
    const aliases: readonly [string, (input: unknown) => any, unknown][] = [
      ['catalog', parseCatalog, catalog],
      ['task', parseTask, task],
      ['result', parseResult, result],
      ['experience', parseExperience, experience],
      ['query', parseQuery, query],
      ['interaction', parseInteraction, interaction],
      ['presentation-plan', parsePresentationPlan, presentationPlan],
      ['result-event', parseResultEvent, resultEvents.error],
    ];
    for (const [kind, alias, fixture] of aliases) {
      const generic = parse(kind, fixture);
      const named = alias(fixture);
      expectOk(generic);
      expectOk(named);
      expect(named.value).toEqual(generic.value);
    }
  });
});

describe('canonical serialization', () => {
  it('round-trips every contract kind through JSON', () => {
    const cases: readonly [string, unknown][] = [
      ...Object.entries(familyFixtures),
      ['expression', expression],
      ['query', query],
      ['interaction', interaction],
      ['environment', environment],
      ['presentation-plan', presentationPlan],
      ['task-proposal', taskProposal],
      ['meaning-draft', meaningDraft],
      ['binding-outcome', bindingOutcome],
      ['model-evaluation', modelEvaluation],
      ...Object.values(resultEvents).map((event) => ['result-event', event] as [string, unknown]),
    ];
    for (const [kind, fixture] of cases) {
      const wire = serialized(kind, fixture);
      const parsed = parse(kind, wire);
      expectOk(parsed);
      expect(serialized(kind, parsed.value)).toBe(wire);
    }
  });

  it('sorts object keys recursively while retaining array order', () => {
    const call = {
      kind: 'call',
      arguments: [
        { kind: 'literal', type: { nullable: false, value: 'integer' }, value: 1 },
        { kind: 'literal', type: { nullable: false, value: 'integer' }, value: 2 },
      ],
      function: { revision: '1', id: 'math.add' },
    };
    const wire = serialized('expression', call);
    assertSortedKeys(JSON.parse(wire));
    expect((JSON.parse(wire) as AnyRecord).arguments.map((item: AnyRecord) => item.value)).toEqual([1, 2]);
    expect(wire.indexOf('"value":1')).toBeLessThan(wire.indexOf('"value":2'));
  });

  it('retains negative zero as a distinct JSON number', () => {
    const negativeZero = clone(expression) as AnyRecord;
    negativeZero.value = -0;
    const parsed = parse('expression', negativeZero);
    expectOk(parsed);
    expect(Object.is((parsed.value as AnyRecord).value, -0)).toBe(true);
    const wire = serialized('expression', parsed.value);
    expect(wire).toMatch(/"value":-0(?:[,}])/);
    const reparsed = parse('expression', wire);
    expectOk(reparsed);
    expect(Object.is((reparsed.value as AnyRecord).value, -0)).toBe(true);
  });
});

describe('strict ingress and tagged states', () => {
  it('rejects unknown versions and unknown fields at stable paths', () => {
    const wrongVersion = clone(task) as AnyRecord;
    wrongVersion.version = '99';
    const versionDiagnostic = firstDiagnostic(parse('task', wrongVersion));
    expect(versionDiagnostic.path).toEqual(['version']);
    expect(String(versionDiagnostic.code)).toMatch(/version/i);

    const nestedExtra = clone(catalog) as AnyRecord;
    nestedExtra.entities[0].fields[0].actor = { authority: 'approved' };
    const nestedDiagnostic = firstDiagnostic(parse('catalog', nestedExtra));
    // Zod's strict-object issue points at the containing object; it remains
    // stable and avoids echoing the untrusted key/value in a diagnostic.
    expect(nestedDiagnostic.path).toEqual(['entities', 0, 'fields', 0]);

    const topLevelExtra = clone(task) as AnyRecord;
    topLevelExtra.actor = { authority: 'approved' };
    const topDiagnostic = firstDiagnostic(parse('task', topLevelExtra));
    expect(topDiagnostic.path).toEqual([]);
  });

  it('does not echo secret values in diagnostic output', () => {
    const secret = 'synthetic-redaction-fixture';
    const input = clone(task) as AnyRecord;
    input.secret = secret;
    const outcome = parse('task', input);
    expectRejected(outcome);
    expect(JSON.stringify(outcome.diagnostics)).not.toContain(secret);
  });

  it('accepts unknown, exact, estimated, approximate, partial and inferred states explicitly', () => {
    const unknownCount = clone(result) as AnyRecord;
    unknownCount.counts.population = { kind: 'unknown' };
    expectOk(parse('result', unknownCount));

    const estimated = clone(result) as AnyRecord;
    estimated.counts.population = {
      kind: 'estimated',
      value: 12,
      populationDigest: 'population-1',
      method: 'hyperloglog',
      uncertainty: { kind: 'quantified', lower: 10, upper: 14, interpretation: '95% interval' },
    };
    expectOk(parse('result', estimated));

    const approximate = clone(result) as AnyRecord;
    approximate.precision = {
      kind: 'approximate',
      method: 'sampled',
      uncertainty: { kind: 'unquantified', reason: 'source did not provide an interval' },
    };
    expectOk(parse('result', approximate));

    const partial = clone(result) as AnyRecord;
    partial.coverage = { kind: 'partial', populationDigest: 'population-1', reason: 'source stopped at the budget' };
    expectOk(parse('result', partial));

    const inferred = clone(result) as AnyRecord;
    inferred.evidence = {
      kind: 'inferred',
      recipe: { id: 'meaning-1', revision: 'meaning-r1' },
      method: 'bounded-derived-claim',
      uncertainty: { kind: 'unquantified', reason: 'requires host review' },
    };
    expectOk(parse('result', inferred));
  });

  it('rejects an estimate without method or uncertainty', () => {
    const invalid = clone(result) as AnyRecord;
    invalid.counts.population = { kind: 'estimated', value: 12, populationDigest: 'population-1' };
    const diagnostic = firstDiagnostic(parse('result', invalid));
    expect(String(diagnostic.path)).toContain('counts');
  });

  it('rejects forged proposal authority fields', () => {
    const forged = clone(taskProposal) as AnyRecord;
    forged.actor = { authority: 'approved', principal: 'attacker' };
    const outcome = parse('task-proposal', forged);
    expectRejected(outcome);
    expect(JSON.stringify(outcome.diagnostics)).not.toContain('attacker');
  });
});

describe('bounded and hostile ingress', () => {
  it('rejects accessor objects without allowing a throwing getter to escape', () => {
    const input = clone(task) as AnyRecord;
    Object.defineProperty(input, 'version', {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error('getter should never escape the parser');
      },
    });
    let outcome: any;
    expect(() => {
      outcome = parse('task', input);
    }).not.toThrow();
    expectRejected(outcome);
  });

  it('rejects cyclic values without recursion overflow', () => {
    const cyclic: AnyRecord = {
      kind: 'call',
      function: { id: 'math.identity', revision: '1' },
      arguments: [],
    };
    cyclic.arguments.push(cyclic);
    let outcome: any;
    expect(() => {
      outcome = parse('expression', cyclic);
    }).not.toThrow();
    expectRejected(outcome);
  });

  it('rejects non-JSON values at ingress', () => {
    const values = [BigInt(1), Symbol('not-json'), () => 'not-json', undefined];
    for (const value of values) {
      const invalid = clone(expression) as AnyRecord;
      invalid.value = value;
      expectRejected(parse('expression', invalid));
    }
  });

  it('enforces depth and total-node budgets independently of array limits', () => {
    const deep = parse('expression', deepExpression(WIRE_LIMITS.depth + 2));
    expectRejected(deep);
    expect(firstDiagnostic(deep).code).toBe('wire.depth');
    const boundedArrayLength = WIRE_LIMITS.array - 1;
    const groups = Math.ceil(WIRE_LIMITS.nodes / boundedArrayLength);
    const wide = {
      ...interaction,
      payload: {
        kind: 'extension',
        schema: { id: 'test', revision: '1' },
        value: Array.from({ length: groups }, () => Array(boundedArrayLength).fill(null)),
      },
    };
    const outcome = parse('interaction', wide);
    expectRejected(outcome);
    expect(firstDiagnostic(outcome).code).toBe('wire.nodes');
  });

  it('enforces a byte limit before accepting oversized JSON text', () => {
    for (const oversized of [
      `"${'x'.repeat(WIRE_LIMITS.bytes + 1)}"`,
      `"${'界'.repeat(Math.floor(WIRE_LIMITS.bytes / 3) + 1)}"`,
    ]) {
      const outcome = parse('task', oversized);
      expectRejected(outcome);
      expect(firstDiagnostic(outcome).code).toBe('wire.bytes');
    }
  });

  it('rejects non-plain objects', () => {
    expectRejected(parse('task', new Date()));
    expectRejected(parse('task', new Map([['version', '1']])));
  });
});

describe('serializer ingress', () => {
  it('revalidates forged values instead of trusting a cast', () => {
    const forged = clone(task) as AnyRecord;
    forged.actor = { authority: 'approved' };
    expectRejected(serializeContract('task' as never, forged as never));
  });
});

void formTask;
void presentationTask;
void ref;
