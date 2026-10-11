import { css } from 'lit';

export const aeliqoNavigationStyles = css`
  :host {
    color: var(--aeliqo-color-text, #111827);
    display: block;
    max-inline-size: 100%;
  }

  :is(button, a, [role='treeitem'], [role='tab']):focus-visible {
    outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-color-focus, #4338ca);
    outline-offset: var(--aeliqo-focus-offset, 0.125rem);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--aeliqo-color-focus, #4338ca) 16%, transparent);
  }

  button {
    border-radius: var(--aeliqo-radius-small, 0.375rem);
    color: inherit;
    font: inherit;
  }

  button:not(:disabled):hover,
  [role='treeitem']:not([aria-disabled='true']):hover,
  [role='tab']:not(:disabled):hover,
  [role='menuitem']:not([aria-disabled='true']):hover {
    background-color: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
  }

  :is([role='tab'], [role='treeitem'])[aria-selected='true'] {
    background-color: var(--_aeliqo-accent-selected, var(--aeliqo-color-surface, #f8fafc));
  }

  button:disabled,
  [aria-disabled='true'] {
    color: var(--aeliqo-color-muted, #4b5563);
    cursor: not-allowed;
  }
`;

const interactiveSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

type FocusTraversalState = {
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly inert: boolean;
};

function elementState(element: HTMLElement, inherited: FocusTraversalState): FocusTraversalState {
  const style = typeof globalThis.getComputedStyle === 'function' ? globalThis.getComputedStyle(element) : undefined;
  return {
    hidden: inherited.hidden || elementIsHidden(element, style),
    disabled: inherited.disabled || elementIsDisabled(element),
    inert: inherited.inert || elementIsInert(element),
  };
}

function elementIsHidden(element: HTMLElement, style: CSSStyleDeclaration | undefined): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
  return style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse';
}

function elementIsDisabled(element: HTMLElement): boolean {
  return element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';
}

function elementIsInert(element: HTMLElement): boolean {
  return (
    element.hasAttribute('inert') ||
    ('inert' in element && Boolean((element as HTMLElement & { inert?: boolean }).inert))
  );
}

function hasNegativeTabIndex(element: HTMLElement): boolean {
  const tabindex = element.getAttribute('tabindex');
  return tabindex !== null && Number.parseInt(tabindex, 10) < 0;
}

function focusableCandidate(element: HTMLElement, state: FocusTraversalState): boolean {
  return (
    element.matches(interactiveSelector) &&
    !state.hidden &&
    !state.disabled &&
    !state.inert &&
    !hasNegativeTabIndex(element)
  );
}

function ancestorState(element: HTMLElement): FocusTraversalState {
  const Element = globalThis.HTMLElement;
  if (Element === undefined) return { hidden: false, disabled: false, inert: false };
  let current: HTMLElement | null = element;
  let state: FocusTraversalState = { hidden: false, disabled: false, inert: false };
  while (current !== null) {
    state = elementState(current, state);
    const root = current.getRootNode();
    if (typeof globalThis.ShadowRoot !== 'undefined' && root instanceof globalThis.ShadowRoot) {
      current = root.host instanceof Element ? root.host : null;
    } else current = current.parentElement;
  }
  return state;
}

/** Collect focusable controls through slots and nested open shadow roots. */
export function focusableElements(root: ParentNode): HTMLElement[] {
  const Element = globalThis.HTMLElement;
  if (Element === undefined) return [];
  const Slot = globalThis.HTMLSlotElement;
  const result: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const initial = root instanceof Element ? ancestorState(root) : { hidden: false, disabled: false, inert: false };
  const visit = (node: ParentNode, inherited: FocusTraversalState): void => {
    if (node instanceof Element) {
      const state = elementState(node, inherited);
      if (focusableCandidate(node, state) && !seen.has(node)) {
        seen.add(node);
        result.push(node);
      }
      if (node.shadowRoot !== null) {
        visit(node.shadowRoot, state);
        return;
      }
      inherited = state;
    }
    if (Slot !== undefined && node instanceof Slot) {
      const assigned = node.assignedElements({ flatten: true });
      if (assigned.length > 0) {
        for (const element of assigned) visit(element, inherited);
        return;
      }
    }
    for (const child of Array.from(node.children)) visit(child, inherited);
  };
  visit(root, initial);
  return result;
}

