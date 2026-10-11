import { noChange, nothing, render, type RootPart, type TemplateResult } from 'lit';
import { Directive, directive, type ChildPart } from 'lit/directive.js';
import {
  getCommittedValue,
  insertPart,
  removePart,
  setChildPartValue,
  setCommittedValue,
} from 'lit/directive-helpers.js';

type Entry = { readonly part: ChildPart; container: ChildPart };

/** Region-owned Lit parts can move between layout parents without replacing child owners. */
export class MovableNodeParts {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, ChildPart>();
  private used = new Set<string>();
  private parking: RootPart | undefined;
  private layout: string | undefined;
  private dependencies: readonly unknown[] = [];

  begin(layout?: string, dependencies: readonly unknown[] = []): void {
    this.adoptRenderedParts();
    this.used = new Set();
    const sameInputs =
      dependencies.length === this.dependencies.length &&
      dependencies.every((value, index) => value === this.dependencies[index]);
    if (layout !== undefined && layout === this.layout && sameInputs) return;
    this.layout = layout;
    this.dependencies = dependencies;
    if (this.entries.size === 0) return;
    const parking = this.parkingPart();
    // Park every owned part before Lit can discard any old ancestor template.
    for (const entry of [...this.entries.values()].reverse()) {
      setCommittedValue(entry.container, []);
      insertPart(parking, undefined, entry.part);
      entry.container = parking;
    }
    this.syncParking();
  }

  place(container: ChildPart, key: string, value: TemplateResult | typeof nothing) {
    this.used.add(key);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      // Let Lit render or hydrate the same iterable produced on the server.
      this.pending.set(key, container);
      return [value];
    }
    if (entry.container !== container) {
      insertPart(container, undefined, entry.part);
      entry.container = container;
    }
    setCommittedValue(container, [entry.part]);
    this.syncParking();
    setChildPartValue(entry.part, value);
    return noChange;
  }

  complete(): void {
    this.adoptRenderedParts();
    for (const [key, entry] of this.entries) {
      if (this.used.has(key)) continue;
      const end = entry.part.endNode;
      removePart(entry.part);
      // The installed Lit helper removes the start marker; this part owns both markers.
      end?.parentNode?.removeChild(end);
      this.entries.delete(key);
    }
    this.syncParking();
  }

  clear(): void {
    this.begin();
    this.complete();
  }

  private adoptRenderedParts(): void {
    for (const [key, container] of this.pending) {
      const parts = getCommittedValue(container) as ChildPart[] | undefined;
      if (Array.isArray(parts) && parts.length === 1) this.entries.set(key, { part: parts[0]!, container });
    }
    this.pending.clear();
  }

  private parkingPart(): RootPart {
    if (this.parking === undefined) {
      this.parking = render(nothing, document.createDocumentFragment());
      this.parking.setConnected(false);
    }
    return this.parking;
  }

  private syncParking(): void {
    if (this.parking === undefined) return;
    setCommittedValue(
      this.parking,
      [...this.entries.values()].filter((entry) => entry.container === this.parking).map((entry) => entry.part),
    );
  }
}

class MovableNodeDirective extends Directive {
  override render(_owner: MovableNodeParts, _key: string, value: TemplateResult | typeof nothing) {
    return [value];
  }

  override update(
    container: ChildPart,
    [owner, key, value]: [MovableNodeParts, string, TemplateResult | typeof nothing],
  ) {
    return owner.place(container, key, value);
  }
}

export const movableNode = directive(MovableNodeDirective);
