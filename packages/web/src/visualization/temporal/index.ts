import { html, css } from 'lit';
import type { Result } from '@varendo/core';
import type { VisualizationBindingContext, VisualizationSpec } from '@varendo/core/visualization';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../../foundation/base.js';
import type { VarendoVisualizationSelectionDetail, VisualizationDataset, VisualizationInputs } from '../types.js';
import { compileTemporalVisualization } from './geometry.js';
import type { TemporalGeometry } from './geometry.js';
import { renderTemporalGeometry } from './render.js';
import { VARENDO_WEB_VERSION } from '../../version.js';
export { compileTemporalVisualization } from './geometry.js';
export type { TemporalGeometry, TimelineMark, CalendarDay } from './geometry.js';
class VarendoTemporalElement extends VarendoFoundationElement implements VisualizationInputs {
  static readonly shadowRootOptions: ShadowRootInit = { mode: 'open', delegatesFocus: false };
  static readonly properties = {
    selectedIdentity: { type: String, attribute: 'selected-identity' },
    selectionEnabled: { type: Boolean, attribute: false },
    visualization: { attribute: false },
    context: { attribute: false },
    datasets: { attribute: false },
    label: { type: String },
    width: { type: Number },
    height: { type: Number },
    maxMarks: { type: Number, attribute: 'max-marks' },
    page: { state: true },
  };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        container-type: inline-size;
        display: block;
        min-inline-size: 0;
        inline-size: 100%;
        color: var(--varendo-color-text, #111827);
        max-inline-size: 100%;
      }
      figure {
        margin: 0;
      }
      figcaption,
      p {
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
      }
      caption {
        block-size: 1px;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        inline-size: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
      }
      table {
        border-collapse: collapse;
        inline-size: 100%;
      }
      th,
      td {
        text-align: start;
        padding: 0.5rem;
        border-block-end: 1px solid var(--varendo-color-border, #64748b);
        overflow-wrap: anywhere;
      }
      [part='data'],
      [part='viewport'] {
        overflow: auto;
        max-inline-size: 100%;
        min-inline-size: 0;
      }
      [part='viewport'] {
        direction: ltr;
      }
      :host(varendo-timeline) [part='viewport'] {
        /* Reserve text-scaled space without changing interval or tick coordinates. */
        padding-block: 1em;
      }
      :host(varendo-timeline) svg {
        overflow: visible;
      }
      button {
        background: var(--varendo-color-surface, #f8fafc);
        border: var(--varendo-control-border-width, 0.0625rem) solid var(--varendo-color-border, #64748b);
        color: var(--varendo-color-text, #111827);
        font: inherit;
        white-space: nowrap;
        overflow-wrap: normal;
        min-inline-size: 2.75rem;
        min-block-size: 2.75rem;
      }
      nav {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      svg {
        display: block;
        color: var(--varendo-color-accent, #4338ca);
        max-inline-size: none;
        block-size: auto;
      }
      svg text {
        unicode-bidi: plaintext;
      }
      .days {
        display: grid;
        grid-template-columns: repeat(7, minmax(5rem, 1fr));
        gap: 0.25rem;
        min-inline-size: 40rem;
      }
      .day {
        border: 1px solid var(--varendo-color-border, #64748b);
        padding: 0.5rem;
        min-block-size: 5rem;
      }
      .day span {
        display: block;
      }
      strong {
        display: block;
        margin: 0.2rem 0;
        font-size: 1rem;
      }
      button:focus-visible {
        outline: 3px solid var(--varendo-color-focus, #4338ca);
      }
      @container (max-width: 30rem) {
        svg text {
          font-size: max(0.875rem, calc(1rem - 2px));
        }
        .matrix th:nth-child(1),
        .matrix td:nth-child(1) {
          inline-size: 180px;
          min-inline-size: 180px;
        }
        .matrix th:nth-child(2),
        .matrix td:nth-child(2) {
          inline-size: 148px;
          min-inline-size: 148px;
        }
        .matrix th:nth-child(n + 3),
        .matrix td:nth-child(n + 3) {
          inline-size: 104px;
          min-inline-size: 104px;
        }
        :is(.timeline, .calendar-grid) [part='data'] {
          overflow: visible;
        }
        :is(.timeline, .calendar-grid) table {
          display: block;
          inline-size: 100%;
          min-inline-size: 0;
        }
        :is(.timeline, .calendar-grid) thead {
          block-size: 1px;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          inline-size: 1px;
          overflow: hidden;
          position: absolute;
          white-space: nowrap;
        }
        :is(.timeline, .calendar-grid) tbody {
          display: grid;
          gap: 0.75rem;
        }
        :is(.timeline, .calendar-grid) tr {
          border-block-end: 1px solid var(--varendo-color-border, #64748b);
          display: block;
          padding-block: 0.25rem;
        }
        :is(.timeline, .calendar-grid) td {
          border: 0;
          display: grid;
          gap: 0.5rem;
          grid-template-columns: minmax(min(4.75rem, 40%), 0.7fr) minmax(0, 1.3fr);
          padding: 0.25rem;
        }
        :is(.timeline, .calendar-grid) td::before {
          content: attr(data-label);
          font-weight: 600;
          overflow-wrap: anywhere;
        }
        :is(.timeline, .calendar-grid) td > button {
          justify-self: start;
          min-inline-size: min(2.75rem, 100%);
          max-inline-size: 100%;
        }
      }
      @container (max-width: 7rem) {
        :is(.timeline, .calendar-grid) td[data-label='Select'] {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      @media (forced-colors: active) {
        button {
          background: Canvas;
          color: CanvasText;
        }
      }
    `,
  ];
  visualization: VisualizationSpec | undefined;
  context: VisualizationBindingContext = { results: [] };
  datasets: readonly VisualizationDataset[] = [];
  selectedIdentity = '';
  selectionEnabled = true;
  label = 'Data visualization';
  width = 640;
  height = 320;
  maxMarks = 1000;
  private page = 0;
  private scope = '';
  protected readonly view: 'matrix' | 'timeline' | 'calendar-grid' = 'matrix';
  private focused: HTMLElement | undefined;
  protected override willUpdate(): void {
    const active = this.shadowRoot?.activeElement;
    this.focused = globalThis.HTMLElement !== undefined && active instanceof HTMLElement ? active : undefined;
  }
  protected override updated(): void {
    const target = this.focused;
    this.focused = undefined;
    if (
      target?.isConnected &&
      (this.ownerDocument.activeElement === this.ownerDocument.body ||
        (this.getRootNode() as Document | ShadowRoot).activeElement === this) &&
      !this.shadowRoot?.activeElement
    )
      target.focus({ preventScroll: true });
  }

  protected override render() {
    if (this.visualization?.view !== this.view) {
      this.selectedIdentity = '';
      return html`<p role="status">No matching visualization is available.</p>`;
    }
    const compiled = compileTemporalVisualization(this);
    if (!compiled.ok) {
      this.selectedIdentity = '';
      return html`<p role="status">${compiled.diagnostics[0]?.message}</p>`;
    }
    const geometry = compiled.value;
    const page = this.currentPage(geometry);
    return renderTemporalGeometry({
      geometry,
      visualization: this.visualization,
      view: this.view,
      label: this.label,
      page,
      selectionEnabled: this.selectionEnabled,
      selectedIdentity: this.selectedIdentity,
      onSelect: (row) => this.select(row.identity, geometry.result.ref),
      onPage: (nextPage) => {
        this.page = nextPage;
      },
    });
  }

  private currentPage(geometry: TemporalGeometry): number {
    const refKey = JSON.stringify(geometry.result.ref);
    if (this.scope !== refKey) {
      if (this.scope !== '') this.selectedIdentity = '';
      this.scope = refKey;
      this.page = 0;
    }
    if (!geometry.rows.some((row) => row.identity === this.selectedIdentity)) this.selectedIdentity = '';
    return Math.min(this.page, Math.max(0, Math.ceil(geometry.rows.length / 25) - 1));
  }

  private select(identity: string, result: Result['ref']): void {
    if (!this.selectionEnabled) return;
    const event = new CustomEvent<VarendoVisualizationSelectionDetail>('varendo-visualization-select', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: Object.freeze({ source: 'user', identity, result }),
    });
    if (this.dispatchEvent(event)) this.selectedIdentity = identity;
  }
}
export class VarendoMatrixElement extends VarendoTemporalElement {
  protected override readonly view = 'matrix' as const;
}
export class VarendoTimelineElement extends VarendoTemporalElement {
  protected override readonly view = 'timeline' as const;
}
export class VarendoCalendarGridElement extends VarendoTemporalElement {
  protected override readonly view = 'calendar-grid' as const;
}

/** Idempotently register the temporal family in an application-owned registry. */
export function defineTemporalElements(registry?: CustomElementRegistry): void {
  const target = registry ?? globalThis.customElements;
  if (target === undefined) throw new Error('Temporal visualization elements require a CustomElementRegistry.');
  for (const [tag, element] of [
    ['varendo-matrix', VarendoMatrixElement],
    ['varendo-timeline', VarendoTimelineElement],
    ['varendo-calendar-grid', VarendoCalendarGridElement],
  ] as const) {
    const current = target.get(tag);
    if (current === undefined) target.define(tag, element);
    else if (current !== element && (current as typeof element).varendoVersion !== VARENDO_WEB_VERSION)
      throw new Error(`Cannot register ${tag}: an incompatible custom element is already defined.`);
  }
}