export function focusFirst(root: ParentNode): HTMLElement | undefined {
  const target = focusableElements(root)[0];
  target?.focus();
  return target ?? undefined;
}

function descendActive(element: HTMLElement): HTMLElement {
  const Element = globalThis.HTMLElement;
  if (Element === undefined) return element;
  const assigned = activeAssignedElement(element, Element);
  if (assigned !== undefined) return assigned;
  if (element.shadowRoot !== null) {
    const nested = activeWithin(element.shadowRoot);
    if (nested !== undefined) return nested;
  }
  return element;
}

function activeAssignedElement(element: HTMLElement, Element: typeof HTMLElement): HTMLElement | undefined {
  const Slot = globalThis.HTMLSlotElement;
  if (Slot === undefined || !(element instanceof Slot)) return undefined;
  for (const assigned of element.assignedElements({ flatten: true })) {
    if (!(assigned instanceof Element)) continue;
    const nested = activeAssignedChild(assigned);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function activeAssignedChild(element: HTMLElement): HTMLElement | undefined {
  if (element.matches(':focus')) return descendActive(element);
  if (element.shadowRoot === null) return undefined;
  return activeWithin(element.shadowRoot);
}

function activeWithin(root: Document | ShadowRoot): HTMLElement | undefined {
  const Element = globalThis.HTMLElement;
  if (Element === undefined) return undefined;
  const active = root.activeElement;
  return active instanceof Element ? descendActive(active) : undefined;
}

export function activeElement(owner?: HTMLElement): HTMLElement | undefined {
  const Element = globalThis.HTMLElement;
  if (Element === undefined) return undefined;
  const nested = activeOwnerShadow(owner);
  if (nested !== undefined && nested !== owner) return nested;
  const documentElement = globalThis.document?.activeElement;
  const focused = activeOwnedElement(owner);
  if (focused !== undefined) return focused;
  return documentElement instanceof Element ? documentElement : undefined;
}

function activeOwnerShadow(owner: HTMLElement | undefined): HTMLElement | undefined {
  const root = owner?.shadowRoot;
  return root === null || root === undefined ? undefined : activeWithin(root);
}

function activeOwnedElement(owner: HTMLElement | undefined): HTMLElement | undefined {
  if (owner === undefined) return undefined;
  const focused = focusableElements(owner).find((candidate) => candidate.matches(':focus'));
  if (focused !== undefined) return focused;
  return globalThis.document?.activeElement === owner ? owner : undefined;
}

export function restoreFocus(element: HTMLElement | undefined): void {
  if (element?.isConnected) element.focus();
}

export function listenOutside(owner: HTMLElement, dismiss: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = (event: PointerEvent): void => {
    if (!event.composedPath().includes(owner)) dismiss();
  };
  document.addEventListener('pointerdown', listener, true);
  return () => document.removeEventListener('pointerdown', listener, true);
}

export function nextFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else queueMicrotask(callback);
}

export function emitAction(target: EventTarget, type: string, detail: Record<string, unknown>): boolean {
  return target.dispatchEvent(
    new CustomEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: Object.freeze({ ...detail, source: 'user' }),
    }),
  );
}

export function safeElementId(value: string, fallback: string): string {
  const normalized = [...value]
    .map((character) => {
      if (/^[a-zA-Z0-9]$/u.test(character)) return character;
      const codePoint = character.codePointAt(0);
      return `_x${codePoint === undefined ? '0' : codePoint.toString(16)}_`;
    })
    .join('');
  return normalized.length > 0 ? normalized : fallback;
}
