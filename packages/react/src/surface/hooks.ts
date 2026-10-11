import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { SurfaceController, SurfaceSnapshot } from '@varendo/runtime/surfaces';

function equalArrays(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function equalRecords(left: object, right: object): boolean {
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && Object.is(left[key as keyof typeof left], right[key as keyof typeof right]),
  );
}

function equalSelection<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return equalArrays(left, right);
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object')
    return equalRecords(left, right);
  return false;
}

/** Caches selectors for React's getSnapshot contract and skips shallow-equal unrelated updates. */
export function useStoreSelector<S, T>(
  subscribe: (listener: () => void) => () => void,
  getSourceSnapshot: () => S,
  selector: (snapshot: S) => T,
): T {
  const cache = useRef<
    | {
        readonly read: typeof getSourceSnapshot;
        readonly source: S;
        readonly selector: typeof selector;
        readonly selected: T;
      }
    | undefined
  >(undefined);
  const getSelected = useCallback(() => {
    const source = getSourceSnapshot();
    const previous = cache.current;
    if (previous?.read === getSourceSnapshot && previous.source === source && previous.selector === selector)
      return previous.selected;
    const selected = selector(source);
    const stable =
      previous?.read === getSourceSnapshot && equalSelection(previous.selected, selected)
        ? previous.selected
        : selected;
    cache.current = { read: getSourceSnapshot, source, selector, selected: stable };
    return stable;
  }, [getSourceSnapshot, selector]);
  return useSyncExternalStore(subscribe, getSelected, getSelected);
}

/** Reads a real controller snapshot without a global context broadcast. */
export function useSurfaceState<I, S, T>(
  surface: SurfaceController<I, S>,
  selector: (snapshot: SurfaceSnapshot<I, S>) => T,
): T {
  const subscribe = useCallback((listener: () => void) => surface.subscribe(listener), [surface]);
  const snapshot = useCallback(() => surface.getSnapshot(), [surface]);
  return useStoreSelector(subscribe, snapshot, selector);
}

/** Measures the actual host container without reading browser globals during SSR. */
export function useContainerSize(active: boolean): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly size: { readonly inline: number; readonly block: number } | undefined;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ readonly inline: number; readonly block: number }>();
  useEffect(() => {
    const element = ref.current;
    if (!active || element === null) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const inline = Math.max(0, bounds.width);
      const block = Math.max(0, bounds.height);
      setSize((previous) => (previous?.inline === inline && previous.block === block ? previous : { inline, block }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, size };
}
