export class SurfaceListeners {
  private readonly listeners = new Set<() => void>();
  private externalUnsubscribe: (() => void) | undefined;

  subscribe(listener: () => void, attachExternal?: () => () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && attachExternal !== undefined) this.externalUnsubscribe = attachExternal();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detachExternal();
    };
  }

  notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* Observers never control surface state or cleanup. */
      }
    }
  }

  dispose(): void {
    this.detachExternal();
    this.listeners.clear();
  }

  private detachExternal(): void {
    const unsubscribe = this.externalUnsubscribe;
    this.externalUnsubscribe = undefined;
    try {
      unsubscribe?.();
    } catch {
      /* Host observer cleanup cannot retain surface listeners. */
    }
  }
}
