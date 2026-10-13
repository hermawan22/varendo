import { css, unsafeCSS } from 'lit';
import type { Diagnostic, Outcome, ResultRef, VisualizationSpec } from '@varendo/core';
import type { BoundVisualization } from '@varendo/core/visualization';
import { bindVisualizationSpec } from '@varendo/core/visualization';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../../foundation/base.js';
import { compilePlotComposition } from '../../plot/composition.js';
import type { CompiledPlot, CompiledPlotNode, PlotDataset } from '../../plot/composition.js';
import type { PlotGeometry } from '../../plot/geometry.js';
import { QUANTITATIVE_COLOR_END, QUANTITATIVE_COLOR_START } from '../../plot/palette.js';
import { materializeVisualizationRows } from '../materialization.js';
import type { VarendoVisualizationSelectionDetail, VisualizationDataset, VisualizationInputs } from '../types.js';
import { renderCartesian } from './render.js';
import type { CartesianState, CartesianView } from './types.js';
import type { CartesianRenderContext } from './types.js';
import { fitAxisTickRows } from './tick-rows.js';

export type { CartesianView } from './types.js';

const fail = (code: string, message: string): Outcome<never> => ({
  ok: false,
  diagnostics: [{ code: `visualization.${code}`, message, retryable: false }],
});

const resultKey = (ref: ResultRef): string =>
  JSON.stringify([ref.id, ref.revision, ref.sourceLineage ?? null, ref.outputId, ref.queryDigest, ref.scopeDigest]);
const inputChanged = (changed: Map<string, unknown>): boolean =>
  ['visualization', 'context', 'datasets', 'label', 'width', 'height', 'maxMarks'].some((key) => changed.has(key));

/**
 * Shared family surface for the six Cartesian views. It owns no query/runtime
 * state: the host supplies a bound visualization and exact current rows.
 */
export abstract class VarendoCartesianElement extends VarendoFoundationElement {
  // This surface has several independent focus targets. Delegating a pointer
  // press to its first viewport can scroll a data button away before mouseup.
  static override readonly shadowRootOptions: ShadowRootInit = { mode: 'open', delegatesFocus: false };
  static readonly properties = {
    visualization: { attribute: false },
    context: { attribute: false },
    datasets: { attribute: false },
    label: { type: String },
    width: { type: Number },
    fitWidth: { type: Boolean, attribute: 'fit-width' },
    height: { type: Number },
    maxMarks: { type: Number, attribute: 'max-marks' },
    selectionEnabled: { type: Boolean, attribute: false },
    selectedIdentity: { type: String, attribute: 'selected-identity' },
    selectedResult: { attribute: false },
  };

