import type { VersionRef } from '@varendo/core';
import type { ReactViewDefinition, ReactViewInput, ReactViewRegistry } from './types.js';

function validRef(value: VersionRef): boolean {
  return value.id.length > 0 && value.id.length <= 160 && value.revision.length > 0 && value.revision.length <= 80;
}

function refKey(ref: VersionRef): string {
  return `${ref.id}\u0000${ref.revision}`;
}

/**
 * Registers application-authored React views for an explicit adapter boundary.
 * React elements stay here; core and runtime receive only their normal contracts.
 */
export function defineReactViews<I, S>(inputs: readonly ReactViewInput<I, S>[]): ReactViewRegistry<I, S> {
  const seen = new Set<string>();
  const views: ReactViewDefinition<I, S>[] = [];
  for (const input of inputs) {
    const ref = { id: input.id, revision: input.revision };
    if (!validRef(ref)) throw new TypeError('React view references must use bounded id and revision values.');
    const hasRender = typeof input.render === 'function';
    const hasLoad = typeof input.load === 'function';
    if (hasRender === hasLoad)
      throw new TypeError(`React view ${input.id} requires exactly one render or load function.`);
    const key = refKey(ref);
    if (seen.has(key)) throw new TypeError(`React view ${input.id}@${input.revision} is already registered.`);
    seen.add(key);
    views.push(
      Object.freeze(
        hasRender ? { ref: Object.freeze(ref), render: input.render } : { ref: Object.freeze(ref), load: input.load },
      ) as ReactViewDefinition<I, S>,
    );
  }
  const frozenViews: readonly ReactViewDefinition<I, S>[] = Object.freeze(views);
  const byRef = new Map<string, ReactViewDefinition<I, S>>(
    frozenViews.map((view: ReactViewDefinition<I, S>) => [refKey(view.ref), view]),
  );
  return Object.freeze({ views: frozenViews, resolve: (ref: VersionRef) => byRef.get(refKey(ref)) });
}
