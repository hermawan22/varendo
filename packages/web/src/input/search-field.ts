import type { PropertyValues } from 'lit';
import { AeliqoTextFieldElement } from './text-field.js';
import { AeliqoSearchEvent } from './events.js';

/** Text field with an explicit, debounced query commit policy. */
export class AeliqoSearchFieldElement extends AeliqoTextFieldElement {
  static readonly properties = {
    ...AeliqoTextFieldElement.properties,
    queryOnInput: { attribute: 'query-on-input', type: Boolean },
    debounceMs: { attribute: 'debounce-ms', type: Number },
  };

  queryOnInput = false;
  debounceMs = 250;

  private queryTimer: ReturnType<typeof setTimeout> | undefined;
  private compositionActive = false;
  private userValueChange = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('aeliqo-input-change', this.handleProposal as EventListener);
    this.addEventListener('compositionstart', this.handleSearchCompositionStart as EventListener);
    this.addEventListener('compositionend', this.handleSearchCompositionEnd as EventListener);
    this.addEventListener('keydown', this.handleSearchKeyDown as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('aeliqo-input-change', this.handleProposal as EventListener);
    this.removeEventListener('compositionstart', this.handleSearchCompositionStart as EventListener);
    this.removeEventListener('compositionend', this.handleSearchCompositionEnd as EventListener);
    this.removeEventListener('keydown', this.handleSearchKeyDown as EventListener);
    this.clearQueryTimer();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if ((changed.has('value') && !this.userValueChange) || changed.has('queryOnInput')) this.clearQueryTimer();
    this.userValueChange = false;
  }

  /** Commit the current query from a host action or a keyboard Enter. */
  submitQuery(): void {
    if (this.fieldDisabled || this.readOnly || this.compositionActive) return;
    this.clearQueryTimer();
    this.dispatchEvent(new AeliqoSearchEvent({ source: 'user', query: this.value }));
  }

  private readonly handleProposal = (event: Event): void => {
    const detail = (event as CustomEvent<{ readonly value?: unknown }>).detail;
    if (typeof detail?.value !== 'string') return;
    this.userValueChange = true;
    if (this.queryOnInput && !this.compositionActive) this.scheduleQuery(detail.value);
  };

  private readonly handleSearchCompositionStart = (): void => {
    this.compositionActive = true;
    this.clearQueryTimer();
  };

  private readonly handleSearchCompositionEnd = (): void => {
    this.compositionActive = false;
    if (this.queryOnInput) this.scheduleQuery(this.value);
  };

  private readonly handleSearchKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Enter' && !keyboard.isComposing && !this.compositionActive && !keyboard.repeat)
      this.submitQuery();
  };

  private scheduleQuery(query: string): void {
    this.clearQueryTimer();
    const delay = Number.isFinite(this.debounceMs) ? Math.max(0, Math.min(10_000, this.debounceMs)) : 250;
    if (delay === 0) {
      this.dispatchEvent(new AeliqoSearchEvent({ source: 'user', query }));
      return;
    }
    this.queryTimer = setTimeout(() => {
      this.queryTimer = undefined;
      if (this.isConnected && !this.compositionActive && !this.fieldDisabled)
        this.dispatchEvent(new AeliqoSearchEvent({ source: 'user', query }));
    }, delay);
  }

  private clearQueryTimer(): void {
    if (this.queryTimer !== undefined) clearTimeout(this.queryTimer);
    this.queryTimer = undefined;
  }
}