  static readonly styles = [
    ...varendoFoundationThemeStyles,
    css`
      :host {
        color: var(--varendo-color-text, #111827);
        display: block;
        max-inline-size: 100%;
        min-inline-size: 0;
      }
      figure {
        margin: 0;
      }
      figcaption {
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
        margin-block-end: var(--varendo-space-8, 0.5rem);
      }
      [part='scope'],
      [part='note'],
      [part='error'],
      [part='color-key'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
      }
      [part='viewport'] {
        direction: ltr;
        max-inline-size: 100%;
        min-inline-size: 0;
        overflow: auto;
        position: relative;
      }
      [part='viewport'] svg {
        background: var(--varendo-color-canvas, #fff);
        block-size: auto;
        display: block;
      }
      [part='viewport'] svg text {
        fill: currentColor;
        font:
          11px system-ui,
          sans-serif;
      }
      [part='data'] {
        max-inline-size: 100%;
        min-inline-size: 0;
        overflow: auto;
      }
      table {
        border-collapse: collapse;
        inline-size: 100%;
        margin-block-start: var(--varendo-space-12, 0.75rem);
        min-inline-size: 28rem;
      }
      caption,
      th,
      td {
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
      }
      th,
      td {
        border-block-end: 1px solid var(--varendo-color-border, #64748b);
        padding: var(--varendo-space-8, 0.5rem);
        text-align: start;
      }
      th {
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
      }
      button {
        background: var(--varendo-color-surface, #f8fafc);
        border: var(--varendo-control-border-width, 0.0625rem) solid var(--varendo-color-border, #64748b);
        color: var(--varendo-color-text, #111827);
        font: inherit;
        min-block-size: var(--varendo-control-min-target, 2.75rem);
        min-inline-size: var(--varendo-control-min-target, 2.75rem);
      }
      button:focus-visible {
        outline: var(--varendo-focus-width, 3px) solid var(--varendo-color-focus, #4338ca);
        outline-offset: var(--varendo-focus-offset, 2px);
      }
      [part='legend'],
      [part='color-key-ticks'] {
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-8, 0.5rem) var(--varendo-space-16, 1rem);
        list-style: none;
        margin: var(--varendo-space-8, 0.5rem) 0 0;
        padding: 0;
      }
      [part='color-key-ticks'] {
        direction: ltr;
        inline-size: min(24rem, 100%);
        justify-content: space-between;
        unicode-bidi: isolate;
      }
      [part='legend'] li {
        align-items: center;
        display: inline-flex;
        gap: var(--varendo-space-4, 0.25rem);
      }
      [part='legend-marker'] {
        block-size: 0.75rem;
        inline-size: 0.75rem;
      }
      [part='warnings'] {
        color: var(--varendo-color-warning, #92400e);
        margin: var(--varendo-space-8, 0.5rem) 0 0;
        padding-inline-start: 1.25rem;
      }
      [part='color-key-bar'] {
        background: linear-gradient(
          to right,
          ${unsafeCSS(QUANTITATIVE_COLOR_START)},
          ${unsafeCSS(QUANTITATIVE_COLOR_END)}
        );
        block-size: 0.75rem;
        inline-size: min(24rem, 100%);
      }
      [part='pagination'] {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-8, 0.5rem);
        margin-block-start: var(--varendo-space-8, 0.5rem);
      }
      [part='facet'],
      [part='concat-inline'],
      [part='concat-block'] {
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-16, 1rem);
      }
      [part='concat-inline'] {
        overflow-inline: auto;
        flex-wrap: nowrap;
      }
      [part='layer'] {
        display: grid;
        overflow: auto;
      }
      [part='layer'] > div {
        grid-area: 1 / 1;
      }
      [part='viewport'] svg .gridline {
        opacity: 0.45;
        stroke: var(--varendo-chart-rule, var(--varendo-color-border, #8d98a5));
        stroke-dasharray: 2 4;
        stroke-width: 1;
      }
      [part='viewport'] svg[data-single-row-ticks] :is(.axis-x-tick-offset, .axis-title-x) {
        transform: translateY(-44px);
      }
      [part='data-details'] > summary {
        cursor: pointer;
      }
      @media (max-width: 30rem) {
        [part='viewport'] svg {
          inline-size: 100%;
        }
        [part='viewport'] svg text {
          font-size: 1rem;
        }
        [part='viewport'] svg :is(.axis-x-tick, .axis-y-tick) {
          font-size: max(0.875rem, calc(1rem - 2px));
        }
        [part='data'] {
          overflow: visible;
        }
        table {
          display: block;
          inline-size: 100%;
          min-inline-size: 0;
        }
        caption {
          display: block;
          margin-block: var(--varendo-space-12, 0.75rem);
          text-align: start;
        }
        thead {
          block-size: 1px;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          inline-size: 1px;
          overflow: hidden;
          position: absolute;
          white-space: nowrap;
        }
        tbody {
          display: grid;
          gap: var(--varendo-space-12, 0.75rem);
        }
        tr {
          border-block-end: 1px solid var(--varendo-color-border, #64748b);
          display: block;
          padding-block: var(--varendo-space-4, 0.25rem);
        }
        td {
          border: 0;
          display: grid;
          gap: var(--varendo-space-8, 0.5rem);
          grid-template-columns: minmax(4.75rem, 0.7fr) minmax(0, 1.3fr);
          padding: var(--varendo-space-4, 0.25rem);
        }
        td::before {
          content: attr(data-label);
          font-weight: var(--varendo-typography-font-weight-semibold, 600);
          overflow-wrap: anywhere;
        }
        td > button {
          justify-self: start;
        }
      }
      @media (forced-colors: active) {
        button {
          background: Canvas;
          color: CanvasText;
        }
        [part='viewport'] svg path,
        [part='viewport'] svg circle,
        [part='viewport'] svg rect {
          stroke: CanvasText;
          fill: CanvasText;
        }
      }
    `,
  ];

