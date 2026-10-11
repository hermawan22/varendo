const DEADLINE = Symbol('agent-capability-deadline');
const ABORTED = Symbol('agent-capability-aborted');

export type BoundaryResult<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'failed' };

export async function awaitAgentBoundary<T>(
  work: (signal: AbortSignal) => T | PromiseLike<T>,
  parent: AbortSignal | undefined,
  milliseconds: number,
): Promise<BoundaryResult<T>> {
  if (parent?.aborted) return { kind: 'aborted' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeParent: (() => void) | undefined;
  let resolveDeadline!: () => void;
  let resolveAbort!: () => void;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    resolveDeadline = () => {
      controller.abort();
      resolve(DEADLINE);
    };
  });
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAbort = () => {
      controller.abort();
      resolve(ABORTED);
    };
  });
  const parentCleanup = attachParentAbort(parent, resolveAbort);
  if (parentCleanup.kind === 'aborted') return { kind: 'aborted' };
  removeParent = parentCleanup.remove;
  timer = setTimeout(resolveDeadline, Math.max(0, milliseconds));
  const promise = Promise.resolve().then(() => work(controller.signal));
  try {
    const value = await Promise.race([promise, deadline, aborted]);
    return boundaryValue(value);
  } catch {
    if (parent?.aborted) return { kind: 'aborted' };
    return { kind: 'failed' };
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
    removeParent?.();
  }
}

function attachParentAbort(
  parent: AbortSignal | undefined,
  resolveAbort: () => void,
): { readonly kind: 'ready'; readonly remove?: () => void } | { readonly kind: 'aborted' } {
  if (parent === undefined) return { kind: 'ready' };
  if (parent.aborted) {
    resolveAbort();
    return { kind: 'aborted' };
  }
  const onAbort = (): void => resolveAbort();
  parent.addEventListener('abort', onAbort, { once: true });
  return { kind: 'ready', remove: () => parent.removeEventListener('abort', onAbort) };
}

function boundaryValue<T>(value: T | typeof DEADLINE | typeof ABORTED): BoundaryResult<T> {
  if (value === DEADLINE) return { kind: 'deadline' };
  if (value === ABORTED) return { kind: 'aborted' };
  return { kind: 'value', value: value as T };
}
