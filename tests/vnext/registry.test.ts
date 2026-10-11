import { defineDataFeature, defineFeature } from '@varendo/core/features';
import type { CapabilitySurfaceBindings } from '@varendo/runtime';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createPeopleFixture, PersonSchema } from './fixtures/people.js';

function capabilityInitialIntentTypeProbe<I, S>(
  bindings: Omit<CapabilitySurfaceBindings<I, S>, 'initialIntent'>,
): void {
  // @ts-expect-error Capability bindings require a typed initial intent.
  const invalid: CapabilitySurfaceBindings<I, S> = bindings;
  void invalid;
}

void capabilityInitialIntentTypeProbe;

it('fails duplicate surface IDs and advances generation after disposal', () => {
  const f = createPeopleFixture();
  const first = f.runtime.createSurface({ scope: f.scope, id: 'people', feature: f.feature, bindings: f.bindings });
  expect(() =>
    f.runtime.createSurface({ scope: f.scope, id: 'people', feature: f.feature, bindings: f.bindings }),
  ).toThrow(/already registered/u);
  const firstGeneration = first.address.surfaceGeneration;
  first.dispose();
  const second = f.runtime.createSurface({ scope: f.scope, id: 'people', feature: f.feature, bindings: f.bindings });
  expect(second.address.surfaceGeneration).toBe(firstGeneration + 1);
  f.dispose();
});

it('reference-counts identical feature registration and rejects an active incompatible revision', () => {
  const f = createPeopleFixture();
  const left = f.runtime.createSurface({ scope: f.scope, id: 'left', feature: f.feature, bindings: f.bindings });
  const right = f.runtime.createSurface({ scope: f.scope, id: 'right', feature: f.feature, bindings: f.bindings });
  const incompatible = defineDataFeature({
    id: 'people',
    revision: '2',
    schema: PersonSchema,
    identity: ['id'],
  });

  left.dispose();
  expect(() =>
    f.runtime.createSurface({ scope: f.scope, id: 'replacement', feature: incompatible, bindings: f.bindings }),
  ).toThrow(/incompatible revision/u);
  right.dispose();
  expect(() =>
    f.runtime.createSurface({ scope: f.scope, id: 'replacement', feature: incompatible, bindings: f.bindings }),
  ).not.toThrow();
  f.dispose();
});

it('unregisters and cancels a pending capability request on dispose', async () => {
  const f = createPeopleFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({}),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'report',
    feature,
    bindings: {
      initialIntent: { intent: { id: 'report.open', revision: '1' }, input: {} },
      initialState: { value: 'initial' },
      source: {
        kind: 'capability',
        read: async () => {
          await gate;
          return { value: 'late' };
        },
      },
    },
    ownership: { mode: 'internal', defaultIntent: { intent: { id: 'report.open', revision: '1' }, input: {} } },
  });
  const pending = surface.request({ intent: { id: 'report.open', revision: '1' }, input: {} });
  await Promise.resolve();
  surface.dispose();
  const replacement = f.runtime.createSurface({
    scope: f.scope,
    id: 'report',
    feature,
    bindings: {
      initialIntent: { intent: { id: 'report.open', revision: '1' }, input: {} },
      initialState: { value: 'replacement' },
      source: { kind: 'capability', read: async () => ({ value: 'replacement-read' }) },
    },
    ownership: { mode: 'internal', defaultIntent: { intent: { id: 'report.open', revision: '1' }, input: {} } },
  });
  const replacementBefore = replacement.getSnapshot();
  release();

  await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
  expect(surface.getSnapshot().phase).toBe('disposed');
  expect(replacement.getSnapshot()).toBe(replacementBefore);
  expect(replacement.address.surfaceGeneration).toBe(surface.address.surfaceGeneration + 1);
  f.dispose();
});

it('refuses a capability result when permission changes across its async boundary', async () => {
  const f = createPeopleFixture();
  f.scope.setFeaturePermission('report', true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({}),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'permission-race',
    feature,
    bindings: {
      initialIntent: { intent: { id: 'report.open', revision: '1' }, input: {} },
      initialState: { value: 'authorized' },
      source: { kind: 'capability', read: async () => (await gate, { value: 'late' }) },
    },
    ownership: { mode: 'internal', defaultIntent: { intent: { id: 'report.open', revision: '1' }, input: {} } },
  });
  const pending = surface.request({ intent: { id: 'report.open', revision: '1' }, input: {} });
  await Promise.resolve();
  f.scope.setFeaturePermission('report', false);
  release();
  await expect(pending).resolves.toMatchObject({ status: 'denied' });
  expect(surface.getSnapshot()).toMatchObject({ phase: 'denied', state: { value: 'authorized' } });
  f.dispose();
});

