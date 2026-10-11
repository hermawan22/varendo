import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoComboboxQueryEvent, AeliqoInputChangeEvent } from './events.js';
import type { AeliqoOption } from './options.js';
import { validOptions } from './options.js';

export type AeliqoOptionsLoader = (
  query: string,
  signal: AbortSignal,
) => readonly AeliqoOption[] | Promise<readonly AeliqoOption[]>;

const COMBOBOX_MAX_OPTIONS = 500;

/** Searchable, bounded choice control with stale-result protection. */
export class AeliqoComboboxElement extends AeliqoFieldElement<string> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    options: { attribute: false },
    optionsLoader: { attribute: false },
    value: { type: String, reflect: true },
    defaultValue: { attribute: 'default-value', type: String },
    query: { type: String },
    placeholder: { type: String },
    open: { type: Boolean, reflect: true },
    minQueryLength: { attribute: 'min-query-length', type: Number },
  };

  options: readonly AeliqoOption[] = [];
  optionsLoader: AeliqoOptionsLoader | undefined;
  value = '';
  defaultValue = '';
  query = '';
  placeholder = '';
  open = false;
  minQueryLength = 0;

  private activeIndex = -1;
  private loadSequence = 0;
  private loadAbort: AbortController | undefined;
  private composing = false;
  private suppressTrailingCompositionInput: string | undefined;

  override connectedCallback(): void {
    if (this.value.length === 0 && this.defaultValue.length > 0) this.value = this.defaultValue;
    super.connectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('optionsLoader')) {
      this.cancelLoader();
      this.validationState = 'idle';
      this.error = '';
    }
    if (changed.has('value') && !changed.has('query')) this.query = this.labelForValue(this.value);
    super.willUpdate(changed);
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (['options', 'value', 'disabled', 'required', 'error'].some((key) => changed.has(key))) this.syncNative();
  }

  protected override isCurrentValidationValue(value: string): boolean {
    return value === this.value;
  }

  override disconnectedCallback(): void {
    this.cancelLoader();
    super.disconnectedCallback();
  }

  protected override resetField(): void {
    this.value = this.defaultValue;
    this.query = this.labelForValue(this.value);
    this.open = false;
    this.activeIndex = -1;
    this.cancelLoader();
    this.validationState = 'idle';
    this.error = '';
    this.syncNative();
  }

  protected override render() {
    const options = this.safeOptions();
    const filtered = this.filteredOptions(options);
    const describedBy = this.describedByIds();
    const selected = options.find((option) => option.value === this.value);
    const activeDescendant = this.activeOptionId(filtered);
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        ${this.renderMessages()}
        <div class="combobox-wrap">
          <input
            part="input"
            id="control"
            type="text"
            role="combobox"
            autocomplete=${this.autocomplete || 'off'}
            .value=${this.displayQuery()}
            placeholder=${this.placeholder || nothing}
            ?disabled=${this.fieldDisabled}
            ?readonly=${this.readOnly}
            aria-expanded=${this.open ? 'true' : 'false'}
            aria-controls=${this.open ? 'options' : nothing}
            aria-autocomplete="list"
            aria-activedescendant=${activeDescendant}
            aria-invalid=${this.isInvalidSelection(selected) ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @input=${this.handleInput}
            @keydown=${this.handleKeyDown}
            @focus=${this.handleFocus}
            @blur=${this.handleBlur}
            @compositionstart=${this.handleCompositionStart}
            @compositionend=${this.handleCompositionEnd}
          />
          ${this.renderOptionList(filtered)}
        </div>
      </div>
    `;
  }

  private activeOptionId(options: readonly AeliqoOption[]): string | typeof nothing {
    if (!this.open || this.activeIndex < 0 || options[this.activeIndex] === undefined) return nothing;
    return `option-${this.activeIndex}`;
  }

  private isInvalidSelection(selected: AeliqoOption | undefined): boolean {
    return this.error.length > 0 || (this.value.length > 0 && selected === undefined);
  }

  private renderOptionList(options: readonly AeliqoOption[]) {
    if (!this.open) return nothing;
    return html`
      <ul id="options" part="listbox" role="listbox">
        ${options.map((option, index) => this.renderOption(option, index))}
      </ul>
      ${options.length === 0 && !this.loading ? html`<span part="status">No options</span>` : nothing}
    `;
  }

  private renderOption(option: AeliqoOption, index: number) {
    return html`<li
      id=${`option-${index}`}
      part="option"
      role="option"
      aria-selected=${option.value === this.value ? 'true' : 'false'}
      aria-disabled=${option.disabled === true ? 'true' : nothing}
      class=${index === this.activeIndex ? 'active' : ''}
      @mousedown=${(event: MouseEvent) => event.preventDefault()}
      @click=${() => this.choose(option)}
    >
      <span>${option.label}</span>
      ${option.description ? html`<small>${option.description}</small>` : nothing}
    </li>`;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  get loading(): boolean {
    return this.validationState === 'pending';
  }

  private readonly handleFocus = (): void => {
    if (!this.fieldDisabled && !this.readOnly) {
      this.open = true;
      this.activeIndex = this.firstEnabledIndex(this.filteredOptions(this.safeOptions()));
      this.requestUpdate();
    }
  };

  private readonly handleBlur = (): void => {
    // A click is allowed to run before the delayed close, while focus remains
    // on the input after a selection.
    setTimeout(() => {
      if (!this.isConnected) return;
      const active = this.shadowRoot?.activeElement;
      if (active !== this.native()) {
        this.open = false;
        this.activeIndex = -1;
        this.requestUpdate();
      }
    }, 0);
  };

  private readonly handleInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled || this.readOnly) return;
    this.query = input.value;
    this.value = '';
    this.activeIndex = this.firstEnabledIndex(this.filteredOptions(this.safeOptions()));
    this.open = true;
    if (this.composing) {
      this.cancelLoader();
      this.validationState = 'idle';
      this.error = '';
    } else if (this.suppressTrailingCompositionInput !== undefined) {
      const expected = this.suppressTrailingCompositionInput;
      this.suppressTrailingCompositionInput = undefined;
      if (input.value === expected) {
        this.syncNative();
        this.requestUpdate();
        return;
      }
      this.commitQueryInput(this.query);
      return;
    } else {
      this.commitQueryInput(this.query);
      return;
    }
    this.syncNative();
    this.requestUpdate();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.fieldDisabled || this.readOnly || event.isComposing || this.composing) return;
    const options = this.filteredOptions(this.safeOptions());
    if (this.handleArrowKey(event, options)) return;
    if (this.handleEscapeKey(event)) return;
    this.handleEnterKey(event, options);
  };

  private handleArrowKey(event: KeyboardEvent, options: readonly AeliqoOption[]): boolean {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open = true;
      this.activeIndex = this.nextEnabledIndex(options, this.activeIndex, 1);
      this.requestUpdate();
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.open = true;
      this.activeIndex = this.nextEnabledIndex(options, this.activeIndex, -1);
      this.requestUpdate();
      return true;
    }
    return false;
  }

  private handleEscapeKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      if (this.open) {
        event.preventDefault();
        this.open = false;
        this.activeIndex = -1;
        this.requestUpdate();
      }
      return true;
    }
    return false;
  }

  private handleEnterKey(event: KeyboardEvent, options: readonly AeliqoOption[]): void {
    if (event.key === 'Enter' && this.open && this.activeIndex >= 0) {
      const option = options[this.activeIndex];
      if (option !== undefined) {
        event.preventDefault();
        this.choose(option);
      }
    }
  }

  private choose(option: AeliqoOption): void {
    if (option.disabled === true || this.fieldDisabled || this.readOnly) return;
    this.value = option.value;
    this.query = option.label;
    this.open = false;
    this.activeIndex = -1;
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: this.value }));
    void this.validateProposed(this.value);
    this.syncNative();
    this.requestUpdate();
    this.native()?.focus();
  }

  private readonly handleCompositionStart = (): void => {
    this.composing = true;
    this.suppressTrailingCompositionInput = undefined;
    this.cancelLoader();
    this.validationState = 'idle';
    this.error = '';
  };

  private readonly handleCompositionEnd = (): void => {
    this.composing = false;
    const input = this.native();
    if (input === undefined) return;
    this.query = input.value;
    this.value = '';
    this.suppressTrailingCompositionInput = this.query;
    this.activeIndex = this.firstEnabledIndex(this.filteredOptions(this.safeOptions()));
    this.open = true;
    this.commitQueryInput(this.query);
  };

  private commitQueryInput(query: string): void {
    this.dispatchEvent(new AeliqoInputChangeEvent({ source: 'user', value: '' }));
    this.dispatchEvent(new AeliqoComboboxQueryEvent({ source: 'user', query }));
    void this.loadForQuery(query);
    this.syncNative();
    this.requestUpdate();
  }

  private async loadForQuery(query: string): Promise<void> {
    const loader = this.optionsLoader;
    if (loader === undefined) return;
    this.loadAbort?.abort();
    const controller = new AbortController();
    this.loadAbort = controller;
    const sequence = ++this.loadSequence;
    if (query.length < Math.max(0, this.minQueryLength)) {
      this.validationState = 'idle';
      this.error = '';
      this.requestUpdate();
      return;
    }
    this.validationState = 'pending';
    this.requestUpdate();
    try {
      const loaded = await loader(query, controller.signal);
      if (controller.signal.aborted || sequence !== this.loadSequence || !this.isConnected) return;
      this.options = validOptions(loaded) ? loaded.slice(0, COMBOBOX_MAX_OPTIONS) : [];
      this.validationState = 'idle';
      this.error = '';
      this.activeIndex = this.firstEnabledIndex(this.filteredOptions(this.options));
      this.requestUpdate();
    } catch {
      if (controller.signal.aborted || sequence !== this.loadSequence || !this.isConnected) return;
      this.validationState = 'invalid';
      this.error = 'Options could not be loaded.';
      this.requestUpdate();
    }
  }

  private safeOptions(): readonly AeliqoOption[] {
    return validOptions(this.options) ? this.options.slice(0, COMBOBOX_MAX_OPTIONS) : [];
  }

  private filteredOptions(options: readonly AeliqoOption[]): readonly AeliqoOption[] {
    const displayed = this.displayQuery();
    const selectedLabel = this.labelForValue(this.value);
    if (this.value.length > 0 && displayed === selectedLabel) return options;
    const query = displayed.trim().toLocaleLowerCase(this.locale || undefined);
    if (query.length === 0) return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ''}`.toLocaleLowerCase(this.locale || undefined).includes(query),
    );
  }

  private labelForValue(value: string): string {
    return this.safeOptions().find((option) => option.value === value)?.label ?? value;
  }

  private displayQuery(): string {
    const label = this.labelForValue(this.value);
    if (this.value.length > 0 && (this.query.length === 0 || this.query === this.value)) return label;
    return this.query;
  }

  private firstEnabledIndex(options: readonly AeliqoOption[]): number {
    return options.findIndex((option) => option.disabled !== true);
  }

  private nextEnabledIndex(options: readonly AeliqoOption[], current: number, direction: 1 | -1): number {
    if (options.length === 0) return -1;
    const start = this.navigationStart(current, direction);
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (start + direction * offset + options.length * 2) % options.length;
      if (options[index]?.disabled !== true) return index;
    }
    return -1;
  }

  private navigationStart(current: number, direction: 1 | -1): number {
    if (current >= 0) return current;
    if (direction === 1) return -1;
    return 0;
  }

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const selected = this.safeOptions().some((option) => option.value === this.value && option.disabled !== true);
    this.setFormValue(this.fieldDisabled || !selected ? null : this.value);
    this.updateValidity(this.native(), this.value.length === 0 || !selected);
  }

  private cancelLoader(): void {
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    this.loadSequence += 1;
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      :host {
        box-sizing: border-box;
      }
      .combobox-wrap {
        min-inline-size: 0;
        position: relative;
      }
      [part='listbox'] {
        background: var(--aeliqo-color-canvas, #fff);
        border: 1px solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-medium, 0.625rem);
        box-shadow: var(--aeliqo-elevation-lg, 0 8px 24px rgb(15 23 42 / 0.12), 0 0 0 1px rgb(15 23 42 / 0.04));
        list-style: none;
        margin: 0.25rem 0 0;
        max-block-size: 16rem;
        overflow: auto;
        padding: 0.25rem;
        position: absolute;
        inset-inline: 0;
        z-index: 1;
      }
      [part='option'],
      [part='status'] {
        cursor: default;
        display: flex;
        gap: 0.5rem;
        justify-content: space-between;
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
        padding: var(--aeliqo-space-6, 0.375rem) var(--aeliqo-space-10, 0.625rem);
      }
      [part='option'] {
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        flex-direction: column;
        align-items: flex-start;
        position: relative;
      }
      .label-text,
      [part='option'] span,
      [part='option'] small {
        max-inline-size: 100%;
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
      }
      [part='option'] small {
        color: var(--aeliqo-color-muted, #4b5563);
      }
      [part='option'].active {
        background: var(
          --_aeliqo-accent-subtle,
          color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 8%, var(--aeliqo-color-surface, #f8fafc))
        );
      }
      [part='option'][aria-selected='true'] {
        background: var(
          --_aeliqo-accent-selected,
          color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 14%, var(--aeliqo-color-surface, #f8fafc))
        );
        padding-inline-end: var(--aeliqo-space-32, 2rem);
      }
      [part='option'][aria-selected='true']::after {
        color: var(--aeliqo-color-accent, #4338ca);
        content: '✓';
        inset-block-start: 50%;
        inset-inline-end: var(--aeliqo-space-10, 0.625rem);
        position: absolute;
        transform: translateY(-50%);
      }
      [part='option'][aria-selected='true'].active {
        background: color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 20%, var(--aeliqo-color-surface, #f8fafc));
      }
      [part='option'][aria-disabled='true'] {
        color: var(--aeliqo-color-muted, #4b5563);
      }
      @media (forced-colors: active) {
        [part='option'].active,
        [part='option'][aria-selected='true'] {
          background: Highlight;
          color: HighlightText;
        }
        [part='option'][aria-selected='true']::after {
          color: HighlightText;
        }
      }
      @media (max-width: 30rem) {
        :host {
          inline-size: 100%;
        }
        [part='label'] {
          padding-inline: 1px;
        }
      }
    `,
  ];
}
