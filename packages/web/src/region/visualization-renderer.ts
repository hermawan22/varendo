import { bindVisualizationSpec, type BoundVisualization } from '@varendo/core/visualization';
import {
  parseVisualizationSpec,
  parseWireValue,
  type InteractionPayload,
  type InteractionState,
  type Result,
  type ResultRef,
  type VisualizationSpec,
} from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { materializeVisualizationRows } from '../visualization/materialization.js';
import type {
  AeliqoVisualizationBinding,
  AeliqoVisualizationPresentationRenderContext,
  AeliqoVisualizationRegistryOptions,
} from './visualization-registry.js';
import { canonicalValue as canonical, resultRefKey as refKey } from './registry-value.js';

type CoreNode = ValidatedPresentation['nodes'][number];
type VisualizationView = VisualizationSpec['view'];
interface VisualizationElementProps {
  readonly visualization: VisualizationSpec;
  readonly context: AeliqoVisualizationBinding['context'];
  readonly datasets: AeliqoVisualizationBinding['datasets'];
  readonly label: string;
  readonly selected: string | undefined;
  readonly selectionEnabled: boolean;
}
type VisualizationElementRenderer = (
  props: VisualizationElementProps,
  onSelect: (event: Event) => void,
) => TemplateResult;

function sameRef(left: ResultRef | undefined, right: ResultRef): boolean {
  try {
    return left !== undefined && refKey(left) === refKey(right);
  } catch {
    return false;
  }
}
function sameResult(left: Result | undefined, right: Result): boolean {
  return left !== undefined && sameRef(left.ref, right.ref) && canonical(left) === canonical(right);
}

function resultRef(value: unknown): ResultRef | undefined {
  const parsed = parseWireValue(value);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value))
    return undefined;
  const candidate = parsed.value as Record<string, unknown>;
  const keys = ['id', 'revision', 'sourceLineage', 'outputId', 'queryDigest', 'scopeDigest'];
  if (
    Object.keys(candidate).length !== keys.length ||
    keys.some((key) => typeof candidate[key] !== 'string' || (candidate[key] as string).length === 0)
  )
    return undefined;
  return candidate as ResultRef;
}

function eventRecord(event: Event): Record<string, unknown> | undefined {
  try {
    if (typeof CustomEvent === 'undefined' || !(event instanceof CustomEvent)) return undefined;
    const parsed = parseWireValue(event.detail);
    if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value))
      return undefined;
    return parsed.value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isUserSelection(
  candidate: Record<string, unknown>,
): candidate is Record<string, unknown> & { readonly identity: string } {
  if (
    Object.keys(candidate).length !== 3 ||
    candidate.source !== 'user' ||
    typeof candidate.identity !== 'string' ||
    candidate.identity.length === 0
  )
    return false;
  return true;
}

function selectionDetail(event: Event): { readonly identity: string; readonly result: ResultRef } | undefined {
  const candidate = eventRecord(event);
  if (candidate === undefined || !isUserSelection(candidate)) return undefined;
  const ref = resultRef(candidate.result);
  return ref === undefined ? undefined : { identity: candidate.identity, result: ref };
}

function selectedIdentity(
  interaction: InteractionState | undefined,
  nodeId: string,
  result: ResultRef,
  entity: string | undefined,
): string | undefined {
  if (interaction === undefined) return undefined;
  try {
    const retained = interaction.values.find(
      (value) => value.nodeId === nodeId && value.portId === 'selection' && value.payload.kind === 'selection',
    );
    const selection = retained?.payload.kind === 'selection' ? retained.payload.selection : undefined;
    return selection?.mode === 'ids' &&
      selection.entity === entity &&
      sameRef(selection.result, result) &&
      selection.keys.length === 1
      ? selection.keys[0]
      : undefined;
  } catch {
    return undefined;
  }
}

