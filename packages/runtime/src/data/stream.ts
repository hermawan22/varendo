import { parseResultEvent, WIRE_LIMITS } from '@varendo/core';
import type { Contract, Diagnostic, Result, ResultRef } from '@varendo/core';

type ResultEvent = Contract<'result-event'>;
type TerminalResultEvent = Extract<ResultEvent, { readonly kind: 'complete' | 'error' }>;

export interface ResultStreamLimits {
  readonly bytes: number;
  readonly messageBytes: number;
  readonly messages: number;
  readonly rows: number;
}

/** Pins come from the accepted host plan, never from the stream being checked. */
export interface ResultStreamContext {
  readonly requestId: string;
  readonly queryDigest: string;
  readonly scopeDigest: string;
  readonly outputId: string;
  /** Accepted source revision; stream descriptors cannot choose another one. */
  readonly sourceRevision: string;
  /** Accepted stable source identity; live keyset revisions may advance only within this lineage. */
  readonly sourceLineage: string;
  readonly populationDigest?: string;
  readonly limits: ResultStreamLimits;
  readonly signal?: AbortSignal;
}

export class DataStreamError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DataStreamError';
    this.diagnostic = { code, message, retryable: false };
  }
}

function fail(code: string, message: string): never {
  throw new DataStreamError(code, message);
}

function sameRef(left: ResultRef, right: ResultRef): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.sourceLineage === right.sourceLineage &&
    left.outputId === right.outputId &&
    left.queryDigest === right.queryDigest &&
    left.scopeDigest === right.scopeDigest
  );
}

function matchesContext(descriptor: Result, context: ResultStreamContext): boolean {
  const { ref } = descriptor;
  return (
    ref.queryDigest === context.queryDigest &&
    ref.scopeDigest === context.scopeDigest &&
    ref.outputId === context.outputId &&
    matchesSourceRevision(ref.revision, descriptor.consistency, context) &&
    ref.sourceLineage === context.sourceLineage
  );
}

function validateLimits(limits: ResultStreamLimits): void {
  for (const limit of [limits.bytes, limits.messageBytes, limits.messages, limits.rows]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      fail('data.stream-budget', 'Stream limits must be nonnegative safe integers.');
  }
  if (limits.messageBytes === 0 || limits.messageBytes > WIRE_LIMITS.bytes || limits.messages === 0)
    fail('data.stream-budget', 'Stream message limits exceed the wire boundary or permit no messages.');
}

async function* readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  context: ResultStreamContext,
): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  while (true) {
    if (context.signal?.aborted) fail('data.aborted', 'Result stream was cancelled.');
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      if (context.signal?.aborted) fail('data.aborted', 'Result stream was cancelled.');
      fail('data.stream-network', 'Result transport failed before its stream was validated.');
    }
    if (context.signal?.aborted) fail('data.aborted', 'Result stream was cancelled.');
    if (chunk.done) return;
    bytes += chunk.value.byteLength;
    if (bytes > context.limits.bytes) fail('data.stream-budget', 'Result stream byte budget exceeded.');
    yield chunk.value;
  }
}

class ResultStreamValidator {
  private readonly context: ResultStreamContext;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly progress = new Map<string, number>();
  private messages = 0;
  private rows = 0;
  private sequence = 0;
  private reference: ResultRef | undefined;
  private population: string | undefined;
  private terminalEvent: TerminalResultEvent | undefined;

  constructor(context: ResultStreamContext) {
    this.context = context;
  }

  parseLine(line: Uint8Array): ResultEvent {
    this.checkMessageBudget();
    if (this.terminalEvent !== undefined)
      fail('data.stream-terminal', 'A result stream continued after its terminal event.');
    const event = this.parseEvent(line);
    switch (event.kind) {
      case 'error':
        return this.acceptError(event);
      case 'descriptor':
        return this.acceptDescriptor(event);
      default:
        this.checkResultReference(event.result);
        this.acceptDataEvent(event);
        if (event.kind === 'complete') this.terminalEvent = event;
        return event;
    }
  }

  get terminal(): TerminalResultEvent | undefined {
    return this.terminalEvent;
  }

  private checkMessageBudget(): void {
    if (this.context.signal?.aborted) fail('data.aborted', 'Result stream was cancelled.');
    this.messages += 1;
    if (this.messages > this.context.limits.messages) fail('data.stream-budget', 'Stream message budget exceeded.');
  }

  private parseEvent(line: Uint8Array): ResultEvent {
    let text: string;
    try {
      text = this.decoder.decode(line);
    } catch {
      return fail('data.stream-encoding', 'Result stream contains invalid UTF-8.');
    }
    const parsed = parseResultEvent(text);
    if (!parsed.ok) fail('data.stream-shape', 'Result stream message does not match the bounded event contract.');
    return parsed.value;
  }

  private acceptError(event: Extract<ResultEvent, { readonly kind: 'error' }>): ResultEvent {
    if (event.requestId !== this.context.requestId)
      fail('data.stream-request', 'Result error belongs to another request.');
    this.terminalEvent = event;
    return event;
  }

  private acceptDescriptor(event: Extract<ResultEvent, { readonly kind: 'descriptor' }>): ResultEvent {
    if (this.reference !== undefined) fail('data.stream-descriptor', 'A result stream has more than one descriptor.');
    const { ref, coverage, counts } = event.descriptor;
    if (!matchesContext(event.descriptor, this.context))
      fail('data.stream-scope', 'Result descriptor does not match the accepted query, source or authorization scope.');
    this.reference = ref;
    this.population = coverage.kind === 'unknown' ? undefined : coverage.populationDigest;
    if (this.context.populationDigest !== undefined && this.population !== this.context.populationDigest)
      fail('data.stream-population', 'Result descriptor does not match the accepted population.');
    if (
      counts.population.kind !== 'unknown' &&
      this.population !== undefined &&
      counts.population.populationDigest !== this.population
    )
      fail('data.stream-population', 'Result count and coverage refer to different populations.');
    return event;
  }