  visualization: VisualizationSpec | undefined = undefined;
  context: VisualizationInputs['context'] = { results: [] };
  datasets: readonly VisualizationDataset[] = [];
  label = 'Data visualization';
  width = 640;
  /** Follow the host's inline size instead of the fixed `width`. */
  fitWidth = false;
  height = 320;
  maxMarks = 20_000;
  selectionEnabled = true;
  selectedIdentity = '';
  selectedResult: ResultRef | undefined;

  private state: CartesianState = { kind: 'empty' };
  private page = 0;
  private singleResult = true;
  private focusedIdentity: string | undefined;
  private focusedResult: string | undefined;
  private focusedElement: HTMLElement | undefined;
  private tickRows: ResizeObserver | undefined;

  protected abstract readonly expectedView: CartesianView;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!inputChanged(changed)) return;
    this.captureFocusedRow();
    this.page = 0;
    this.state = { kind: 'empty' };
    if (this.visualization === undefined) {
      this.clearSelection();
      return;
    }
    const compiled = this.compileCurrentVisualization();
    if (!compiled.ok) {
      this.setError(compiled.diagnostics);
      return;
    }
    this.state = { kind: 'ready', bound: compiled.value.bound, compiled: compiled.value.compiled };
    this.retainSelection(compiled.value.compiled);
  }

  private captureFocusedRow(): void {
    const active = this.shadowRoot?.activeElement;
    const elementConstructor = globalThis.HTMLElement;
    if (elementConstructor !== undefined && active instanceof elementConstructor) {
      const button = active.closest<HTMLButtonElement>('button[data-varendo-row-identity]');
      if (
        button !== null &&
        button.dataset.varendoRowIdentity !== undefined &&
        button.dataset.varendoResult !== undefined
      ) {
        this.focusedIdentity = button.dataset.varendoRowIdentity;
        this.focusedResult = button.dataset.varendoResult;
        this.focusedElement = button;
      }
    }
  }

  private setError(diagnostics: readonly Diagnostic[]): void {
    this.state = { kind: 'error', diagnostics };
    this.clearSelection();
  }

  private compileCurrentVisualization(): Outcome<{
    readonly bound: BoundVisualization;
    readonly compiled: CompiledPlot;
  }> {
    if (this.visualization === undefined) return fail('input', 'A visualization specification is required.');
    const bound = bindVisualizationSpec(this.visualization, this.context);
    if (!bound.ok) {
      return bound;
    }
    if (bound.value.spec.view !== this.expectedView || !('plot' in bound.value.spec)) {
      return fail('view', `This surface only accepts the ${this.expectedView} visualization family.`);
    }
    const datasets = this.materializeDatasets(bound.value);
    if (!datasets.ok) return datasets;
    const compiled = compilePlotComposition(bound.value.spec.plot, bound.value.results, datasets.value, {
      width: this.width,
      height: this.height,
      maxRows: 10_000,
      maxMarks: this.maxMarks,
      family: this.expectedView,
      ...(bound.value.spec.view === 'area' ? { stack: bound.value.spec.stack } : {}),
    });
    if (!compiled.ok) return compiled;
    return { ok: true, value: { bound: bound.value, compiled: compiled.value } };
  }

  private materializeDatasets(bound: BoundVisualization): Outcome<PlotDataset[]> {
    const datasets: PlotDataset[] = [];
    for (const result of bound.results) {
      const materialized = materializeVisualizationRows(bound, result.ref, this.datasets);
      if (!materialized.ok) {
        return materialized;
      }
      datasets.push({ result: result.ref, rows: materialized.value.map((row) => row.values) });
    }
    return { ok: true, value: datasets };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Text size changes resize the figure without a Lit update; re-measure the axis labels then.
    this.tickRows ??=
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => requestAnimationFrame(() => this.fitTickRows()))
        : undefined;
    this.tickRows?.observe(this);
  }

  override disconnectedCallback(): void {
    this.tickRows?.disconnect();
    super.disconnectedCallback();
  }

  private fitTickRows(): void {
    if (this.fitWidth) {
      const measured = Math.min(1600, Math.max(320, Math.floor(this.clientWidth)));
      if (this.clientWidth > 0 && measured !== this.width) this.width = measured;
    }
    if (this.shadowRoot !== null) fitAxisTickRows(this.shadowRoot);
  }

  protected override updated(changed: Map<string, unknown>): void {
    this.fitTickRows();
    if (!inputChanged(changed) || this.focusedIdentity === undefined || this.focusedResult === undefined) return;
    const identity = this.focusedIdentity;
    const result = this.focusedResult;
    const focusedElement = this.focusedElement;
    this.focusedIdentity = undefined;
    this.focusedResult = undefined;
    this.focusedElement = undefined;
    if (focusedElement?.isConnected) {
      focusedElement.focus();
      return;
    }
    const target = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('button[data-varendo-row-identity]') ?? []),
    ].find(
      (candidate) => candidate.dataset.varendoRowIdentity === identity && candidate.dataset.varendoResult === result,
    );
    target?.focus();
  }

  protected override render() {
    return renderCartesian(this.renderContext());
  }

  private renderContext(): CartesianRenderContext {
    return {
      state: this.state,
      expectedView: this.expectedView,
      label: this.label,
      width: this.width,
      page: this.page,
      selectionEnabled: this.selectionEnabled,
      isSelected: (identity, result) => this.isSelected(identity, result),
      select: (identity, result) => this.select(identity, result),
      setPage: (page) => {
        this.page = page;
        this.requestUpdate();
      },
    };
  }

  private isSelected(identity: string, result: ResultRef): boolean {
    if (identity !== this.selectedIdentity) return false;
    if (this.selectedResult === undefined) return this.singleResult;
    return resultKey(result) === resultKey(this.selectedResult);
  }

  private select(identity: string, result: ResultRef): void {
    if (!this.selectionEnabled) return;
    const selection = new CustomEvent<VarendoVisualizationSelectionDetail>('varendo-visualization-select', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: Object.freeze({ source: 'user', identity, result }),
    });
    if (!this.dispatchEvent(selection)) return;
    this.selectedIdentity = identity;
    this.selectedResult = result;
    this.requestUpdate();
  }

  private clearSelection(): void {
    this.selectedIdentity = '';
    this.selectedResult = undefined;
  }
  private retainSelection(compiled: CompiledPlot): void {
    const geometries: PlotGeometry[] = [];
    const visit = (node: CompiledPlotNode): void => {
      if (node.kind === 'unit') geometries.push(node.geometry);
      else if (node.kind === 'facet') node.children.forEach((child) => visit(child.node));
      else node.children.forEach(visit);
    };
    visit(compiled.root);
    this.singleResult = new Set(geometries.map((geometry) => resultKey(geometry.result.ref))).size === 1;
    const stillPresent = geometries.some(
      (geometry) =>
        resultKey(geometry.result.ref) === resultKey(this.selectedResult ?? geometry.result.ref) &&
        geometry.rows.some((row) => row.identity === this.selectedIdentity),
    );
    if (!stillPresent) {
      this.selectedIdentity = '';
      this.selectedResult = undefined;
    }
  }
}

export type CartesianElementInputs = Pick<
  VisualizationInputs,
  'visualization' | 'context' | 'datasets' | 'label' | 'width' | 'height' | 'maxMarks'
>;
