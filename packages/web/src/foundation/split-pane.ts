import { css, html, nothing } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles, clampNumber } from './base.js';
import { AeliqoSplitChangeEvent } from './events.js';

export type AeliqoSplitOrientation = 'horizontal' | 'vertical';

const HORIZONTAL_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };
const VERTICAL_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowUp: -1, ArrowDown: 1 };

function keyboardPosition(
  key: string,
  orientation: AeliqoSplitOrientation,
  rtl: boolean,
  position: number,
  step: number,
  minimum: number,
  maximum: number,
): number | undefined {
  if (key === 'Home') return minimum;
  if (key === 'End') return maximum;
  const direction = (orientation === 'horizontal' ? HORIZONTAL_KEYS : VERTICAL_KEYS)[key];
  if (direction === undefined) return undefined;
  return position + direction * (orientation === 'horizontal' && rtl ? -step : step);
}

/** Resizable two-pane layout with a typed, controlled position proposal. */
export class AeliqoSplitPaneElement extends AeliqoFoundationElement {
  static readonly properties = {
    orientation: { type: String },
    position: { type: Number },
    defaultPosition: { attribute: 'default-position', type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    disabled: { type: Boolean, reflect: true },
    primaryLabel: { attribute: 'primary-label', type: String },
    secondaryLabel: { attribute: 'secondary-label', type: String },
    separatorLabel: { attribute: 'separator-label', type: String },
  };

  orientation: AeliqoSplitOrientation = 'horizontal';
  position: number | undefined = undefined;
  defaultPosition = 50;
  min = 20;
  max = 80;
  step = 5;
  disabled = false;
  primaryLabel = 'Primary pane';
  secondaryLabel = 'Secondary pane';
  separatorLabel = 'Resize panes';

  private internalPosition = 50;
  private activePointer: { readonly id: number; readonly target: HTMLElement; readonly offset: number } | undefined;

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('defaultPosition') && this.position === undefined)
      this.internalPosition = this.clamped(this.defaultPosition);
  }

  protected override render() {
    const orientation = this.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const position = this.effectivePosition();
    const { minimum, maximum } = this.positionBounds();
    return html`
      <div part="split" class=${`orientation-${orientation}`} style=${`--aeliqo-split-position:${position}`}>
        <div part="start" id="aeliqo-split-primary" role="region" aria-label=${this.primaryLabel || 'Primary pane'}>
          <slot name="start"></slot>
        </div>
        <div
          part="splitter"
          role="separator"
          tabindex=${this.disabled ? -1 : 0}
          aria-orientation=${orientation === 'horizontal' ? 'vertical' : 'horizontal'}
          aria-controls="aeliqo-split-primary"
          aria-label=${this.separatorLabel || 'Resize panes'}
          aria-valuemin=${minimum}
          aria-valuemax=${maximum}
          aria-valuenow=${position}
          aria-valuetext=${`${Math.round(position)}%`}
          aria-disabled=${this.disabled ? 'true' : nothing}
          @pointerdown=${this.handlePointerDown}
          @pointermove=${this.handlePointerMove}
          @pointerup=${this.handlePointerUp}
          @pointercancel=${this.handlePointerUp}
          @keydown=${this.handleKeyDown}
        ></div>
        <div part="end" role="region" aria-label=${this.secondaryLabel || 'Secondary pane'}>
          <slot name="end"></slot>
        </div>
      </div>
    `;
  }

  disconnectedCallback(): void {
    this.activePointer = undefined;
    super.disconnectedCallback();
  }

  private effectivePosition(): number {
    return this.position === undefined ? this.clamped(this.internalPosition) : this.clamped(this.position);
  }

  private positionBounds(): { readonly minimum: number; readonly maximum: number } {
    const minimum = Number.isFinite(this.min) ? clampNumber(this.min, 0, 99) : 20;
    const requestedMaximum = Number.isFinite(this.max) ? this.max : 80;
    const maximum = clampNumber(Math.max(requestedMaximum, minimum + 1), minimum + 1, 100);
    return { minimum, maximum };
  }

  private clamped(value: number): number {
    const { minimum, maximum } = this.positionBounds();
    const fallback = Number.isFinite(this.defaultPosition) ? this.defaultPosition : 50;
    const candidate = Number.isFinite(value) ? value : fallback;
    return Math.round(clampNumber(candidate, minimum, maximum) * 100) / 100;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disabled || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset =
      this.orientation === 'vertical'
        ? event.clientY - bounds.top - bounds.height / 2
        : event.clientX - bounds.left - bounds.width / 2;
    this.activePointer = { id: event.pointerId, target: event.currentTarget, offset };
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.disabled || this.activePointer?.id !== event.pointerId) return;
    const splitter = this.activePointer.target;
    const split = splitter.parentElement;
    if (split === null) return;
    const bounds = split.getBoundingClientRect();
    const handleBounds = splitter.getBoundingClientRect();
    const orientation = this.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const handleSize = orientation === 'vertical' ? handleBounds.height : handleBounds.width;
    const size = (orientation === 'vertical' ? bounds.height : bounds.width) - handleSize;
    if (size <= 0) return;
    const offset = orientation === 'vertical' ? event.clientY - bounds.top : event.clientX - bounds.left;
    let next = ((offset - handleSize / 2 - this.activePointer.offset) / size) * 100;
    if (orientation === 'horizontal' && getComputedStyle(this).direction === 'rtl') next = 100 - next;
    this.commitPosition(next);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.activePointer?.id !== event.pointerId) return;
    if (this.activePointer.target.hasPointerCapture(event.pointerId))
      this.activePointer.target.releasePointerCapture(event.pointerId);
    this.activePointer = undefined;
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disabled) return;
    const orientation = this.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const rtl = orientation === 'horizontal' && getComputedStyle(this).direction === 'rtl';
    const step = Number.isFinite(this.step) && this.step > 0 ? this.step : 5;
    const { minimum, maximum } = this.positionBounds();
    const next = keyboardPosition(event.key, orientation, rtl, this.effectivePosition(), step, minimum, maximum);
    if (next === undefined) return;
    event.preventDefault();
    this.commitPosition(next);
  };

  private commitPosition(value: number): void {
    const position = this.clamped(value);
    if (this.position === undefined) {
      this.internalPosition = position;
      this.requestUpdate();
    }
    this.dispatchEvent(
      new AeliqoSplitChangeEvent({
        source: 'user',
        orientation: this.orientation === 'vertical' ? 'vertical' : 'horizontal',
        position,
      }),
    );
  }

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    css`
      :host {
        display: block;
        min-block-size: 0;
        min-inline-size: 0;
      }
      [part='split'] {
        block-size: 100%;
        display: flex;
        inline-size: 100%;
        min-block-size: 0;
        min-inline-size: 0;
      }
      .orientation-horizontal {
        flex-direction: row;
      }
      .orientation-vertical {
        flex-direction: column;
      }
      [part='start'],
      [part='end'] {
        min-block-size: 0;
        min-inline-size: 0;
        overflow: auto;
        overflow-wrap: anywhere;
      }
      .orientation-horizontal [part='start'] {
        flex: var(--aeliqo-split-position) 1 0;
      }
      .orientation-horizontal [part='end'] {
        flex: calc(100 - var(--aeliqo-split-position)) 1 0;
      }
      .orientation-vertical [part='start'] {
        flex: var(--aeliqo-split-position) 1 0;
      }
      .orientation-vertical [part='end'] {
        flex: calc(100 - var(--aeliqo-split-position)) 1 0;
      }
      [part='splitter'] {
        flex: 0 0 max(0.5rem, var(--_aeliqo-coarse-target, 0px));
        min-block-size: var(--_aeliqo-coarse-target, 0px);
        min-inline-size: var(--_aeliqo-coarse-target, 0px);
        position: relative;
        touch-action: none;
        z-index: 1;
      }
      .orientation-horizontal [part='splitter'] {
        cursor: col-resize;
      }
      .orientation-vertical [part='splitter'] {
        cursor: row-resize;
      }
      [part='splitter']::after {
        background: var(--aeliqo-color-border, #64748b);
        content: '';
        inset: 0;
        position: absolute;
      }
      .orientation-horizontal [part='splitter']::after {
        inset-inline: calc((100% - var(--aeliqo-control-border-width, 0.0625rem)) / 2);
      }
      .orientation-vertical [part='splitter']::after {
        inset-block: calc((100% - var(--aeliqo-control-border-width, 0.0625rem)) / 2);
      }
      [part='splitter']:focus-visible {
        outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-color-focus, #4338ca);
        outline-offset: calc(-1 * var(--aeliqo-focus-width, 0.1875rem));
        box-shadow: none;
      }
      :host([disabled]) [part='splitter'] {
        cursor: not-allowed;
        opacity: 0.6;
      }
    `,
  ];
}
