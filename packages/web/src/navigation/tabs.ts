import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { aeliqoNavigationStyles, emitAction, safeElementId } from './shared.js';

export interface AeliqoTabItem {
  readonly id: string;
  readonly label: string;
  readonly content?: string;
  readonly disabled?: boolean;
}

export type AeliqoTabsActivation = 'automatic' | 'manual';

const HORIZONTAL_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };
const VERTICAL_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowUp: -1, ArrowDown: 1 };

function nextTabIndex(key: string, orientation: string, current: number, count: number): number | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const direction = (orientation === 'vertical' ? VERTICAL_KEYS : HORIZONTAL_KEYS)[key];
  if (direction === undefined) return undefined;
  return (current + direction + count) % count;
}

export class AeliqoTabsElement extends AeliqoFoundationElement {
  static readonly properties = {
    items: { attribute: false },
    value: { type: String },
    defaultValue: { type: String },
    activation: { type: String },
    orientation: { type: String },
    idPrefix: { type: String, attribute: 'id-prefix' },
  };

  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    aeliqoNavigationStyles,
    css`
      :host {
        border-block-end: 0.0625rem solid var(--aeliqo-color-border, #64748b);
        min-inline-size: 0;
      }
      [role='tablist'] {
        display: flex;
        gap: var(--aeliqo-space-4, 0.25rem);
        max-inline-size: 100%;
        overflow-x: auto;
      }
      [role='tablist'][aria-orientation='vertical'] {
        flex-direction: column;
      }
      [role='tab'] {
        background: transparent;
        border: 0;
        border-block-end: 0.1875rem solid transparent;
        cursor: pointer;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding: var(--aeliqo-space-8, 0.5rem) var(--aeliqo-space-12, 0.75rem);
      }
      [role='tab'][aria-selected='true'] {
        border-block-end-color: var(--aeliqo-color-accent, #4338ca);
        color: var(--aeliqo-color-accent, #4338ca);
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      }
      [role='tab']:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      [role='tabpanel'] {
        padding-block: var(--aeliqo-space-16, 1rem);
      }
      [hidden] {
        display: none;
      }
    `,
  ];

  items: readonly AeliqoTabItem[] = [];
  value = '';
  defaultValue = '';
  activation: AeliqoTabsActivation = 'automatic';
  orientation: 'horizontal' | 'vertical' = 'horizontal';
  idPrefix = 'aeliqo-tabs';
  private internalValue = '';

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('items') || changed.has('defaultValue')) {
      const first = this.items.find((item) => !item.disabled)?.id ?? '';
      const preferred =
        changed.has('defaultValue') && this.defaultValue.length > 0 ? this.defaultValue : this.internalValue;
      this.internalValue = this.items.some((item) => item.id === preferred && !item.disabled) ? preferred : first;
    }
  }

  private get selectedId(): string {
    const requested = this.value || this.internalValue;
    return this.items.some((item) => item.id === requested && !item.disabled)
      ? requested
      : (this.items.find((item) => !item.disabled)?.id ?? '');
  }

  private setSelected(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (item === undefined || item.disabled) return;
    if (!emitAction(this, 'aeliqo-tabs-change', { id, previousId: this.selectedId })) return;
    if (!this.value) this.internalValue = id;
    this.requestUpdate();
  }

  private moveFocus(event: KeyboardEvent, index: number): void {
    const enabled = this.items.map((item, position) => ({ item, position })).filter(({ item }) => !item.disabled);
    const current = enabled.findIndex(({ position }) => position === index);
    if (current < 0) return;
    const next = nextTabIndex(event.key, this.orientation, current, enabled.length);
    if (next === undefined) return;
    event.preventDefault();
    const button = this.renderRoot.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(enabled[next]!.item.id)}"]`);
    button?.focus();
    if (this.activation === 'automatic') this.setSelected(enabled[next]!.item.id);
  }

  protected override render() {
    const selected = this.selectedId;
    const prefix = safeElementId(this.idPrefix, 'aeliqo-tabs');
    return html`
      <div part="tablist" role="tablist" aria-orientation=${this.orientation}>
        ${this.items.map((item, index) => {
          const tabId = `${prefix}-tab-${safeElementId(item.id, String(index))}`;
          const panelId = `${prefix}-panel-${safeElementId(item.id, String(index))}`;
          return html`<button
            part="tab"
            id=${tabId}
            data-tab-id=${item.id}
            role="tab"
            type="button"
            aria-selected=${item.id === selected ? 'true' : 'false'}
            aria-controls=${panelId}
            tabindex=${item.id === selected ? '0' : '-1'}
            ?disabled=${item.disabled ?? false}
            @click=${() => this.setSelected(item.id)}
            @keydown=${(event: KeyboardEvent) => this.moveFocus(event, index)}
          >
            ${item.label}
          </button>`;
        })}
      </div>
      ${this.items.map((item, index) => {
        const panelId = `${prefix}-panel-${safeElementId(item.id, String(index))}`;
        const tabId = `${prefix}-tab-${safeElementId(item.id, String(index))}`;
        return html`<section
          part="panel"
          id=${panelId}
          role="tabpanel"
          aria-labelledby=${tabId}
          ?hidden=${item.id !== selected}
        >
          ${item.content === undefined ? html`<slot name=${item.id}></slot>` : item.content}
        </section>`;
      })}
    `;
  }
}
