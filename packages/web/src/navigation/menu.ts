import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import {
  aeliqoNavigationStyles,
  activeElement,
  focusFirst,
  restoreFocus,
  listenOutside,
  emitAction,
  safeElementId,
} from './shared.js';

export interface AeliqoMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

function nextIndexFor(key: string, current: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export class AeliqoMenuElement extends AeliqoFoundationElement {
  static readonly properties = {
    items: { attribute: false },
    label: { type: String },
    open: { type: Boolean, reflect: true },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    aeliqoNavigationStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      [part='trigger'] {
        align-items: center;
        background: var(--aeliqo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        cursor: pointer;
        display: inline-flex;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding-inline: var(--aeliqo-space-12, 0.75rem);
      }
      [part='menu'] {
        background: var(--aeliqo-color-surface, #f8fafc);
        border: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        box-shadow: var(--aeliqo-elevation-raised, 0 0.25rem 0.75rem -0.5rem #0f172a33);
        inset-inline-start: 0;
        max-inline-size: 100%;
        min-inline-size: min(12rem, 100%);
        padding: var(--aeliqo-space-4, 0.25rem);
        position: absolute;
        inset-block-start: calc(100% + var(--aeliqo-space-4, 0.25rem));
        z-index: 10;
      }
      [role='menuitem'] {
        background: transparent;
        border: 0;
        cursor: pointer;
        display: block;
        font: inherit;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding: var(--aeliqo-space-8, 0.5rem);
        text-align: start;
        width: 100%;
      }
      [role='menuitem']:hover,
      [role='menuitem']:focus-visible {
        background: color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 12%, transparent);
      }
      [role='menuitem']:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      [hidden] {
        display: none;
      }
    `,
  ];

  items: readonly AeliqoMenuItem[] = [];
  label = 'Menu';
  open = false;
  private returnFocus: HTMLElement | undefined = undefined;
  private stopOutside: (() => void) | undefined = undefined;

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      this.stopOutside?.();
      this.stopOutside = undefined;
      if (this.open) {
        this.returnFocus ??= activeElement(this);
        this.stopOutside = listenOutside(this, () => this.close());
        queueMicrotask(() => {
          const surface = this.renderRoot.querySelector<HTMLElement>('[part="menu"]');
          if (surface !== null) focusFirst(surface);
        });
      } else {
        restoreFocus(this.returnFocus);
        this.returnFocus = undefined;
      }
    }
  }

  disconnectedCallback(): void {
    this.stopOutside?.();
    this.stopOutside = undefined;
    super.disconnectedCallback();
  }

  private close(): void {
    this.open = false;
  }
  private activate(item: AeliqoMenuItem): void {
    if (item.disabled) return;
    if (!emitAction(this, 'aeliqo-menu-action', { id: item.id })) return;
    this.close();
  }
  private keydown(event: KeyboardEvent, index: number): void {
    const enabled = this.items.map((item, position) => ({ item, position })).filter(({ item }) => !item.disabled);
    const current = enabled.findIndex(({ position }) => position === index);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.activate(this.items[index]!);
      return;
    }
    if (current < 0) return;
    const next = nextIndexFor(event.key, current, enabled.length);
    if (next === undefined) return;
    event.preventDefault();
    const target = this.renderRoot.querySelector<HTMLElement>(`[data-menu-id="${CSS.escape(enabled[next]!.item.id)}"]`);
    target?.focus();
  }

  protected override render() {
    const menuId = safeElementId(`${this.id || 'aeliqo-menu'}-items`, 'aeliqo-menu-items');
    return html`<button
        part="trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-controls=${menuId}
        @click=${(event: MouseEvent) => {
          const trigger = event.currentTarget;
          this.returnFocus ??= trigger instanceof HTMLElement ? trigger : activeElement(this);
          this.open = !this.open;
        }}
      >
        ${this.label}
      </button>
      <div part="menu" id=${menuId} role="menu" aria-label=${this.label} ?hidden=${!this.open}>
        ${this.items.map((item, index) => html`<button part="item" type="button" role="menuitem" data-menu-id=${item.id} ?disabled=${item.disabled ?? false} tabindex=${index === 0 ? '0' : '-1'} @click=${() => this.activate(item)} @keydown=${(event: KeyboardEvent) => this.keydown(event, index)}>${item.label}</button>`)}
      </div>`;
  }
}
