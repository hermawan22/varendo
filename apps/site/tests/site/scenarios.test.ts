import { describe, expect, it } from 'vitest';
import { compileIntent, parseIntent } from '@varendo/core';
import { PLAYGROUND_INTENTS, PLAYGROUND_RESOURCES, PLAYGROUND_SCENARIOS } from '../../src/playground/scenarios.js';

describe('0.3 playground scenarios', () => {
  it('covers four application categories with valid manual intent fixtures', () => {
    expect(PLAYGROUND_SCENARIOS.map((scenario) => scenario.id)).toEqual(['people', 'products', 'support', 'knowledge']);
    for (const scenario of PLAYGROUND_SCENARIOS) {
      expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of scenario.steps) expect(parseIntent(step.intent()).ok, `${scenario.id}/${step.id}`).toBe(true);
    }
  });

  it('keeps create/edit discovery aligned with registered forms', () => {
    expect(PLAYGROUND_RESOURCES.people.intents).not.toContain('edit');
    expect(PLAYGROUND_RESOURCES.products.intents).toEqual(expect.arrayContaining(['create', 'edit']));
    expect(PLAYGROUND_RESOURCES.tickets.intents).toContain('edit');
  });

  it('compiles a consumer-owned custom intent without modifying core', () => {
    const outcome = compileIntent(
      {
        version: '1',
        id: 'knowledge-security',
        kind: 'custom',
        resource: 'articles',
        intent: { id: 'demo.knowledge.by-topic', revision: '1' },
        input: { topic: 'Security' },
        preferredView: 'cards',
      },
      { resource: PLAYGROUND_RESOURCES.articles, regionId: 'main', customIntents: PLAYGROUND_INTENTS },
    );
    expect(outcome).toMatchObject({ ok: true, value: { kind: 'data', viewPreference: { representation: 'cards' } } });
  });
});
