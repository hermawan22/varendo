import { expect, it } from 'vitest';
import { z } from 'zod';
import { defineDataFeature } from '@varendo/core/features';
import { createLocalDataService } from '@varendo/runtime/data';

const feature = defineDataFeature({
  id: 'people',
  schema: z.object({ id: z.string(), name: z.string() }),
  identity: ['id'],
});

function snapshot(sourceRevision: string, name = 'Ada') {
  return {
    catalog: feature.catalog,
    sourceRevision,
    records: { people: [{ id: 'ada', name }] },
  };
}

it('accepts more than 256 controlled monotonic revisions without retaining replayable old IDs', () => {
  const service = createLocalDataService({
    snapshot: snapshot('local-source-1'),
    revisionMode: { kind: 'monotonic', prefix: 'local-source-' },
  });
  for (let sequence = 2; sequence <= 258; sequence++) {
    expect(service.replaceSnapshot(snapshot(`local-source-${sequence}`))).toMatchObject({ ok: true });
  }
  expect(service.sourceRevision).toBe('local-source-258');
  expect(service.replaceSnapshot(snapshot('local-source-2', 'Replay'))).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-revision-sequence' }],
  });
  expect(service.replaceSnapshot(snapshot('local-source-259', 'Fresh'))).toMatchObject({ ok: true });
  expect(service.sourceRevision).toBe('local-source-259');
});

it('rejects malformed sequence revisions and preserves the last accepted source', () => {
  expect(() =>
    createLocalDataService({
      snapshot: snapshot('local-source-01'),
      revisionMode: { kind: 'monotonic', prefix: 'local-source-' },
    }),
  ).toThrow('sourceRevision');
  const service = createLocalDataService({
    snapshot: snapshot('local-source-1'),
    revisionMode: { kind: 'monotonic', prefix: 'local-source-' },
  });
  for (const revision of ['local-source-0', 'local-source-01', 'other-source-2', 'local-source-9007199254740992']) {
    expect(service.replaceSnapshot(snapshot(revision))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.source-revision-sequence' }],
    });
  }
  expect(service.sourceRevision).toBe('local-source-1');
});
