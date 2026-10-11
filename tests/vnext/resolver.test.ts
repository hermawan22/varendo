import {
  createPresentationRegistry,
  resolvePresentation,
  type PresentationPatternManifest,
  type PresentationResolverInput,
} from '../../packages/core/src/presentation/index.js';
import { describe, expect, it, vi } from 'vitest';
import { presentationPlan } from '../contracts/fixtures.js';
import {
  candidate,
  cardRef,
  context,
  fixture,
  listRef,
  manifest,
  registry,
  tableRef,
} from './fixtures/presentation.js';

describe('resolvePresentation', () => {
  function patternRegistry(
    expand: PresentationPatternManifest['expand'],
    matches: PresentationPatternManifest['matches'],
  ) {
    const pattern: PresentationPatternManifest = {
      ref: { id: 'preset.authored', revision: '1' },
      expand,
      matches,
    };
    const installed = createPresentationRegistry([manifest(tableRef), manifest(listRef)], [], [pattern]);
    if (!installed.ok) throw new Error(JSON.stringify(installed.diagnostics));
    return { installed: installed.value, pattern };
  }

  it('returns one frozen ready plan through the shared validator', () => {
    const decision = resolvePresentation(fixture());

    expect(decision.status).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.receipt.pins).toEqual({
      taskRevision: 'task-r1',
      catalogRevision: 'catalog-1',
      experienceRevision: 'experience-r1',
      functionRegistryDigest: 'functions-1',
      policyRevision: 'policy-1',
    });
    expect(decision.receipt.selectedCandidate).toBe('list');
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.plan.plan)).toBe(true);
  });

  it('normalizes legacy region read-set fields before validating authored plans', () => {
    const authored = candidate('table', tableRef);
    const decision = resolvePresentation(
      fixture({
        candidates: [
          {
            ...authored,
            plan: {
              ...authored.plan,
              preconditions: { ...authored.plan.preconditions, dataRevision: 3 } as typeof authored.plan.preconditions,
            },
          },
        ],
      }),
    );

    expect(decision.status).toBe('ready');
    if (decision.status === 'ready') expect(decision.plan.plan.preconditions).not.toHaveProperty('dataRevision');
  });

  it('uses canonical ranking and explanations when candidate order is reversed', () => {
    const input = fixture({
      candidates: [
        candidate('table', tableRef),
        candidate('unknown', { id: 'unknown.view', revision: '1' }),
        candidate('list', listRef),
      ],
    });
    const first = resolvePresentation(input);
    const reversed = resolvePresentation({ ...input, candidates: [...input.candidates].reverse() });

    expect(reversed).toEqual(first);
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.reasons).toContainEqual({ candidate: 'unknown', code: 'presentation.renderer' });
  });

  it('preserves candidate IDs that resemble internal positional labels', () => {
    const decision = resolvePresentation(
      fixture({ candidates: [candidate('candidate.1', { id: 'unknown.view', revision: '1' })] }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      rejections: [{ candidate: 'candidate.1', codes: ['presentation.renderer'] }],
      reasons: [{ candidate: 'candidate.1', code: 'presentation.renderer' }],
    });
  });

  it('returns only an explicit bounded clarification for semantic ambiguity', () => {
    const ordinary = context();
    const authorizedResult = ordinary.results[0]!;
    const decision = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          task: {
            ...ordinary.task,
            needs: ordinary.task.needs.map((need) => ({ ...need, fields: [...need.fields, 'profit', 'revenue'] })),
          },
          results: [
            {
              ...authorizedResult,
              fields: [
                ...authorizedResult.fields,
                { id: 'profit', label: 'Profit', type: { value: 'decimal', nullable: false }, role: 'measure' },
                { id: 'revenue', label: 'Revenue', type: { value: 'decimal', nullable: false }, role: 'measure' },
              ],
            },
          ],
        },
        clarification: {
          kind: 'measure',
          representation: tableRef,
          diagnostic: { code: 'presentation.ambiguous-measure', message: 'Choose a measure.', retryable: false },
          choices: [
            { id: 'revenue', label: 'https://secret.invalid/?cookie=session' },
            { id: 'profit', label: '<script>principal-secret</script>' },
          ],
        },
      }),
    );

    expect(decision).toMatchObject({
      status: 'needs-input',
      diagnostic: { message: 'Semantic input is required.' },
      choices: [
        { id: 'profit', label: 'profit' },
        { id: 'revenue', label: 'revenue' },
      ],
    });
    expect(JSON.stringify(decision)).not.toMatch(/secret|cookie|script/u);
  });

  it('rejects untrusted resolver identifiers and unrelated clarification metadata without reflecting them', () => {
    const candidateSecret = 'https://secret.invalid/<script>';
    const choiceSecret = 'bearer-private-choice';
    const unsafeCandidate = resolvePresentation(
      fixture({ candidates: [{ ...candidate('safe'), id: candidateSecret }] }),
    );
    const unrelatedChoice = resolvePresentation(
      fixture({
        clarification: {
          kind: 'measure',
          representation: tableRef,
          diagnostic: { code: 'presentation.ambiguous-measure', message: 'secret', retryable: false },
          choices: [{ id: choiceSecret, label: choiceSecret }],
        },
      }),
    );

    expect(unsafeCandidate).toMatchObject({ status: 'unsupported', diagnostic: { code: 'presentation.candidates' } });
    expect(unrelatedChoice).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.clarification' },
    });
    expect(JSON.stringify([unsafeCandidate, unrelatedChoice])).not.toMatch(/secret|script|bearer/u);
  });

  it('rejects an accessor-bearing resolver envelope without invoking host code', () => {
    let reads = 0;
    const input = { ...fixture() } as PresentationResolverInput & { target: PresentationResolverInput['target'] };
    Object.defineProperty(input, 'target', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('host getter executed');
      },
    });

    expect(resolvePresentation(input)).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.input' },
    });
    expect(reads).toBe(0);
  });

  it('rejects proxied target, candidates, and clarification without invoking value traps', () => {
    const validClarification: NonNullable<PresentationResolverInput['clarification']> = {
      kind: 'measure',
      representation: tableRef,
      diagnostic: { code: 'presentation.ambiguous-measure', message: 'Choose.', retryable: false },
      choices: [{ id: 'employee.salary', label: 'Salary' }],
    };
    for (const [field, value, code] of [
      ['target', fixture().target, 'presentation.target'],
      ['candidates', fixture().candidates, 'presentation.candidates'],
      ['clarification', validClarification, 'presentation.clarification'],
    ] as const) {
      let reads = 0;
      const proxied = new Proxy(value, {
        get(target, property, receiver) {
          reads++;
          return Reflect.get(target, property, receiver);
        },
      });
      const input = { ...fixture(), [field]: proxied } as PresentationResolverInput;

      expect(resolvePresentation(input)).toMatchObject({ status: 'unsupported', diagnostic: { code } });
      expect(reads).toBe(0);
    }
  });

  it('does not return clarification when every authored candidate is invalid', () => {
    const ordinary = context();
    const salaryResult = ordinary.results[0]!;
    const decision = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          task: {
            ...ordinary.task,
            needs: ordinary.task.needs.map((need) => ({ ...need, fields: [...need.fields, 'employee.salary'] })),
          },
          results: [
            {
              ...salaryResult,
              fields: [
                ...salaryResult.fields,
                {
                  id: 'employee.salary',
                  label: 'Salary',
                  type: { value: 'decimal', nullable: false },
                  role: 'measure',
                },
              ],
            },
          ],
        },
        candidates: [candidate('unknown', { id: 'unknown.view', revision: '1' })],
        clarification: {
          kind: 'measure',
          representation: tableRef,
          diagnostic: { code: 'presentation.ambiguous-measure', message: 'Choose.', retryable: false },
          choices: [{ id: 'employee.salary', label: 'Salary' }],
        },
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.renderer' },
      rejections: [{ candidate: 'unknown', codes: ['presentation.renderer'] }],
    });
  });

  it('rejects clarification choices that are authorized results but not requested task fields', () => {
    const ordinary = context();
    const salaryResult = ordinary.results[0]!;
    const decision = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          results: [
            {
              ...salaryResult,
              fields: [
                ...salaryResult.fields,
                {
                  id: 'employee.salary',
                  label: 'Salary',
                  type: { value: 'decimal', nullable: false },
                  role: 'measure',
                },
              ],
            },
          ],
        },
        clarification: {
          kind: 'measure',
          representation: tableRef,
          diagnostic: { code: 'presentation.ambiguous-measure', message: 'Choose.', retryable: false },
          choices: [{ id: 'employee.salary', label: 'Salary' }],
        },
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.clarification' },
    });
  });

  it('rejects a nested accessor before presentation context evaluation', () => {
    let reads = 0;
    const ordinary = context() as PresentationResolverInput['context'] & {
      experience: PresentationResolverInput['context']['experience'];
    };
    Object.defineProperty(ordinary, 'experience', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('nested host getter executed');
      },
    });

    expect(resolvePresentation(fixture({ context: ordinary }))).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.input' },
    });
    expect(reads).toBe(0);
  });

  it('rejects a proxied nested context without invoking its value traps', () => {
    let reads = 0;
    const proxied = new Proxy(context(), {
      get(target, property, receiver) {
        reads++;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(resolvePresentation(fixture({ context: proxied }))).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.input' },
    });
    expect(reads).toBe(0);
  });

  it('applies eligibility before quality ranking', () => {
    const eligible = manifest(tableRef, 1);
    const ineligible = manifest(listRef, 100);
    const input = fixture({
      registry: registry([eligible, ineligible]),
      context: {
        ...context(),
        experience: { ...context().experience, allowedRepresentations: [tableRef.id] },
      },
    });

    const decision = resolvePresentation(input);

    expect(decision).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'table' } });
    if (decision.status === 'ready')
      expect(decision.reasons).toContainEqual({ candidate: 'list', code: 'presentation.restricted' });
  });

  it('rejects unknown, disallowed, stale, and inactive inputs without a fallback plan', () => {
    const unknown = resolvePresentation(
      fixture({ candidates: [candidate('unknown', { id: 'unknown.view', revision: '1' })] }),
    );
    const disallowed = resolvePresentation(
      fixture({
        context: { ...context(), experience: { ...context().experience, allowedRepresentations: [tableRef.id] } },
        candidates: [candidate('list', listRef)],
      }),
    );
    const stale = resolvePresentation(
      fixture({ preconditions: { ...presentationPlan.preconditions, catalogRevision: 'old' } }),
    );
    const inactive = resolvePresentation(fixture({ target: { ...fixture().target, state: 'stale' } }));
    const revoked = resolvePresentation(fixture({ target: { ...fixture().target, state: 'revoked' } }));

    expect(unknown).toMatchObject({ status: 'unsupported', diagnostic: { code: 'presentation.renderer' } });
    for (const decision of [disallowed, stale, inactive, revoked]) expect(decision.status).toBe('unsupported');
  });

  it('rejects active target evidence for a different task surface', () => {
    const decision = resolvePresentation(
      fixture({
        target: {
          ...fixture().target,
          address: { ...fixture().target.address, surfaceId: 'another-region' },
        },
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.target-mismatch' },
    });
  });

  it('deliberately does not silently fall back to a registry suggestion after an authored candidate is rejected', () => {
    const suggestible = { ...manifest(tableRef), suggestConfig: () => ({ ok: true as const, value: {} }) };
    const rejected = resolvePresentation(
      fixture({
        registry: registry([suggestible]),
        candidates: [candidate('unknown', { id: 'unknown.view', revision: '1' })],
      }),
    );
    const generated = resolvePresentation(fixture({ registry: registry([suggestible]), candidates: [] }));

    expect(rejected).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.renderer' },
      rejections: [{ candidate: 'unknown', codes: ['presentation.renderer'] }],
      reasons: [{ candidate: 'unknown', code: 'presentation.renderer' }],
    });
    expect(generated).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'registered' } });
  });

  it('preserves the supplied ID when an authored pattern candidate is accepted', () => {
    const expanded = candidate('expanded', tableRef).plan;
    const { installed, pattern } = patternRegistry(
      () => ({ ok: true, value: expanded }),
      () => true,
    );
    const ordinary = context();
    const decision = resolvePresentation(
      fixture({
        registry: installed,
        context: {
          ...ordinary,
          experience: {
            ...ordinary.experience,
            allowedPatterns: [pattern.ref.id],
            composition: { ...ordinary.experience.composition, allowWithoutPreset: false },
          },
        },
        candidates: [
          {
            id: 'authored-pattern-choice',
            source: 'pattern',
            pattern: pattern.ref,
            plan: candidate('placeholder').plan,
          },
        ],
      }),
    );

    expect(decision).toMatchObject({
      status: 'ready',
      receipt: { selectedCandidate: 'authored-pattern-choice' },
    });
  });

  it('maps a rejected authored pattern to its supplied ID rather than an internal index', () => {
    const expanded = candidate('expanded', tableRef).plan;
    const { installed, pattern } = patternRegistry(
      () => ({ ok: true, value: expanded }),
      () => false,
    );
    const ordinary = context();
    const decision = resolvePresentation(
      fixture({
        registry: installed,
        context: {
          ...ordinary,
          experience: {
            ...ordinary.experience,
            allowedPatterns: [pattern.ref.id],
            composition: { ...ordinary.experience.composition, allowWithoutPreset: false },
          },
        },
        candidates: [
          {
            id: 'authored-pattern-rejected',
            source: 'pattern',
            pattern: pattern.ref,
            plan: candidate('placeholder').plan,
          },
        ],
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.pattern-required' },
      rejections: [{ candidate: 'authored-pattern-rejected', codes: ['presentation.pattern-required'] }],
      reasons: [{ code: 'presentation.pattern-required', candidate: 'authored-pattern-rejected' }],
    });
  });

  it('honors a compatible hard pin and does not fall through from an incompatible pin', () => {
    const pinnedContext = context();
    const compatible = resolvePresentation(
      fixture({
        context: {
          ...pinnedContext,
          task: { ...pinnedContext.task, viewPreference: { representation: tableRef.id, strength: 'explicit' } },
        },
      }),
    );
    const incompatibleContext = context();
    const incompatible = resolvePresentation(
      fixture({
        context: {
          ...incompatibleContext,
          task: {
            ...incompatibleContext.task,
            viewPreference: { representation: 'missing.view', strength: 'explicit' },
          },
        },
      }),
    );

    expect(compatible).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'table' } });
    expect(incompatible).toMatchObject({
      status: 'unsupported',
      reasons: expect.arrayContaining([{ code: 'presentation.pin-incompatible' }]),
    });
  });

  it('does not label unrelated stale or preparation failures as pin-incompatible', () => {
    const ordinary = context();
    const pinned = {
      ...ordinary,
      task: { ...ordinary.task, viewPreference: { representation: tableRef.id, strength: 'explicit' as const } },
    };
    const stale = resolvePresentation(
      fixture({
        context: pinned,
        preconditions: { ...presentationPlan.preconditions, catalogRevision: 'catalog-old' },
      }),
    );
    const mismatchedCurrent = resolvePresentation(
      fixture({
        context: { ...pinned, current: { ...pinned.current, regionRevision: 'region-new' } },
      }),
    );

    expect(stale).toMatchObject({ status: 'unsupported', diagnostic: { code: 'commit.stale' } });
    expect(mismatchedCurrent).toMatchObject({ status: 'unsupported', diagnostic: { code: 'commit.stale' } });
    for (const decision of [stale, mismatchedCurrent]) {
      expect(decision.reasons).not.toContainEqual({ code: 'presentation.pin-incompatible' });
    }
  });

  it('treats a soft preference as ranking input without bypassing renderer eligibility', () => {
    const preferredContext = context();
    const decision = resolvePresentation(
      fixture({
        context: {
          ...preferredContext,
          task: {
            ...preferredContext.task,
            viewPreference: { representation: listRef.id, strength: 'preferred' },
          },
          rendererCapabilities: [tableRef],
        },
      }),
    );

    expect(decision).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'table' } });
  });

  it('selects a compatible soft preference when competing candidates are both eligible', () => {
    const preferredContext = context();
    const decision = resolvePresentation(
      fixture({
        registry: registry([manifest(tableRef, 100), manifest(listRef, 0)]),
        context: {
          ...preferredContext,
          task: {
            ...preferredContext.task,
            viewPreference: { representation: listRef.id, strength: 'preferred' },
          },
        },
      }),
    );

    expect(decision).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'list' } });
  });

  it('explains an explicit pin that conflicts during candidate coverage validation', () => {
    const compare = { id: 'data.compare', revision: '1' } as const;
    const pinned = context();
    const card = candidate('cards', cardRef);
    const decision = resolvePresentation(
      fixture({
        registry: registry([manifest(cardRef)]),
        context: {
          ...pinned,
          task: {
            ...pinned.task,
            needs: [{ id: 'browse', operation: compare, fields: ['employee.id'], outputId: 'rows', required: true }],
            viewPreference: { representation: cardRef.id, strength: 'explicit' },
          },
          experience: { ...pinned.experience, allowedRepresentations: [cardRef.id] },
          rendererCapabilities: [cardRef],
        },
        candidates: [
          { ...card, plan: { ...card.plan, coverage: [{ ...card.plan.coverage[0]!, operations: [compare] }] } },
        ],
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.coverage' },
      reasons: expect.arrayContaining([{ code: 'presentation.pin-incompatible' }]),
    });
  });

  it('owns the returned decision and reads no ambient clock, randomness, performance, or network', () => {
    const input = fixture();
    const forbidden = () => {
      throw new Error('ambient clock read');
    };
    const now = vi.spyOn(Date, 'now').mockImplementation(forbidden);
    const random = vi.spyOn(Math, 'random').mockImplementation(forbidden);
    const performanceNow = vi.spyOn(globalThis.performance, 'now').mockImplementation(forbidden);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden);
    let decision: ReturnType<typeof resolvePresentation>;
    try {
      decision = resolvePresentation(input);
    } finally {
      now.mockRestore();
      random.mockRestore();
      performanceNow.mockRestore();
      fetch.mockRestore();
    }
    (input.context.environment as { locale: string }).locale = 'id-ID';
    (input.candidates[0]!.plan.nodes[0]!.config.values as Record<string, unknown>).changed = true;

    expect(decision.status).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.plan.environment.locale).toBe('en-US');
    expect(decision.plan.plan.nodes[0]!.config.values).not.toHaveProperty('changed');
    expect(Object.isFrozen(decision.plan.environment)).toBe(true);
  });

  it('bounds candidate work before registry callbacks and reports unsupported', () => {
    let configurations = 0;
    const tracked = manifest(tableRef);
    const resolver = tracked.resolveConfig;
    const input = fixture({
      registry: registry([
        {
          ...tracked,
          resolveConfig: (...args) => {
            configurations += 1;
            return resolver(...args);
          },
        },
      ]),
      candidates: Array.from({ length: 65 }, (_, index) => candidate('candidate-' + index)),
    });

    expect(resolvePresentation(input)).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.candidates' },
    });
    expect(configurations).toBe(0);
  });

  it('returns unsupported instead of a partial winner when the expansion budget is exhausted', () => {
    const limited = context();
    const decision = resolvePresentation(
      fixture({
        context: {
          ...limited,
          experience: { ...limited.experience, composition: { ...limited.experience.composition, maxExpansions: 1 } },
        },
      }),
    );

    expect(decision).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.search-exhausted' },
    });
  });
});
