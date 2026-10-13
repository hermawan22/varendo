import { renderVarendoVisualizationPresentationNode } from './visualization-renderer.js';
import { VARENDO_VISUALIZATION_REFS } from './visualization-registry.js';
import { renderVarendoDataPresentationNode } from './data-presentation.js';
import { VARENDO_DATA_REFS } from './data-registry.js';
import type { VarendoRegionDataRequestHandler } from './types.js';
import {
  filterPort,
  filterPredicates,
  configColumns as tableConfigColumns,
  fieldLabel as getFieldLabel,
  filterValue as getFilterValue,
  inputChangeDetail,
  refKey,
  resultColumns,
  resultFor,
  replacementForFocusedElement,
  selectionKeys as getSelectionKeys,
  tableSelectionDetail,
  tableDisplayState,
  tableSelectionMode,
  text,
  valuesOf,
} from './element-helpers.js';
import { renderNavigationFeedbackNode } from './navigation-feedback-renderer.js';
import { renderInputNode } from './input-renderer.js';
import { renderFoundationNode } from './foundation-renderer.js';
import { renderTrendNode } from './trend-renderer.js';
import type { InteractionPayload, InteractionState } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { MovableNodeParts, movableNode } from './movable-node-parts.js';
import type { PropertyValues } from 'lit';
import { VARENDO_WEB_VERSION } from '../version.js';
import { varendoThemeStyles } from '../styles/theme.js';
import '../elements/varendo-table.js';
import '../elements/varendo-chart.js';
import { stableTableRowKey } from '../elements/varendo-table.js';
import type { VarendoTableSelectionDetail } from '../types.js';
import type {
  VarendoRegionResult,
  VarendoSemanticInteractionHandler,
  VarendoSemanticInteractionRequest,
  VarendoViewDefinition,
} from './types.js';

/**
 * One controlled renderer for a validated presentation. It consumes only
 * host-resolved descriptors and bounded rows; query, authority and route
 * decisions remain outside this element.
 */
