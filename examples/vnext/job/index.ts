import { defineFeature, type FeatureIntentValue } from '@varendo/core/features';
import type { CapabilitySurfaceBindings, SurfaceReadContext } from '@varendo/runtime';
import { z } from 'zod';

/**
 * A deliberately non-relational vNext example. The feature owns typed job
 * capabilities and exposes progress/output metadata; it never declares a
 * catalog, entity, row schema, or data service.
 */

export const JOB_START_REF = Object.freeze({ id: 'document-job.start', revision: '1' });
export const JOB_STATUS_REF = Object.freeze({ id: 'document-job.status', revision: '1' });
export const JOB_CANCEL_REF = Object.freeze({ id: 'document-job.cancel', revision: '1' });
export const JOB_OUTPUT_REF = Object.freeze({ id: 'document-job.output', revision: '1' });
export const JOB_PROGRESS_VIEW_REF = Object.freeze({ id: 'document-job.progress', revision: '1' });

const StartInputSchema = z.object({
  template: z.string().min(1).max(120),
  copies: z.number().int().positive().max(100),
});
const JobIdSchema = z.object({ jobId: z.string().min(1).max(160) });
const OutputSchema = z.object({ jobId: z.string(), ref: z.string().min(1).max(240) });

export const jobFeature = defineFeature({
  id: 'document-job',
  label: 'Document job',
  revision: '1',
  capabilities: [
    { ref: JOB_START_REF, kind: 'command', schema: StartInputSchema },
    { ref: JOB_STATUS_REF, kind: 'status', schema: JobIdSchema },
    { ref: JOB_CANCEL_REF, kind: 'cancel', schema: JobIdSchema },
    { ref: JOB_OUTPUT_REF, kind: 'output', schema: OutputSchema },
  ],
  views: [
    {
      ref: JOB_PROGRESS_VIEW_REF,
      capabilities: [JOB_STATUS_REF, JOB_CANCEL_REF, JOB_OUTPUT_REF],
    },
  ],
  intents: [
    {
      ref: JOB_START_REF,
      schema: StartInputSchema,
      capabilities: [JOB_START_REF, JOB_STATUS_REF, JOB_OUTPUT_REF],
      views: [JOB_PROGRESS_VIEW_REF],
    },
    {
      ref: JOB_STATUS_REF,
      schema: JobIdSchema,
      capabilities: [JOB_STATUS_REF, JOB_OUTPUT_REF],
      views: [JOB_PROGRESS_VIEW_REF],
    },
    {
      ref: JOB_CANCEL_REF,
      schema: JobIdSchema,
      capabilities: [JOB_CANCEL_REF, JOB_STATUS_REF],
      views: [JOB_PROGRESS_VIEW_REF],
    },
  ],
});

export type JobIntent = FeatureIntentValue<typeof jobFeature.intents>;
export type JobPhase = 'idle' | 'queued' | 'running' | 'complete' | 'cancelled';

export interface JobOutput {
  readonly jobId: string;
  /** Opaque host-owned output reference; the feature never exposes file bytes. */
  readonly ref: string;
}

export interface JobState {
  readonly phase: JobPhase;
  readonly jobId?: string;
  readonly template?: string;
  readonly copies?: number;
  readonly progress: number;
  readonly output?: JobOutput;
}

export interface JobEffect {
  readonly kind: 'start' | 'progress' | 'cancel' | 'complete';
  readonly jobId: string;
  readonly progress: number;
}

interface StoredJob {
  readonly jobId: string;
  readonly template: string;
  readonly copies: number;
  phase: Exclude<JobPhase, 'idle'>;
  progress: number;
}

/** Host-owned job state. It is intentionally separate from the runtime surface. */
export class JobBackend {
  readonly effects: JobEffect[] = [];
  private readonly jobs = new Map<string, StoredJob>();
  private sequence = 0;

  start(input: { readonly template: string; readonly copies: number }, signal?: AbortSignal): JobState {
    this.assertActive(signal);
    const jobId = `job-${++this.sequence}`;
    const job: StoredJob = {
      jobId,
      template: input.template,
      copies: input.copies,
      phase: 'running',
      progress: 0,
    };
    this.jobs.set(jobId, job);
    this.effects.push({ kind: 'start', jobId, progress: job.progress });
    return this.snapshot(job);
  }

  progress(jobId: string, progress: number): JobState {
    const job = this.require(jobId);
    if (job.phase === 'cancelled' || job.phase === 'complete') return this.snapshot(job);
    const bounded = Math.max(0, Math.min(100, Math.trunc(progress)));
    job.progress = bounded;
    job.phase = bounded >= 100 ? 'complete' : 'running';
    this.effects.push({ kind: bounded >= 100 ? 'complete' : 'progress', jobId, progress: bounded });
    return this.snapshot(job);
  }

  cancel(jobId: string, signal?: AbortSignal): JobState {
    this.assertActive(signal);
    const job = this.require(jobId);
    if (job.phase === 'complete') return this.snapshot(job);
    job.phase = 'cancelled';
    this.effects.push({ kind: 'cancel', jobId, progress: job.progress });
    return this.snapshot(job);
  }

  status(jobId: string, signal?: AbortSignal): JobState {
    this.assertActive(signal);
    return this.snapshot(this.require(jobId));
  }

  private require(jobId: string): StoredJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`Unknown job ${jobId}.`);
    return job;
  }

  private snapshot(job: StoredJob): JobState {
    return Object.freeze({
      phase: job.phase,
      jobId: job.jobId,
      template: job.template,
      copies: job.copies,
      progress: job.progress,
      ...(job.phase === 'complete'
        ? { output: Object.freeze({ jobId: job.jobId, ref: `output://${job.jobId}` }) }
        : {}),
    });
  }

  private assertActive(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new DOMException('The job operation was cancelled.', 'AbortError');
  }
}

export const idleJobState: JobState = Object.freeze({ phase: 'idle', progress: 0 });

export interface JobBindingsOptions {
  readonly backend: JobBackend;
  readonly initialIntent?: JobIntent;
}

function defaultIntent(): JobIntent {
  return {
    intent: JOB_START_REF,
    input: { template: 'invoice', copies: 1 },
  } as JobIntent;
}

async function readJob(intent: JobIntent, context: SurfaceReadContext, backend: JobBackend): Promise<JobState> {
  if (!context.scope.active) throw new Error('The job scope is inactive.');
  switch (intent.intent.id) {
    case JOB_START_REF.id:
      return backend.start(intent.input as { readonly template: string; readonly copies: number }, context.signal);
    case JOB_STATUS_REF.id:
      return backend.status((intent.input as { readonly jobId: string }).jobId, context.signal);
    case JOB_CANCEL_REF.id:
      return backend.cancel((intent.input as { readonly jobId: string }).jobId, context.signal);
  }
}

export function createJobBindings(options: JobBindingsOptions): CapabilitySurfaceBindings<JobIntent, JobState> {
  return {
    initialIntent: options.initialIntent ?? defaultIntent(),
    initialState: idleJobState,
    source: {
      kind: 'capability',
      read: (intent, context) => readJob(intent, context, options.backend),
    },
  };
}
