import { activeElement, focusableElements, focusFirst, restoreFocus } from '../navigation/shared.js';

/** Shared focus bookkeeping for overlay surfaces (dialog, drawer, popover).
 * Tracks the opener to restore on close, a pending in-surface target across
 * mode swaps, and an epoch that invalidates focus callbacks queued by stale
 * updates. */
export class OverlayFocus {
  private readonly host: HTMLElement;
  private epoch = 0;
  private opener: HTMLElement | undefined = undefined;
  private pending: HTMLElement | undefined = undefined;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** Begin a new update; callbacks carrying older epochs become stale. */
  nextEpoch(): number {
    this.epoch += 1;
    return this.epoch;
  }

  /** Remember the element to focus again once the overlay closes. */
  rememberOpener(): void {
    this.opener ??= activeElement(this.host);
  }

  /** Focus the remembered opener when still connected, then clear it. */
  restoreOpener(): void {
    restoreFocus(this.opener);
    this.opener = undefined;
  }

  /** Capture the focused descendant so a surface swap can restore it. */
  capturePending(): void {
    const active = focusableElements(this.host).find((candidate) => candidate.matches(':focus'));
    if (active !== undefined) this.pending = active;
  }

  /** Consume the captured target without focusing it. */
  takePending(): HTMLElement | undefined {
    const target = this.pending;
    this.pending = undefined;
    return target;
  }

  /** Focus `pending` when it is still inside the surface, otherwise focus the
   * first control when nothing inside the surface holds focus. Stale epochs,
   * closed overlays and detached surfaces are no-ops. */
  focusIfNeeded(
    surface: HTMLElement | null,
    epoch: number,
    open: boolean,
    pending: HTMLElement | undefined,
    restorePending: boolean,
  ): void {
    if (epoch !== this.epoch || !open || surface === null || !surface.isConnected) return;
    const focusables = focusableElements(surface);
    const current = focusables.find((candidate) => candidate.matches(':focus'));
    if (restorePending && pending?.isConnected && focusables.includes(pending)) {
      pending.focus();
      return;
    }
    if (current === undefined) focusFirst(surface);
  }

  /** Cycle Tab and Shift+Tab inside a modal surface. */
  trapTab(event: KeyboardEvent, surface: HTMLElement): void {
    const focusables = focusableElements(surface);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (first === undefined || last === undefined) return;
    const target = event.target;
    const active = target instanceof HTMLElement && focusables.includes(target) ? target : activeElement(this.host);
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
