import { expect, it } from 'vitest';
import {
  JOB_CANCEL_REF,
  JOB_START_REF,
  JOB_STATUS_REF,
  JobBackend,
  createJobBindings,
  jobFeature,
  type JobIntent,
} from '../../examples/vnext/job/index.js';
import { createPeopleFixture } from './fixtures/people.js';

const startIntent = (template = 'invoice', copies = 2): JobIntent =>
  ({ intent: JOB_START_REF, input: { template, copies } }) as JobIntent;
const statusIntent = (jobId: string): JobIntent => ({ intent: JOB_STATUS_REF, input: { jobId } }) as JobIntent;
const cancelIntent = (jobId: string): JobIntent => ({ intent: JOB_CANCEL_REF, input: { jobId } }) as JobIntent;

it('runs a real non-data capability surface without creating rows or a catalog', async () => {
  const fixture = createPeopleFixture();
  fixture.scope.setFeaturePermission(jobFeature.id, true);
  const backend = new JobBackend();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'document-job',
    feature: jobFeature,
    bindings: createJobBindings({ backend, initialIntent: startIntent() }),
  });

  expect(surface.getSnapshot()).toMatchObject({ phase: 'idle', state: { phase: 'idle', progress: 0 } });
  expect('rows' in surface.getSnapshot().state).toBe(false);
  expect('catalog' in jobFeature).toBe(false);

  const started = await surface.request(startIntent());
  expect(started).toMatchObject({ status: 'committed' });
  const running = surface.getSnapshot();
  expect(running.state).toMatchObject({ phase: 'running', progress: 0, template: 'invoice', copies: 2 });
  expect(backend.effects).toEqual([{ kind: 'start', jobId: 'job-1', progress: 0 }]);
  expect(fixture.runtime.snapshot(running.address.surfaceId)).toBeUndefined();

  fixture.dispose();
});

it('uses host-owned progress, cancellation, and opaque output refs', async () => {
  const fixture = createPeopleFixture();
  fixture.scope.setFeaturePermission(jobFeature.id, true);
  const backend = new JobBackend();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'document-job-progress',
    feature: jobFeature,
    bindings: createJobBindings({ backend }),
  });

  await expect(surface.request(startIntent('report', 1))).resolves.toMatchObject({ status: 'committed' });
  const jobId = surface.getSnapshot().state.jobId;
  if (jobId === undefined) throw new Error('The real job capability did not return a job identity.');

  backend.progress(jobId, 50);
  await expect(surface.request(statusIntent(jobId))).resolves.toMatchObject({ status: 'committed' });
  expect(surface.getSnapshot().state).toMatchObject({ phase: 'running', progress: 50 });

  backend.progress(jobId, 100);
  await expect(surface.request(statusIntent(jobId))).resolves.toMatchObject({ status: 'committed' });
  const completed = surface.getSnapshot().state;
  expect(completed).toMatchObject({ phase: 'complete', progress: 100, output: { jobId } });
  expect(completed.output?.ref).toMatch(/^output:\/\/job-1$/u);
  expect(completed.output?.ref).not.toContain('invoice');

  await expect(surface.request(cancelIntent(jobId))).resolves.toMatchObject({ status: 'committed' });
  expect(surface.getSnapshot().state.phase).toBe('complete');
  expect(backend.effects.map((effect) => effect.kind)).toEqual(['start', 'progress', 'complete']);
  fixture.dispose();
});

it('cancels a running job through the typed capability intent', async () => {
  const fixture = createPeopleFixture();
  fixture.scope.setFeaturePermission(jobFeature.id, true);
  const backend = new JobBackend();
  const surface = fixture.runtime.createSurface({
    scope: fixture.scope,
    id: 'document-job-cancel',
    feature: jobFeature,
    bindings: createJobBindings({ backend }),
  });

  await expect(surface.request(startIntent('animation', 3))).resolves.toMatchObject({ status: 'committed' });
  const jobId = surface.getSnapshot().state.jobId;
  if (jobId === undefined) throw new Error('The running job has no host identity.');
  await expect(surface.request(cancelIntent(jobId))).resolves.toMatchObject({ status: 'committed' });
  expect(surface.getSnapshot().state).toMatchObject({ phase: 'cancelled', progress: 0, jobId });
  expect(backend.effects.map((effect) => effect.kind)).toEqual(['start', 'cancel']);
  fixture.dispose();
});