const VISUALIZATION_ELEMENT_RENDERERS: Record<VisualizationSpec['view'], VisualizationElementRenderer> = {
  trend: (props, onSelect) =>
    html`<aeliqo-trend
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-trend>`,
  bar: (props, onSelect) =>
    html`<aeliqo-bar
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-bar>`,
  area: (props, onSelect) =>
    html`<aeliqo-area
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-area>`,
  scatter: (props, onSelect) =>
    html`<aeliqo-scatter
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-scatter>`,
  histogram: (props, onSelect) =>
    html`<aeliqo-histogram
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-histogram>`,
  heatmap: (props, onSelect) =>
    html`<aeliqo-heatmap
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      fit-width
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-heatmap>`,
  matrix: (props, onSelect) =>
    html`<aeliqo-matrix
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-matrix>`,
  timeline: (props, onSelect) =>
    html`<aeliqo-timeline
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-timeline>`,
  'calendar-grid': (props, onSelect) =>
    html`<aeliqo-calendar-grid
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-calendar-grid>`,
  tree: (props, onSelect) =>
    html`<aeliqo-tree
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-tree>`,
  treemap: (props, onSelect) =>
    html`<aeliqo-treemap
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-treemap>`,
  relationship: (props, onSelect) =>
    html`<aeliqo-relationship
      .visualization=${props.visualization}
      .context=${props.context}
      .datasets=${props.datasets}
      .label=${props.label}
      .width=${640}
      .height=${360}
      .maxMarks=${20_000}
      .selectedIdentity=${props.selected ?? ''}
      .selectionEnabled=${props.selectionEnabled}
      @aeliqo-visualization-select=${onSelect}
    ></aeliqo-relationship>`,
};

/** Names the chart from the result it answers, for example "New hires by Team". */
function visualizationLabel(result: Result, view: string): string {
  const labels = (measure: boolean) =>
    result.fields
      .filter((field) => (field.role === 'measure') === measure)
      .map((field) => field.label)
      .join(', ');
  const measures = labels(true);
  if (measures === '') return view;
  const groups = labels(false);
  return groups === '' ? measures : `${measures} by ${groups}`;
}

function renderElement(
  spec: VisualizationSpec,
  binding: AeliqoVisualizationBinding,
  label: string,
  selected: string | undefined,
  selectionEnabled: boolean,
  onSelect: (event: Event) => void,
): TemplateResult {
  const props: VisualizationElementProps = {
    visualization: spec,
    context: binding.context,
    datasets: binding.datasets,
    label,
    selected,
    selectionEnabled,
  };
  return VISUALIZATION_ELEMENT_RENDERERS[spec.view](props, onSelect);
}

function declaredSelection(node: CoreNode): boolean {
  return (
    node.config.ports.some(
      (port) =>
        port.id === 'selection' &&
        port.payload === 'selection' &&
        (port.direction === 'output' || port.direction === 'inout'),
    ) &&
    (node.config.operations ?? []).some(
      (operation) => operation.id === 'interaction.selection' && operation.revision === '1',
    )
  );
}

const VISUALIZATION_VIEW_NAMES: Readonly<Record<string, true>> = {
  trend: true,
  bar: true,
  area: true,
  scatter: true,
  histogram: true,
  heatmap: true,
  matrix: true,
  timeline: true,
  'calendar-grid': true,
  tree: true,
  treemap: true,
  relationship: true,
};

function visualizationView(node: CoreNode): VisualizationView | undefined {
  const prefix = 'visualization.';
  if (!node.manifest.id.startsWith(prefix)) return undefined;
  const view = node.manifest.id.slice(prefix.length);
  return Object.hasOwn(VISUALIZATION_VIEW_NAMES, view) ? (view as VisualizationView) : undefined;
}

function trustedBindingMatches(
  result: Result,
  current: AeliqoVisualizationBinding,
  authorized: ReadonlyMap<string, AeliqoVisualizationBinding> | undefined,
): boolean {
  const trusted = authorized?.get(refKey(result.ref));
  if (trusted !== undefined && canonical(trusted) !== canonical(current)) return false;
  return sameResult(current.result, result);
}

function validateBoundVisualization(
  node: CoreNode,
  result: Result,
  current: AeliqoVisualizationBinding,
  view: VisualizationView,
): { readonly spec: VisualizationSpec; readonly bound: BoundVisualization } | undefined {
  const parsed = parseVisualizationSpec(node.config.values.visualization);
  if (!parsed.ok || parsed.value.view !== view) return undefined;
  const bound = bindVisualizationSpec(parsed.value, current.context);
  if (!bound.ok || bound.value.results.length !== 1) return undefined;
  if (!bound.value.results.some((candidate) => sameResult(candidate, result))) return undefined;
  const rows = materializeVisualizationRows(bound.value, result.ref, current.datasets);
  if (!rows.ok) return undefined;
  return { spec: parsed.value, bound: bound.value };
}

function trustedEntity(
  resolver: AeliqoVisualizationRegistryOptions['resolveEntity'],
  result: Result,
): string | undefined {
  if (resolver === undefined) return undefined;
  try {
    return resolver(result);
  } catch {
    return undefined;
  }
}

