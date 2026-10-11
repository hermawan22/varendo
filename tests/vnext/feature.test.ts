import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineResource } from '../../packages/core/src/app/index.js';
import {
  DATA_FEATURE_VIEW_ALIASES,
  FeatureDefinitionError,
  defineDataFeature,
  defineFeature,
} from '../../packages/core/src/features/index.js';

const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.enum(['Design', 'Engineering']),
});

describe('vNext feature definitions', () => {
  it('creates an immutable reusable data definition without session state', () => {
    const feature = defineDataFeature({ id: 'people', schema: PersonSchema, identity: ['id'] });

    expect(feature.kind).toBe('data');
    expect(feature.definitionRevision).toBe('1');
    expect(feature.label).toBe('people');
    expect(feature.presentation.allowedViews).toEqual(['table', 'cards', 'list', 'detail', 'trend']);
    expect(Object.isFrozen(feature)).toBe(true);
    expect(Object.isFrozen(feature.identity)).toBe(true);
    expect(Object.isFrozen(feature.presentation)).toBe(true);
    expect(Object.isFrozen(feature.presentation.allowedViews)).toBe(true);
    expect(Object.isFrozen(feature.resource)).toBe(true);
    expect(Object.isFrozen(feature.catalog)).toBe(true);
    expect(Object.isFrozen(feature.entity)).toBe(true);
    expect(Object.isFrozen(feature.entity.fields)).toBe(true);
    expect(Object.isFrozen(feature.entity.fields[0])).toBe(true);
    expect(Object.isFrozen(feature.entity.identity)).toBe(true);
    expect(Object.isFrozen(feature.resource.schema)).toBe(false);
    expect(Object.isFrozen(feature.schema)).toBe(false);
    expect(Object.isFrozen(feature.presentation.allowedViews)).toBe(true);
    expect('rows' in feature).toBe(false);
    expect('principal' in feature).toBe(false);
    expect('apiKey' in feature).toBe(false);
    expect(() => ((feature as { id: string }).id = 'changed')).toThrow(TypeError);
    expect(() => (feature.presentation.allowedViews as string[]).push('unsafe')).toThrow(TypeError);
    expect(() => ((feature.entity as { label: string }).label = 'Changed')).toThrow(TypeError);
    expect(() => (feature.catalog.entities as unknown[]).push({})).toThrow(TypeError);
    expect(() => (feature.entity.fields as unknown[]).push({})).toThrow(TypeError);
    expect(() => (DATA_FEATURE_VIEW_ALIASES as unknown as string[]).push('unsafe')).toThrow(TypeError);
  });

  it('lowers through the existing ResourceDefinition path without changing its behavior', () => {
    const input = {
      id: 'people',
      label: 'People',
      revision: 'people-1',
      identity: ['id'] as const,
      schema: PersonSchema,
      fields: { team: { label: 'Team', role: 'dimension' as const } },
      presentation: { allowedViews: ['table', 'detail'] as const, preferred: { browse: 'table' as const } },
    };
    const feature = defineDataFeature(input);
    const resource = defineResource(input);

    expect({ ...feature.resource, parseRecord: undefined }).toEqual({ ...resource, parseRecord: undefined });
    expect(feature.catalog).toBe(feature.resource.catalog);
    expect(feature.entity).toBe(feature.resource.entity);
    expect(feature.parseRecord({ id: 'p1', name: 'Ada', team: 'Design' })).toEqual(
      resource.parseRecord({ id: 'p1', name: 'Ada', team: 'Design' }),
    );
  });

  it('rejects invalid identity, schema and view declarations', () => {
    expect(() => defineDataFeature({ id: 'people', schema: PersonSchema, identity: ['missing' as 'id'] })).toThrow(
      FeatureDefinitionError,
    );
    expect(() =>
      defineDataFeature({
        id: 'nested',
        schema: z.object({ id: z.string(), profile: z.object({ name: z.string() }) }),
        identity: ['id'],
      }),
    ).toThrow(FeatureDefinitionError);
    expect(() =>
      defineDataFeature({
        id: 'people',
        schema: PersonSchema,
        identity: ['id'],
        presentation: { allowedViews: ['table', 'table'] },
      }),
    ).toThrow(FeatureDefinitionError);
  });

  it('defines a bounded non-data feature with typed intents and declared capabilities', () => {
    const feature = defineFeature({
      id: 'document-job',
      label: 'Document job',
      revision: '2',
      capabilities: [
        {
          ref: { id: 'job.status', revision: '1' },
          kind: 'status',
          schema: z.object({ jobId: z.string(), state: z.enum(['queued', 'running', 'complete']) }),
        },
        {
          ref: { id: 'job.cancel', revision: '1' },
          kind: 'command',
          schema: z.object({ jobId: z.string() }),
        },
      ],
      views: [
        {
          ref: { id: 'job.progress-view', revision: '1' },
          capabilities: [{ id: 'job.status', revision: '1' }],
        },
      ],
      intents: [
        {
          ref: { id: 'job.configure', revision: '1' },
          schema: z.object({ template: z.string(), copies: z.number().int().positive() }),
          capabilities: [
            { id: 'job.status', revision: '1' },
            { id: 'job.cancel', revision: '1' },
          ],
          views: [{ id: 'job.progress-view', revision: '1' }],
        },
      ],
    });

    expect(feature.kind).toBe('feature');
    expect(feature.definitionRevision).toBe('2');
    expect('catalog' in feature).toBe(false);
    expect(Object.isFrozen(feature)).toBe(true);
    expect(Object.isFrozen(feature.capabilities)).toBe(true);
    expect(Object.isFrozen(feature.capabilities[0]?.ref)).toBe(true);
    expect(Object.isFrozen(feature.intents[0]?.capabilities)).toBe(true);
    expect(Object.isFrozen(feature.views[0]?.capabilities)).toBe(true);
    expect(
      feature.parseIntent({
        intent: { id: 'job.configure', revision: '1' },
        input: { template: 'invoice', copies: 2 },
      }),
    ).toMatchObject({ ok: true, value: { input: { template: 'invoice', copies: 2 } } });
    expect(
      feature.parseIntent({
        intent: { id: 'job.configure', revision: '1' },
        input: { template: 'invoice', copies: 0 },
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'feature.intent-input' }] });
  });

  it('rejects duplicate, malformed and unknown non-data references', () => {
    const status = {
      ref: { id: 'job.status', revision: '1' },
      kind: 'status' as const,
      schema: z.object({ jobId: z.string() }),
    };
    const configure = {
      ref: { id: 'job.configure', revision: '1' },
      schema: z.object({ template: z.string() }),
      capabilities: [{ id: 'job.status', revision: '1' }],
    };

    expect(() => defineFeature({ id: 'job', capabilities: [status, status], intents: [configure] })).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.capability-duplicate' })] }),
    );
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [status],
        intents: [{ ...configure, capabilities: [{ id: 'job.unknown', revision: '1' }] }],
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.capability-reference' })] }),
    );
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [status],
        views: [{ ref: { id: 'job.progress-view', revision: '1' }, capabilities: [status.ref] }],
        intents: [{ ...configure, views: [{ id: 'job.unknown-view', revision: '1' }] }],
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.view-reference' })] }),
    );
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [{ ...status, ref: { id: 'status', revision: '1' } }],
        intents: [configure],
      }),
    ).toThrowError(expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.reference' })] }));
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [{ ref: status.ref, schema: status.schema } as never],
        intents: [configure],
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.capability-kind' })] }),
    );
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [status],
        views: Array.from({ length: 129 }, (_, index) => ({
          ref: { id: `job.view-${index}`, revision: '1' },
          capabilities: [],
        })),
        intents: [configure],
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.reference-count' })] }),
    );
    expect(() =>
      defineFeature({
        id: 'job',
        capabilities: [
          {
            ref: { id: 'job.status@v1', revision: 'x' },
            kind: 'status',
            schema: z.object({ jobId: z.string() }),
          },
        ],
        intents: [
          {
            ref: { id: 'job.configure', revision: '1' },
            schema: z.object({ template: z.string() }),
            capabilities: [{ id: 'job.status', revision: 'v1@x' }],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'feature.capability-reference' })] }),
    );
  });
});
