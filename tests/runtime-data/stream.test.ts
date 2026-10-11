import { describe, expect, it } from 'vitest';
import { readResultStream } from '../../packages/runtime/src/data/stream.js';
import type { ResultStreamContext } from '../../packages/runtime/src/data/stream.js';
import { resultEvents, ref } from '../contracts/fixtures.js';

const context: ResultStreamContext = {
  requestId: 'request-1',
  queryDigest: ref.queryDigest,
  scopeDigest: ref.scopeDigest,
  outputId: ref.outputId,
  sourceRevision: ref.revision,
  sourceLineage: ref.sourceLineage,
  limits: { bytes: 100_000, messageBytes: 10_000, messages: 10, rows: 10 },
};
const valid = [resultEvents.descriptor, resultEvents.batch, resultEvents.progress, resultEvents.complete];
const encode = (events: readonly unknown[]) =>
  new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
function source(bytes: Uint8Array, size = bytes.length) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + size));
      offset = Math.min(bytes.length, offset + size);
    },
  });
}
const collect = async (stream: ReadableStream<Uint8Array>, config = context) => {
  const events = [];
  for await (const event of readResultStream(stream, config)) events.push(event);
  return events;
};

describe('bounded result stream', () => {
  it('accepts split UTF-8, CRLF and a final message without newline', async () => {
    const events = [
      resultEvents.descriptor,
      { ...resultEvents.batch, rows: [{ 'employee.id': '河' }] },
      resultEvents.complete,
    ];
    const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join('\r\n'));
    expect(await collect(source(bytes, 1))).toEqual(events);
  });
  it('preserves a scoped source failure as an error event', async () => {
    expect(await collect(source(encode([resultEvents.error])))).toEqual([resultEvents.error]);
  });
  it.each([
    ['descriptor required', [resultEvents.batch], 'data.stream-descriptor'],
    ['duplicate descriptor', [resultEvents.descriptor, resultEvents.descriptor], 'data.stream-descriptor'],
    ['sequence gap', [resultEvents.descriptor, { ...resultEvents.batch, sequence: 1 }], 'data.stream-sequence'],
    [
      'changed scope',
      [
        {
          ...resultEvents.descriptor,
          descriptor: { ...resultEvents.descriptor.descriptor, ref: { ...ref, scopeDigest: 'other' } },
        },
      ],
      'data.stream-scope',
    ],
    [
      'descriptor revision differs from the accepted plan',
      [
        {
          ...resultEvents.descriptor,
          descriptor: { ...resultEvents.descriptor.descriptor, ref: { ...ref, revision: 'other' } },
        },
      ],
      'data.stream-scope',
    ],
    [
      'descriptor lineage differs from the accepted plan',
      [
        {
          ...resultEvents.descriptor,
          descriptor: { ...resultEvents.descriptor.descriptor, ref: { ...ref, sourceLineage: 'other' } },
        },
      ],
      'data.stream-scope',
    ],
    [
      'changed revision',
      [resultEvents.descriptor, { ...resultEvents.batch, result: { ...ref, revision: 'other' } }],
      'data.stream-lineage',
    ],
    ['wrong request error', [{ ...resultEvents.error, requestId: 'other' }], 'data.stream-request'],
    [
      'changed population',
      [
        resultEvents.descriptor,
        { ...resultEvents.complete, finalCoverage: { kind: 'complete', populationDigest: 'other' } },
      ],
      'data.stream-population',
    ],
    [
      'count population mismatch',
      [
        {
          ...resultEvents.descriptor,
          descriptor: {
            ...resultEvents.descriptor.descriptor,
            counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'other' } },
          },
        },
      ],
      'data.stream-population',
    ],
    [
      'inconsistent progress',
      [resultEvents.descriptor, { ...resultEvents.progress, completed: 2 }],
      'data.stream-progress',
    ],
    ['truncated', [resultEvents.descriptor, resultEvents.batch], 'data.stream-truncated'],
    ['terminal followed by data', [...valid, resultEvents.batch], 'data.stream-terminal'],
    ['unknown properties', [{ ...resultEvents.error, principal: 'admin' }], 'data.stream-shape'],
  ] as const)('rejects %s', async (_label, events, code) => {
    await expect(collect(source(encode(events)))).rejects.toMatchObject({ diagnostic: { code } });
  });
  it.each([{ bytes: 8 }, { messageBytes: 8 }, { messages: 1 }, { rows: 0 }])(
    'enforces independent budgets %j',
    async (limit) => {
      await expect(
        collect(source(encode(valid), 3), { ...context, limits: { ...context.limits, ...limit } }),
      ).rejects.toMatchObject({ diagnostic: { code: 'data.stream-budget' } });
    },
  );
  it('does not expose completion before validating EOF', async () => {
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of readResultStream(source(encode([...valid, resultEvents.batch])), context))
          seen.push(event.kind);
      })(),
    ).rejects.toMatchObject({ diagnostic: { code: 'data.stream-terminal' } });
    expect(seen).not.toContain('complete');
  });
  it('rejects malformed UTF-8 instead of replacing it', async () => {
    await expect(collect(source(Uint8Array.of(0xff, 10)))).rejects.toMatchObject({
      diagnostic: { code: 'data.stream-encoding' },
    });
  });
  it('turns a transport failure into a stable diagnostic without exposing its payload', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('private connection details'));
      },
    });
    await expect(collect(stream)).rejects.toMatchObject({
      diagnostic: {
        code: 'data.stream-network',
        message: 'Result transport failed before its stream was validated.',
      },
    });
    expect(stream.locked).toBe(false);
  });
  it('cancels a pending read and releases the lock on abort', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const pending = collect(stream, { ...context, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ diagnostic: { code: 'data.aborted' } });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
  it('finishes an early exit even when upstream cleanup never settles', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode([resultEvents.descriptor]));
      },
      cancel() {
        return new Promise(() => {});
      },
    });
    for await (const _event of readResultStream(stream, context)) break;
    expect(stream.locked).toBe(false);
  }, 500);
  it('cancels upstream when the consumer stops after a descriptor', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode([resultEvents.descriptor]));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _event of readResultStream(stream, context)) break;
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
});