function expectedSelectionPort(result: Result, owner: string | undefined): readonly unknown[] {
  if (owner === undefined) return [];
  return [
    {
      id: 'selection',
      direction: 'inout',
      payload: 'selection',
      entity: owner,
      identity: [...result.identity],
      grain: [...result.rowGrain],
    },
  ];
}

function expectedFields(spec: VisualizationSpec, result: Result): readonly string[] {
  if (spec.view === 'matrix') return [...spec.columns];
  return result.fields.map((field) => field.id);
}

function expectedOperations(owner: string | undefined, view: VisualizationView): readonly unknown[] {
  return [
    { id: 'data.read', revision: '1' },
    ...(owner === undefined ? [] : [{ id: 'interaction.selection', revision: '1' }]),
    ...(view === 'bar' ? [{ id: 'data.analyze', revision: '1' }] : []),
  ];
}

function configMatches(node: CoreNode, spec: VisualizationSpec, result: Result, owner: string | undefined): boolean {
  return (
    canonical(node.config.values) === canonical({ visualization: spec }) &&
    canonical(node.config.fields) === canonical(expectedFields(spec, result)) &&
    canonical(node.config.ports) === canonical(expectedSelectionPort(result, owner)) &&
    canonical(node.config.operations) === canonical(expectedOperations(owner, spec.view))
  );
}

function dispatchSelection(
  node: CoreNode,
  current: AeliqoVisualizationBinding,
  bound: BoundVisualization,
  detail: { readonly identity: string; readonly result: ResultRef },
  callback: NonNullable<AeliqoVisualizationPresentationRenderContext['onSemanticInteraction']>,
): void {
  if (node.result === undefined || !sameRef(detail.result, node.result.ref)) return;
  const rows = materializeVisualizationRows(bound, node.result.ref, current.datasets);
  if (!rows.ok || !rows.value.some((row) => row.identity === detail.identity)) return;
  const port = node.config.ports.find((candidate) => candidate.id === 'selection' && candidate.payload === 'selection');
  if (port?.entity === undefined) return;
  const payload: InteractionPayload = {
    kind: 'selection',
    selection: { mode: 'ids', entity: port.entity, keys: [detail.identity], result: node.result.ref },
  };
  try {
    callback(node.node.id, port.id, payload);
  } catch {
    // Host callback failures do not change the authorization decision.
  }
}

function selectionHandler(
  node: CoreNode,
  current: AeliqoVisualizationBinding,
  bound: BoundVisualization,
  context: AeliqoVisualizationPresentationRenderContext,
): (event: Event) => void {
  return (event) => {
    const callback = context.onSemanticInteraction;
    if (!declaredSelection(node) || typeof callback !== 'function') {
      event.preventDefault();
      return;
    }
    const detail = selectionDetail(event);
    if (detail !== undefined) dispatchSelection(node, current, bound, detail, callback);
  };
}

function renderWith(
  node: CoreNode,
  current: AeliqoVisualizationBinding,
  context: AeliqoVisualizationPresentationRenderContext,
  options: AeliqoVisualizationRegistryOptions,
  authorized?: ReadonlyMap<string, AeliqoVisualizationBinding>,
): TemplateResult | typeof nothing {
  const result = node.result;
  if (result === undefined) return nothing;
  const inspectedCurrent = parseWireValue(current);
  if (!inspectedCurrent.ok) return nothing;
  const view = visualizationView(node);
  if (view === undefined || !trustedBindingMatches(result, current, authorized)) return nothing;
  const validated = validateBoundVisualization(node, result, current, view);
  if (validated === undefined) return nothing;
  const owner = trustedEntity(options.resolveEntity, result);
  if (!configMatches(node, validated.spec, result, owner)) return nothing;
  const selectionEnabled = declaredSelection(node);
  const selected = selectionEnabled
    ? selectedIdentity(context.interaction, node.node.id, result.ref, owner)
    : undefined;
  const handler = selectionHandler(node, current, validated.bound, context);
  return renderElement(validated.spec, current, visualizationLabel(result, view), selected, selectionEnabled, handler);
}

export function renderAeliqoVisualizationPresentationNode(
  node: CoreNode,
  current: AeliqoVisualizationBinding,
  context: AeliqoVisualizationPresentationRenderContext = {},
  options: AeliqoVisualizationRegistryOptions = {},
  authorized?: ReadonlyMap<string, AeliqoVisualizationBinding>,
): TemplateResult | typeof nothing {
  try {
    return renderWith(node, current, context, options, authorized);
  } catch {
    return nothing;
  }
}
