export class ScopeLifecycle {
  private readonly listeners = new Set<() => void>();
  private readonly fences = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return this.remove(this.listeners, listener);
  }

  subscribeFence(listener: () => void): () => void {
    this.fences.add(listener);
    return this.remove(this.fences, listener);
  }

  notify(): void {
    for (const listener of [...this.listeners]) this.isolated(listener);
  }

  fence(): void {
    for (const listener of [...this.fences]) this.isolated(listener);
  }

  dispose(): void {
    this.fence();
    this.notify();
    this.listeners.clear();
    this.fences.clear();
  }

  private remove(collection: Set<() => void>, listener: () => void): () => void {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      collection.delete(listener);
    };
  }

  private isolated(listener: () => void): void {
    try {
      listener();
    } catch {
      // Host observers cannot interrupt scope fencing or publication.
    }
  }
}
