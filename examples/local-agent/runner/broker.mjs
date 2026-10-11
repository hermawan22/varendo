import { randomUUID } from 'node:crypto';

const failure = (code, message) => ({ ok: false, diagnostics: [{ code, message, retryable: false }] });

function boundedOutcome(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean')
    return undefined;
  const encoded = JSON.stringify(value);
  return encoded.length <= 65_536 ? value : undefined;
}

/** One short-lived bridge between the trusted local process and one browser Region. */
export class BrowserSessionBroker {
  #expiresAt;
  #maxPending;
  #pending = new Map();
  #send;
  #onClose;
  #attachment;
  #expiry;

  constructor({ expiresAt, maxPending = 2 }) {
    this.#expiresAt = expiresAt;
    this.#maxPending = maxPending;
    this.#expiry = setTimeout(() => this.dispose(), Math.max(0, expiresAt - Date.now()));
    this.#expiry.unref();
  }

  get expiresAt() {
    return this.#expiresAt;
  }
  get connected() {
    return this.#send !== undefined && Date.now() < this.#expiresAt;
  }

  attach(send, onClose) {
    if (Date.now() >= this.#expiresAt) return undefined;
    this.#onClose?.();
    this.detach(this.#attachment);
    const attachment = Symbol('browser-stream');
    this.#attachment = attachment;
    this.#send = send;
    this.#onClose = onClose;
    return attachment;
  }

  detach(attachment) {
    if (attachment !== undefined && attachment !== this.#attachment) return;
    this.#attachment = undefined;
    this.#send = undefined;
    this.#onClose = undefined;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timeout);
      entry.cleanup();
      entry.resolve(failure('playground.local-disconnected', 'The browser Region disconnected.'));
    }
    this.#pending.clear();
  }

  acknowledge(id, outcome) {
    const entry = this.#pending.get(id);
    const checked = boundedOutcome(outcome);
    if (entry === undefined || checked === undefined) return false;
    this.#pending.delete(id);
    clearTimeout(entry.timeout);
    entry.cleanup();
    entry.resolve(checked);
    return true;
  }

  async call(call, signal) {
    if (!this.connected || this.#send === undefined)
      return failure(
        'playground.local-disconnected',
        'Open the local agent example and connect its browser Region first.',
      );
    if (signal?.aborted) return failure('playground.local-cancelled', 'The local tool call was cancelled.');
    if (this.#pending.size >= this.#maxPending)
      return failure('playground.local-busy', 'The paired Region already has the maximum number of pending calls.');
    const id = randomUUID();
    return new Promise((resolve) => {
      const cancel = () => {
        const entry = this.#pending.get(id);
        if (entry === undefined) return;
        this.#pending.delete(id);
        clearTimeout(entry.timeout);
        entry.cleanup();
        this.#send?.('cancel', { id });
        resolve(failure('playground.local-cancelled', 'The local tool call was cancelled.'));
      };
      const timeout = setTimeout(cancel, 15_000);
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      this.#pending.set(id, { resolve, timeout, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        this.#send('call', { id, ...call });
      } catch {
        this.#pending.delete(id);
        clearTimeout(timeout);
        cleanup();
        resolve(failure('playground.local-disconnected', 'The browser Region event stream is unavailable.'));
      }
    });
  }

  endpoint(transport) {
    const call = (operation, payload = {}, signal) => this.call({ transport, operation, ...payload }, signal);
    return Object.freeze({
      transport,
      targetRegionId: 'people-main',
      goalEpoch: 'local-agent',
      discover: (options = {}) => call('discover', {}, options.signal),
      invoke: (name, input, options) => call('invoke', { name, input, requestId: options.requestId }, options.signal),
      ...(transport === 'byok' ? { authorizeModel: (options = {}) => call('authorize', {}, options.signal) } : {}),
      close() {},
    });
  }

  dispose() {
    clearTimeout(this.#expiry);
    this.#onClose?.();
    this.detach(this.#attachment);
  }
}
