import { expect, it } from 'vitest';
import { z } from 'zod';
import { createLocalDataSurface } from '@varendo/runtime/surfaces';

const first = [
  { id: 'ada', name: 'Ada', team: 'Design' },
  { id: 'sam', name: 'Sam', team: 'Engineering' },
];

it('browses and replaces local rows through one owned controller', async () => {
  const owned = createLocalDataSurface({ data: first, getRowId: (row) => row.id });
  try {
    const address = owned.surface.address;
    expect(await owned.surface.request({ kind: 'browse' })).toMatchObject({ status: 'committed' });
    expect(owned.surface.getSnapshot().state.rows.map((row) => row.name)).toEqual(['Ada', 'Sam']);

    expect(owned.replaceData([{ id: 'ada', name: 'Ada', team: 'Engineering' }])).toMatchObject({ ok: true });
    expect(await owned.surface.request({ kind: 'browse' })).toMatchObject({ status: 'committed' });
    expect(owned.surface.address).toEqual(address);
    expect(owned.surface.getSnapshot().state.rows).toEqual([{ id: 'ada', name: 'Ada', team: 'Engineering' }]);
  } finally {
    owned.dispose();
  }
});

it('rejects duplicate identities before a replacement becomes visible', async () => {
  const owned = createLocalDataSurface({ data: first, getRowId: (row) => row.id });
  try {
    await owned.surface.request({ kind: 'browse' });
    expect(
      owned.replaceData([
        { id: 'ada', name: 'First', team: 'Design' },
        { id: 'ada', name: 'Second', team: 'Engineering' },
      ]),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'data.identity-duplicate' }],
    });
    expect(owned.surface.getSnapshot().state.rows).toHaveLength(2);
  } finally {
    owned.dispose();
  }
});

it('supports an explicitly identified empty schema and a later empty replacement', async () => {
  const schema = z.object({ id: z.string(), name: z.string() });
  const owned = createLocalDataSurface({
    data: [] as readonly { id: string; name: string }[],
    getRowId: (row) => row.id,
    schema,
    identity: 'id',
  });
  try {
    expect(await owned.surface.request({ kind: 'browse' })).toMatchObject({ status: 'committed' });
    expect(owned.surface.getSnapshot().state.rows).toEqual([]);
    expect(owned.replaceData([{ id: 'ada', name: 'Ada' }])).toMatchObject({ ok: true });
    await owned.surface.request({ kind: 'browse' });
    expect(owned.replaceData([])).toMatchObject({ ok: true });
    await owned.surface.request({ kind: 'browse' });
    expect(owned.surface.getSnapshot().state.rows).toEqual([]);
  } finally {
    owned.dispose();
  }
});

it('rejects updates after the owned local runtime is disposed', () => {
  const owned = createLocalDataSurface({ data: first, getRowId: (row) => row.id });
  owned.dispose();
  expect(owned.replaceData(first)).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'data.source-disposed' }],
  });
});

it('keeps one controller and fresh data after more than 256 updates', async () => {
  const owned = createLocalDataSurface({ data: first, getRowId: (row) => row.id });
  try {
    const address = owned.surface.address;
    for (let index = 0; index < 260; index += 1) {
      expect(owned.replaceData([{ id: 'ada', name: `Ada ${index}`, team: 'Design' }])).toMatchObject({ ok: true });
    }
    expect(await owned.surface.request({ kind: 'browse' })).toMatchObject({ status: 'committed' });
    expect(owned.surface.address).toEqual(address);
    expect(owned.surface.getSnapshot().state.rows[0]?.name).toBe('Ada 259');
  } finally {
    owned.dispose();
  }
});

it('exposes only committed runtime task and result descriptors for presentation', async () => {
  const owned = createLocalDataSurface({ data: first, getRowId: (row) => row.id });
  try {
    expect(owned.surface.presentationEvidence?.()).toBeUndefined();
    expect(await owned.surface.request({ kind: 'browse' })).toMatchObject({ status: 'committed' });
    const evidence = owned.surface.presentationEvidence?.();
    expect(evidence?.task).toMatchObject({ kind: 'data' });
    expect(evidence?.results[0]).toMatchObject({ counts: { loaded: 2 }, coverage: { kind: 'complete' } });
    expect(evidence?.current.results).toEqual([evidence?.results[0]?.ref]);
    expect(evidence?.target).toEqual({
      address: { ...owned.surface.address, surfaceId: evidence?.task.regionId },
      state: 'active',
    });
    expect(evidence?.target.address.surfaceId).not.toBe(owned.surface.address.surfaceId);
    const pending = owned.surface.request({ kind: 'browse' });
    expect(owned.surface.getSnapshot().phase).toBe('loading');
    expect(owned.surface.presentationEvidence?.()).toBeUndefined();
    expect(await pending).toMatchObject({ status: 'committed' });
    expect(owned.surface.presentationEvidence?.()?.target).toEqual(evidence?.target);
    const latestResults = owned.surface.presentationEvidence?.()?.results;
    expect(
      owned.replaceData([
        { id: 'ada', name: 'First', team: 'Design' },
        { id: 'ada', name: 'Second', team: 'Design' },
      ]),
    ).toMatchObject({ ok: false });
    expect(owned.surface.presentationEvidence?.()?.results).toEqual(latestResults);
  } finally {
    owned.dispose();
  }
  expect(owned.surface.presentationEvidence?.()).toBeUndefined();
});