it('keeps the latest revision when an older capability read resolves late', async () => {
  const f = createPeopleFixture();
  f.scope.setFeaturePermission('report', true);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({ value: z.string() }),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'revision-race',
    feature,
    bindings: {
      initialIntent: { intent: { id: 'report.open', revision: '1' }, input: { value: 'initial' } },
      initialState: { value: 'initial' },
      source: {
        kind: 'capability',
        read: async (intent) => {
          if (intent.input.value === 'first') await firstGate;
          return { value: intent.input.value };
        },
      },
    },
    ownership: {
      mode: 'internal',
      defaultIntent: { intent: { id: 'report.open', revision: '1' }, input: { value: 'initial' } },
    },
  });
  const first = surface.request({ intent: { id: 'report.open', revision: '1' }, input: { value: 'first' } });
  await Promise.resolve();
  await expect(
    surface.request({ intent: { id: 'report.open', revision: '1' }, input: { value: 'second' } }),
  ).resolves.toMatchObject({ status: 'committed' });
  const latest = surface.getSnapshot();
  releaseFirst();

  await expect(first).resolves.toMatchObject({ status: 'cancelled' });
  expect(surface.getSnapshot()).toBe(latest);
  expect(latest.state).toEqual({ value: 'second' });
  f.dispose();
});

it('rejects capability bindings without an initial intent', () => {
  const f = createPeopleFixture();
  f.scope.setFeaturePermission('report', true);
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({}),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  const bindings = {
    initialState: { value: 'initial' },
    source: { kind: 'capability', read: async () => ({ value: 'read' }) },
  } as const;
  const unsafeCreate = f.runtime.createSurface as (input: unknown) => unknown;

  expect(() =>
    unsafeCreate({ scope: f.scope, id: 'missing-intent', feature, bindings, ownership: { mode: 'internal' } }),
  ).toThrow(/initial intent/u);
  f.dispose();
});

it('uses one monotonic generation sequence without retaining per-ID tombstones', () => {
  const f = createPeopleFixture();
  const first = f.runtime.createSurface({
    scope: f.scope,
    id: 'reused',
    feature: f.feature,
    bindings: f.bindings,
  });
  first.dispose();
  let greatestGeneration = first.address.surfaceGeneration;
  for (let index = 0; index < 40; index += 1) {
    const surface = f.runtime.createSurface({
      scope: f.scope,
      id: `unique-${index}`,
      feature: f.feature,
      bindings: f.bindings,
    });
    expect(surface.address.surfaceGeneration).toBeGreaterThan(greatestGeneration);
    greatestGeneration = surface.address.surfaceGeneration;
    surface.dispose();
  }

  const replacement = f.runtime.createSurface({
    scope: f.scope,
    id: 'reused',
    feature: f.feature,
    bindings: f.bindings,
  });
  expect(replacement.address.surfaceGeneration).toBeGreaterThan(greatestGeneration);
  f.dispose();
});

it('notifies a typed denied transition exactly once after revoking ready state', async () => {
  const f = createPeopleFixture();
  f.scope.setFeaturePermission('report', true);
  const initialIntent = { intent: { id: 'report.open', revision: '1' }, input: {} } as const;
  const feature = defineFeature({
    id: 'report',
    capabilities: [{ ref: { id: 'report.read', revision: '1' }, kind: 'read', schema: z.object({}) }],
    intents: [
      {
        ref: { id: 'report.open', revision: '1' },
        schema: z.object({}),
        capabilities: [{ id: 'report.read', revision: '1' }],
      },
    ],
  });
  const surface = f.runtime.createSurface({
    scope: f.scope,
    id: 'denied-notification',
    feature,
    bindings: {
      initialIntent,
      initialState: { value: 'inert' },
      source: { kind: 'capability', read: async () => ({ value: 'secret' }) },
    },
    ownership: { mode: 'internal', defaultIntent: initialIntent },
  });
  await expect(surface.request(initialIntent)).resolves.toMatchObject({ status: 'committed' });
  expect(surface.getSnapshot()).toMatchObject({ phase: 'ready', state: { value: 'secret' } });
  const observed: unknown[] = [];
  surface.subscribe(() => observed.push(surface.getSnapshot()));
  f.scope.setFeaturePermission('report', false);

  await expect(surface.request(initialIntent)).resolves.toMatchObject({ status: 'denied' });
  expect(observed).toHaveLength(1);
  expect(observed[0]).toMatchObject({ phase: 'denied', state: { value: 'inert' } });
  expect(surface.getSnapshot()).toMatchObject({ phase: 'denied', state: { value: 'inert' } });
  await expect(surface.request(initialIntent)).resolves.toMatchObject({ status: 'denied' });
  expect(observed).toHaveLength(1);
  f.dispose();
});
