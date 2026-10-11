import { describe, expect, it, vi } from 'vitest';
import type { ResultEvent } from '../../packages/runtime/src/results/index.js';
import { collectResultEvents, type CollectResultEventsOptions } from '../../packages/testkit/src/index.js';
import { resultDescriptor } from './fixtures.js';

const descriptorEvent: ResultEvent = {
  kind: 'descriptor',
  descriptor: resultDescriptor(),
};

function runawaySource(onClose: () => void): AsyncIterable<ResultEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<ResultEvent> {
      return {
        async next() {
          return { done: false, value: descriptorEvent };
        },
        async return() {
          onClose();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function pendingSource(onClose: () => void): AsyncIterable<ResultEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<ResultEvent> {
      return {
        next() {
          return new Promise<IteratorResult<ResultEvent>>(() => undefined);
        },
        async return() {
          onClose();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

describe('bounded result collection', () => {
  it('closes a runaway producer at the event bound', async () => {
    let closed = false;
    const options: CollectResultEventsOptions = { maxEvents: 3, maxRows: 3, timeoutMs: 1_000 };
    await expect(
      collectResultEvents(
        runawaySource(() => {
          closed = true;
        }),
        options,
      ),
    ).rejects.toMatchObject({ name: 'ResultCollectionLimitError' });
    expect(closed).toBe(true);
  });

  it('closes a producer that never resolves next() at the deadline', async () => {
    let closed = false;
    await expect(
      collectResultEvents(
        pendingSource(() => {
          closed = true;
        }),
        {
          maxEvents: 3,
          maxRows: 3,
          timeoutMs: 20,
        },
      ),
    ).rejects.toMatchObject({ name: 'ResultCollectionTimeoutError' });
    expect(closed).toBe(true);
  });

  it('clears the timeout and abort listener when next() throws synchronously', async () => {
    vi.useFakeTimers();
    try {
      let closed = false;
      let added = 0;
      let removed = 0;
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const signal = {
        aborted: false,
        reason: undefined,
        addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
          added += 1;
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
          removed += 1;
          listeners.delete(listener);
        },
      } as unknown as AbortSignal;
      const source: AsyncIterable<ResultEvent> = {
        [Symbol.asyncIterator](): AsyncIterator<ResultEvent> {
          return {
            next() {
              throw new Error('synchronous source failure');
            },
            async return() {
              closed = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      await expect(collectResultEvents(source, { maxEvents: 3, maxRows: 3, timeoutMs: 1_000, signal })).rejects.toThrow(
        'synchronous source failure',
      );
      expect(closed).toBe(true);
      expect(added).toBe(1);
      expect(removed).toBe(1);
      expect(listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a pending producer when the host aborts collection', async () => {
    let closed = false;
    const controller = new AbortController();
    const pending = collectResultEvents(
      pendingSource(() => {
        closed = true;
      }),
      {
        maxEvents: 3,
        maxRows: 3,
        timeoutMs: 1_000,
        signal: controller.signal,
      },
    );
    await Promise.resolve();
    controller.abort('permission revoked');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(closed).toBe(true);
  });
});