  private checkResultReference(result: ResultRef): void {
    if (this.reference === undefined)
      fail('data.stream-descriptor', 'A result stream event arrived before its descriptor.');
    if (!sameRef(this.reference, result))
      fail('data.stream-lineage', 'Result stream identity changed between messages.');
  }

  private acceptDataEvent(event: Exclude<ResultEvent, { readonly kind: 'descriptor' | 'error' }>): void {
    switch (event.kind) {
      case 'batch':
        this.acceptBatch(event);
        return;
      case 'progress':
        this.acceptProgress(event);
        return;
      case 'complete':
        this.acceptCompletion(event);
        return;
      default:
        assertNever(event);
    }
  }

  private acceptBatch(event: Extract<ResultEvent, { readonly kind: 'batch' }>): void {
    if (event.sequence !== this.sequence)
      fail('data.stream-sequence', 'Result batches must be consecutive and start at zero.');
    this.sequence += 1;
    this.rows += event.rows.length;
    if (this.rows > this.context.limits.rows) fail('data.stream-budget', 'Result stream row budget exceeded.');
  }

  private acceptProgress(event: Extract<ResultEvent, { readonly kind: 'progress' }>): void {
    const previous = this.progress.get(event.unit) ?? 0;
    if (event.completed < previous || (event.total !== undefined && event.completed > event.total))
      fail('data.stream-progress', 'Result stream progress is inconsistent.');
    this.progress.set(event.unit, event.completed);
  }

  private acceptCompletion(event: Extract<ResultEvent, { readonly kind: 'complete' }>): void {
    const coverage = event.finalCoverage;
    if (
      this.context.populationDigest !== undefined &&
      (coverage.kind === 'unknown' || coverage.populationDigest !== this.context.populationDigest)
    )
      fail('data.stream-population', 'Result completion does not match the accepted population.');
    if (this.population !== undefined && coverage.kind !== 'unknown' && coverage.populationDigest !== this.population)
      fail('data.stream-population', 'Result stream population changed at completion.');
  }
}

function matchesSourceRevision(
  revision: string,
  consistency: Result['consistency'],
  context: ResultStreamContext,
): boolean {
  if (revision === context.sourceRevision) return true;
  if (consistency.kind !== 'mixed' || consistency.sourceLineage !== context.sourceLineage) return false;
  return Object.values(consistency.sourceRevisions).includes(revision);
}

function assertNever(value: never): never {
  return value;
}

class LineFramer {
  private readonly maximumBytes: number;
  private buffer: Uint8Array;
  private used = 0;

  constructor(maximumBytes: number) {
    this.maximumBytes = maximumBytes;
    this.buffer = new Uint8Array(Math.min(4096, maximumBytes));
  }

  *push(chunk: Uint8Array, validator: ResultStreamValidator): Generator<ResultEvent> {
    for (const byte of chunk) {
      if (byte === 10) {
        yield validator.parseLine(this.consume());
        continue;
      }
      this.append(byte);
    }
  }

  *finish(validator: ResultStreamValidator): Generator<ResultEvent> {
    if (this.used === 0) return;
    yield validator.parseLine(this.consume());
  }

  private consume(): Uint8Array {
    const line = this.buffer.subarray(0, this.used);
    this.used = 0;
    return line;
  }

  private append(byte: number): void {
    if (this.used >= this.maximumBytes) fail('data.stream-budget', 'Result stream message byte budget exceeded.');
    if (this.used === this.buffer.length) this.grow();
    this.buffer[this.used] = byte;
    this.used += 1;
  }

  private grow(): void {
    const grown = new Uint8Array(Math.min(this.maximumBytes, this.buffer.length * 2));
    grown.set(this.buffer);
    this.buffer = grown;
  }
}

function* visibleEvents(events: Generator<ResultEvent>, validator: ResultStreamValidator): Generator<ResultEvent> {
  for (const event of events) {
    if (validator.terminal !== undefined) continue;
    yield event;
  }
}

async function* validatedEvents(
  chunks: AsyncIterable<Uint8Array>,
  framing: LineFramer,
  validator: ResultStreamValidator,
): AsyncGenerator<ResultEvent> {
  for await (const chunk of chunks) yield* visibleEvents(framing.push(chunk, validator), validator);
  yield* visibleEvents(framing.finish(validator), validator);
  if (validator.terminal === undefined)
    fail('data.stream-truncated', 'Result stream ended without a completion or error event.');
  yield validator.terminal;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => {});
}

/** Validates framing and stream lineage. It does not prove data or prose truth. */
export async function* readResultStream(
  source: ReadableStream<Uint8Array>,
  context: ResultStreamContext,
): AsyncGenerator<ResultEvent> {
  validateLimits(context.limits);
  const reader = source.getReader();
  const abort = () => cancelReader(reader);
  context.signal?.addEventListener('abort', abort, { once: true });
  const framing = new LineFramer(context.limits.messageBytes);
  const validator = new ResultStreamValidator(context);
  try {
    yield* validatedEvents(readChunks(reader, context), framing, validator);
  } finally {
    context.signal?.removeEventListener('abort', abort);
    // Cancellation may never settle; release the consumer without waiting on it.
    cancelReader(reader);
    reader.releaseLock();
  }
}
