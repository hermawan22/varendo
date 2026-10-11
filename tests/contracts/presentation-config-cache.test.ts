import { describe, expect, it } from 'vitest';
import { createPresentationRegistry } from '../../packages/core/src/presentation/index.js';
import {
  preparePresentationContext,
  preparePresentationValidationCache,
} from '../../packages/core/src/presentation/validate.js';
import {
  parseResolvedConfig,
  parsePresentationQuality,
  validateResolvedConfig,
} from '../../packages/core/src/presentation/validation/configuration.js';
import { environment, experience, field, presentationPlan, presentationTask, result } from './fixtures.js';

const read = Object.freeze({ id: 'data.read', revision: '1' });
const operations = Object.freeze([read]);

function validationCache(restricted = false) {
  const context = preparePresentationContext({
    task: presentationTask,
    experience,
    results: [result],
    current: presentationPlan.preconditions,
    environment,
    rendererCapabilities: [],
    ...(restricted ? { restrictions: [{ id: 'deny-read', allowedOperations: [] }] } : {}),
  });
  const registry = createPresentationRegistry([
    {
      ref: { id: 'data.table', revision: '1' },
      configSchema: { id: 'data.table.config', revision: '1' },
      roles: ['table'],
      operations,
      result: 'required',
      children: { min: 0, max: 0 },
      visibility: 'leaf',
      extension: false,
      resolveConfig: (values) => ({ ok: true, value: { values, fields: [], ports: [] } }),
    },
  ]);
  if (!context.ok || !registry.ok) throw new Error('Invalid test context');
  const cache = preparePresentationValidationCache(context.value, registry.value);
  if (!cache.ok) throw new Error('Invalid test cache');
  return cache.value;
}

function config(cache: ReturnType<typeof validationCache>, frozen = true) {
  const value = { values: {}, fields: [field.id], ports: [], operations: [read] };
  if (frozen) {
    Object.freeze(value.values);
    Object.freeze(value.fields);
    Object.freeze(value.ports);
    Object.freeze(value.operations);
    Object.freeze(value);
  }
  const raw = frozen ? Object.freeze({ ok: true, value }) : { ok: true, value };
  const parsed = parseResolvedConfig(raw, {}, cache);
  if (!parsed.ok) throw new Error('Invalid test config');
  return parsed.value;
}

describe('owned configuration validation cache', () => {
  it('checks a shared owned config once within the exact context', () => {
    const cache = validationCache();
    const declarations = cache.registry.manifests[0]!.operations;
    const value = config(cache);
    let checks = 0;
    class Fields extends Set<string> {
      override has(key: string) {
        checks++;
        return super.has(key);
      }
    }
    const fields = new Fields([field.id]);
    const first = validateResolvedConfig(value, declarations, fields, cache);
    const second = validateResolvedConfig(value, declarations, fields, cache);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(checks).toBe(1);
  });

  it('keeps field identity and absence, manifest operations, and per-context policy distinct', () => {
    const cache = validationCache();
    const declarations = cache.registry.manifests[0]!.operations;
    const value = config(cache);
    const fields = new Set([field.id]);
    expect(validateResolvedConfig(value, declarations, fields, cache).ok).toBe(true);
    expect(validateResolvedConfig(value, declarations, new Set(), cache)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.field' }],
    });
    expect(validateResolvedConfig(value, declarations, undefined, cache)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.field' }],
    });
    expect(validateResolvedConfig(value, Object.freeze([]), fields, cache)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.configuration' }],
    });
    const restricted = validationCache(true);
    expect(validateResolvedConfig(config(restricted), declarations, fields, restricted)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'presentation.restricted' }],
    });
  });

  it('does not reuse acceptance for mutable configs or another composition', () => {
    const cache = validationCache();
    const declarations = cache.registry.manifests[0]!.operations;
    const value = config(cache, false);
    const fields = new Set([field.id]);
    expect(validateResolvedConfig(value, declarations, fields, cache).ok).toBe(true);
    (value.fields as string[]).push('missing');
    expect(validateResolvedConfig(value, declarations, fields, cache).ok).toBe(false);
    const owned = config(cache);
    let checks = 0;
    class Fields extends Set<string> {
      override has(key: string) {
        checks++;
        return super.has(key);
      }
    }
    const observed = new Fields([field.id]);
    expect(validateResolvedConfig(owned, declarations, observed, cache).ok).toBe(true);
    expect(validateResolvedConfig(owned, declarations, observed, validationCache()).ok).toBe(true);
    expect(checks).toBe(2);
  });
});

describe('presentation quality cost bounds', () => {
  it.each([
    [0, true],
    [1_000_000_000_000, true],
    [-1, false],
    [0.5, false],
    [1_000_000_000_001, false],
    [Number.MAX_SAFE_INTEGER, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
    [Infinity, false],
    [NaN, false],
  ])('validates microseconds %s through the bounded schema', (microseconds, accepted) => {
    const outcome = parsePresentationQuality({
      ok: true,
      value: {
        taskFit: 100,
        informationDensity: 100,
        interactionEffort: 0,
        legibilityPenalty: 0,
        cost: { microseconds, measurement: read },
      },
    });
    expect(outcome.ok).toBe(accepted);
  });
});

describe.each(['taskFit', 'informationDensity', 'interactionEffort', 'legibilityPenalty'] as const)(
  'presentation quality %s bounds',
  (fieldName) => {
    it.each([-1, 0.5, 101, '100'])('rejects %s without contaminating the shared schema', (invalid) => {
      const valid = { taskFit: 100, informationDensity: 100, interactionEffort: 0, legibilityPenalty: 0 };
      expect(parsePresentationQuality({ ok: true, value: { ...valid, [fieldName]: invalid } })).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'presentation.quality', retryable: false }],
      });
      expect(parsePresentationQuality({ ok: true, value: valid })).toMatchObject({ ok: true, value: valid });
    });
  },
);