export class VarendoRegionElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    presentation: { attribute: false },
    results: { attribute: false },
    interaction: { attribute: false },
    onSemanticInteraction: { attribute: false },
    onDataRequest: { attribute: false },
    viewRenderers: { attribute: false },
  };

  presentation: ValidatedPresentation | undefined = undefined;
  results: readonly VarendoRegionResult[] = [];
  interaction: InteractionState | undefined = undefined;
  onSemanticInteraction: VarendoSemanticInteractionHandler | undefined = undefined;
  onDataRequest: VarendoRegionDataRequestHandler | undefined = undefined;
  viewRenderers: readonly VarendoViewDefinition[] = [];
  private readonly nodeParts = new MovableNodeParts();
  private synchronousPublication = false;
  private publicationOwner: symbol | undefined;
  private renderedTemplate: TemplateResult | typeof nothing = nothing;
  private retainedTemplate: { readonly value: TemplateResult | typeof nothing } | undefined;
  private focusedNodeId: string | undefined;
  private focusedElement: HTMLElement | undefined;

  /** Flush the Region root synchronously inside an authorized host transaction.
   * Custom renderer errors propagate; descendant async work is not awaited.
   */
  flushPresentation(): void {
    this.synchronousPublication = true;
    try {
      this.performUpdate();
    } finally {
      this.synchronousPublication = false;
    }
  }

  /** Retain the existing template for rollback without invoking a failed host renderer again. */
  preparePublication(): { apply(): void; rollback(): void; complete(): void } {
    const previous = this.renderedTemplate;
    const owner = Symbol('publication');
    return {
      apply: () => {
        this.publicationOwner = owner;
        this.flushPresentation();
      },
      complete: () => {
        if (this.publicationOwner !== owner) return;
        try {
          this.nodeParts.complete();
        } finally {
          this.publicationOwner = undefined;
        }
      },
      rollback: () => {
        if (this.publicationOwner !== owner) return;
        this.retainedTemplate = { value: previous };
        try {
          this.requestUpdate();
          this.flushPresentation();
        } finally {
          this.retainedTemplate = undefined;
        }
      },
    };
  }

  /** Clear committed content when the host revokes or disposes the region. */
  clear(): void {
    this.presentation = undefined;
    this.results = [];
    this.interaction = undefined;
  }

  revoke(): void {
    this.clear();
    this.flushPresentation();
    this.nodeParts.clear();
    this.publicationOwner = undefined;
  }
  dispose(): void {
    this.clear();
    this.nodeParts.clear();
    this.publicationOwner = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('presentation')) return;
    const active = this.shadowRoot?.activeElement;
    const elementConstructor = globalThis.HTMLElement;
    if (elementConstructor === undefined || !(active instanceof elementConstructor)) return;
    const nodeHost = active.closest<HTMLElement>('[data-varendo-node-id]');
    if (nodeHost === null) return;
    this.focusedNodeId = nodeHost.dataset.varendoNodeId;
    const nested = active.shadowRoot?.activeElement;
    this.focusedElement = nested instanceof HTMLElement ? nested : active;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!this.synchronousPublication && this.publicationOwner === undefined) this.nodeParts.complete();
    if (!changed.has('presentation') || this.focusedNodeId === undefined) return;
    const focusedElement = this.focusedElement;
    const nodeId = this.focusedNodeId;
    this.focusedElement = undefined;
    this.focusedNodeId = undefined;
    const restore = (): void => this.restoreFocus(nodeId, focusedElement);
    restore();
    // A child renderer can replace the previously focused control in the
    // microtask after this element updates. Retry once so focus follows the
    // stable node identity through that child update as well.
    queueMicrotask(restore);
  }

  private restoreFocus(nodeId: string, focusedElement: HTMLElement | undefined): void {
    if (!this.isConnected) return;
    if (focusedElement?.isConnected) {
      focusedElement.focus();
      return;
    }
    const target = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('[data-varendo-node-id]') ?? [])].find(
      (candidate) => candidate.dataset.varendoNodeId === nodeId,
    );
    if (target === undefined) return;
    (replacementForFocusedElement(target, focusedElement) ?? target).focus();
  }

  protected override render(): TemplateResult | typeof nothing {
    const template = this.retainedTemplate?.value ?? this.renderPresentation();
    const layout = this.layoutIdentity();
    this.nodeParts.begin(layout.signature, layout.dependencies);
    this.renderedTemplate = template;
    return template;
  }

  private layoutIdentity(): { signature: string; dependencies: readonly unknown[] } {
    const customParent = this.presentation?.nodes.some(
      (node) =>
        node.node.children.length > 0 &&
        this.viewRenderers.some(
          (view) => view.ref.id === node.manifest.id && view.ref.revision === node.manifest.revision,
        ),
    );
    const signature = JSON.stringify({
      root: this.presentation?.plan.rootId,
      nodes: this.presentation?.plan.nodes.map(({ id, representation, children, config }) => ({
        id,
        representation,
        children,
        config,
      })),
      // A custom parent may derive wrapper structure from its captured Result or children.
      results: customParent ? this.results.map((result) => result.ref) : undefined,
    });
    return { signature, dependencies: [this.viewRenderers, customParent ? this.results : undefined] };
  }

  private renderPresentation(): TemplateResult | typeof nothing {
    if (this.presentation === undefined) return nothing;
    const nodes = new Map(this.presentation.nodes.map((node) => [node.node.id, node]));
    if (!nodes.has(this.presentation.plan.rootId)) return nothing;
    return html`<div
      part="region"
      lang=${this.presentation.environment.locale}
      dir=${this.presentation.environment.direction}
    >
      ${this.renderNode(this.presentation.plan.rootId, nodes)}
    </div>`;
  }

  private renderNode(
    nodeId: string,
    nodes: ReadonlyMap<string, ValidatedPresentation['nodes'][number]>,
  ): TemplateResult | typeof nothing {
    const resolved = nodes.get(nodeId);
    if (resolved === undefined) return nothing;
    const key = JSON.stringify([nodeId, resolved.manifest.id, resolved.manifest.revision]);
    return html`${movableNode(this.nodeParts, key, this.renderNodeContent(resolved, nodes))}`;
  }

  private renderNodeContent(
    resolved: ValidatedPresentation['nodes'][number],
    nodes: ReadonlyMap<string, ValidatedPresentation['nodes'][number]>,
  ): TemplateResult | typeof nothing {
    const children = (): TemplateResult => {
      const rendered = resolved.node.children.map((id) => ({ id, template: this.renderNode(id, nodes) }));
      return html`${repeat(
        rendered,
        (child) => child.id,
        (child) => child.template,
      )}`;
    };
    const values = valuesOf(resolved);
    switch (resolved.manifest.id) {
      case 'layout.stack': {
        const gap =
          typeof values.gap === 'number' && Number.isSafeInteger(values.gap) && values.gap >= 0 && values.gap <= 64
            ? `${values.gap}px`
            : 'var(--varendo-space-24, 1.5rem)';
        return html`<div
          part="stack"
          data-varendo-role="stack"
          data-varendo-node-id=${resolved.node.id}
          style=${`gap:${gap}`}
        >
          ${children()}
        </div>`;
      }
      case 'data.table':
        return this.renderTable(resolved, values);
      case 'data.trend':
        return renderTrendNode(
          resolved,
          values,
          resultFor(resolved, this.results),
          this.presentation?.environment.locale,
        );
      case 'control.filter':
        return this.renderFilter(resolved, values);
      default:
        return this.renderRegisteredNode(resolved, nodes, children);
    }
  }

  private renderRegisteredNode(
    resolved: ValidatedPresentation['nodes'][number],
    nodes: ReadonlyMap<string, ValidatedPresentation['nodes'][number]>,
    children: () => TemplateResult,
  ): TemplateResult | typeof nothing {
    const child = (childId: string): TemplateResult | typeof nothing => this.renderNode(childId, nodes);
    const emit = (node: ValidatedPresentation['nodes'][number], portId: string, payload: InteractionPayload): void =>
      this.emitFoundation(node, portId, payload);
    const unsupported = html`<div part="unsupported">Unsupported registered representation.</div>`;
    return (
      renderFoundationNode(resolved, child, emit) ??
      renderInputNode(resolved, child, emit, this.presentation?.environment.locale) ??
      renderNavigationFeedbackNode(resolved, child, emit) ??
      this.renderData(resolved) ??
      this.renderVisualization(resolved) ??
      this.renderCustom(resolved, children) ??
      unsupported
    );
  }

  private renderCustom(
    node: ValidatedPresentation['nodes'][number],
    children: () => TemplateResult | typeof nothing,
  ): TemplateResult | typeof nothing | undefined {
    const definition = this.viewRenderers.find(
      (candidate) => candidate.ref.id === node.manifest.id && candidate.ref.revision === node.manifest.revision,
    );
    if (definition === undefined) return undefined;
    const result = resultFor(node, this.results);
    try {
      return definition.render({ node, ...(result === undefined ? {} : { result }), children });
    } catch (error) {
      if (this.synchronousPublication) throw error;
      return html`<div part="unsupported">Custom view could not be rendered.</div>`;
    }
  }

  private renderVisualization(
    node: ValidatedPresentation['nodes'][number],
  ): TemplateResult | typeof nothing | undefined {
    if (
      !Object.values(VARENDO_VISUALIZATION_REFS).some(
        (ref) => ref.id === node.manifest.id && ref.revision === node.manifest.revision,
      )
    )
      return undefined;
    const current = resultFor(node, this.results);
    if (current === undefined || node.result === undefined) return html`<p part="status">Data unavailable.</p>`;
    const context = current.visualizationContext ?? { results: [node.result] };
    const entity = node.config.ports.find((port) => port.id === 'selection' && port.payload === 'selection')?.entity;
    const rendered = renderVarendoVisualizationPresentationNode(
      node,
      { result: node.result, context, datasets: [{ result: current.ref, rows: current.rows }] },
      {
        ...(this.interaction === undefined ? {} : { interaction: this.interaction }),
        onSemanticInteraction: (_nodeId, portId, payload) => this.emitFoundation(node, portId, payload),
      },
      { resolveEntity: () => entity },
    );
    return rendered === nothing
      ? html`<p part="status">Data unavailable.</p>`
      : html`<div data-varendo-node-id=${node.node.id}>${rendered}</div>`;
  }

  private renderData(node: ValidatedPresentation['nodes'][number]): TemplateResult | typeof nothing | undefined {
    if (
      !Object.values(VARENDO_DATA_REFS).some(
        (ref) => ref.id === node.manifest.id && ref.revision === node.manifest.revision,
      )
    )
      return undefined;
    const current = resultFor(node, this.results);
    if (current === undefined || node.result === undefined) return html`<p part="status">Data unavailable.</p>`;
    const entity = node.config.ports.find((port) => port.payload === 'selection')?.entity;
    const rendered = renderVarendoDataPresentationNode(
      node,
      {
        result: node.result,
        rows: current.rows,
        ...(current.columns === undefined ? {} : { columns: current.columns }),
        ...(current.scope === undefined ? {} : { scope: current.scope }),
      },
      {
        ...(this.interaction === undefined ? {} : { interaction: this.interaction }),
        onRequest: (request) => {
          if (request.kind === 'selection' || request.kind === 'filter')
            this.emitFoundation(node, request.portId, request.payload);
          else this.onDataRequest?.(request);
        },
      },
      { resolveEntity: () => entity },
    );
    return rendered === nothing ? html`<p part="status">Data unavailable.</p>` : rendered;
  }

  private emitFoundation(
    node: ValidatedPresentation['nodes'][number],
    portId: string,
    payload: InteractionPayload,
  ): void {
    if (!node.config.ports.some((port) => port.id === portId && port.payload === payload.kind)) return;
    this.onSemanticInteraction?.({ nodeId: node.node.id, portId, payload });
  }

  private renderTable(
    resolved: ValidatedPresentation['nodes'][number],
    values: Record<string, unknown>,
  ): TemplateResult {
    const bound = resultFor(resolved, this.results);
    const columns = tableConfigColumns(values, resultColumns(resolved, bound));
    const selection = tableSelectionMode(values.selection);
    const nodeId = resolved.node.id;
    const selectedKeys = getSelectionKeys(nodeId, this.interaction);
    const result = resolved.result?.ref;
    const selectionPort = resolved.config.ports.find((candidate) => candidate.payload === 'selection');
    const entity = selectionPort?.entity ?? 'row';
    const display = tableDisplayState(resolved, bound);
    return html`<varendo-table
      data-varendo-node-id=${nodeId}
      data-varendo-theme="inherit"
      .columns=${columns}
      .rows=${bound?.rows ?? []}
      .caption=${text(values.caption)}
      .emptyLabel=${display.emptyLabel}
      .entity=${entity}
      .identity=${resolved.result?.identity ?? []}
      .selection=${selection}
      .selectedKeys=${selectedKeys}
      .result=${result}
      .scope=${bound?.scope}
      .status=${display.status}
      .message=${display.message}
      @varendo-table-selection=${(event: Event) => this.handleTableSelection(event, resolved)}
    ></varendo-table>`;
  }

  private renderFilter(
    resolved: ValidatedPresentation['nodes'][number],
    values: Record<string, unknown>,
  ): TemplateResult {
    const field = text(values.field);
    const current = getFilterValue(resolved.node.id, field, this.interaction);
    return html`<varendo-text-field
      data-varendo-node-id=${resolved.node.id}
      data-varendo-theme="inherit"
      .label=${getFieldLabel(resolved, field)}
      .description=${text(values.placeholder)}
      .value=${current}
      @varendo-input-change=${(event: Event) => this.handleFilter(event, resolved, values)}
    ></varendo-text-field>`;
  }

  private handleTableSelection(event: Event, resolved: ValidatedPresentation['nodes'][number]): void {
    try {
      const detail = tableSelectionDetail(event);
      if (detail === undefined) return;
      const port = resolved.config.ports.find((candidate) => candidate.payload === 'selection');
      if (port === undefined) return;
      const request = this.tableSelectionRequest(detail, resolved, port);
      if (request !== undefined) this.emit(request);
    } catch {
      // Custom events are an untrusted boundary; malformed details are ignored.
    }
  }

  private tableSelectionRequest(
    detail: VarendoTableSelectionDetail,
    resolved: ValidatedPresentation['nodes'][number],
    port: ValidatedPresentation['nodes'][number]['config']['ports'][number],
  ): VarendoSemanticInteractionRequest | undefined {
    if (detail.mode === 'clear') {
      if (detail.entity !== port.entity) return undefined;
      return {
        nodeId: resolved.node.id,
        portId: port.id,
        payload: { kind: 'selection', selection: { mode: 'clear' } },
      };
    }
    if (detail.result === undefined || !this.selectionMatchesResult(detail, resolved, port)) return undefined;
    return {
      nodeId: resolved.node.id,
      portId: port.id,
      payload: {
        kind: 'selection',
        selection: {
          mode: 'ids',
          entity: detail.entity,
          keys: [...detail.keys] as [string, ...string[]],
          result: detail.result,
        },
      },
    };
  }

  private selectionMatchesResult(
    detail: VarendoTableSelectionDetail,
    resolved: ValidatedPresentation['nodes'][number],
    port: ValidatedPresentation['nodes'][number]['config']['ports'][number],
  ): boolean {
    if (detail.entity !== port.entity || detail.result === undefined || resolved.result === undefined) return false;
    if (refKey(detail.result) !== refKey(resolved.result.ref) || detail.keys.length === 0) return false;
    const bound = resultFor(resolved, this.results);
    if (bound === undefined) return false;
    const allowed = new Set(
      bound.rows
        .map((row) => stableTableRowKey(row, port.identity ?? []))
        .filter((key): key is string => key !== undefined),
    );
    return detail.keys.length === new Set(detail.keys).size && detail.keys.every((key) => allowed.has(key));
  }

  private handleFilter(
    event: Event,
    resolved: ValidatedPresentation['nodes'][number],
    values: Record<string, unknown>,
  ): void {
    try {
      const detail = inputChangeDetail(event);
      if (detail === undefined) return;
      const field = text(values.field);
      const outputId = text(values.outputId);
      const port = filterPort(resolved, field, outputId);
      if (port === undefined) return;
      const predicate = filterPredicates(values, field, detail.value);
      const payload: InteractionPayload = { kind: 'filter', predicates: predicate, outputId };
      this.emit({ nodeId: resolved.node.id, portId: port.id, payload });
    } catch {
      // Custom events are an untrusted boundary; malformed details are ignored.
    }
  }

  private emit(request: VarendoSemanticInteractionRequest): void {
    this.onSemanticInteraction?.(request);
  }

  static readonly styles = [
    varendoThemeStyles,
    css`
      :host {
        color: var(--varendo-color-text, #18202a);
        display: block;
      }
      [part='region'] {
        display: block;
        min-inline-size: 0;
      }
      [part='stack'] {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
      }
      [part='unsupported'] {
        color: var(--varendo-color-muted, #495464);
      }
    `,
  ];
}
