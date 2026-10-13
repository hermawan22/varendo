import { parseWireValue } from '@varendo/core';
import type { InteractionPayload } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { record } from './navigation-feedback-support.js';
import { text } from './element-helpers.js';

type Node = ValidatedPresentation['nodes'][number];
type ChildRenderer = (nodeId: string) => unknown;
type Emit = (node: Node, portId: string, payload: InteractionPayload) => void;
type Values = Record<string, unknown>;
interface RenderContext {
  readonly node: Node;
  readonly child: ChildRenderer;
  readonly emit: Emit;
  readonly values: Values;
  readonly id: string;
}
const PAGE_OPERATION = { id: 'navigation.page', revision: '1' } as const;

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function valuesOf(node: Node): Values {
  return node.config.values as Values;
}

function operationDeclared(node: Node, operation: unknown): boolean {
  const candidate = record(operation);
  return (
    candidate !== undefined &&
    typeof candidate.id === 'string' &&
    typeof candidate.revision === 'string' &&
    (node.config.operations ?? []).some(
      (declared) => declared.id === candidate.id && declared.revision === candidate.revision,
    )
  );
}

function declared(node: Node, portId: string, payload: InteractionPayload['kind'], operation?: unknown): boolean {
  return (
    node.config.ports.some(
      (port) =>
        port.id === portId && port.payload === payload && (port.direction === 'output' || port.direction === 'inout'),
    ) &&
    (operation === undefined || operationDeclared(node, operation))
  );
}

function ownedEvent(event: Event, type: string, keys: readonly string[]): Values | undefined {
  if (event.type !== type || typeof CustomEvent === 'undefined' || !(event instanceof CustomEvent)) return undefined;
  try {
    const parsed = parseWireValue(event.detail);
    const detail = parsed.ok ? record(parsed.value) : undefined;
    if (detail === undefined || detail.source !== 'user' || Object.keys(detail).some((key) => !keys.includes(key)))
      return undefined;
    return detail;
  } catch {
    return undefined;
  }
}

function routePayload(value: unknown): Extract<InteractionPayload, { readonly kind: 'navigate' }> | undefined {
  const candidate = record(value);
  const route = record(candidate?.route);
  const params = record(candidate?.params);
  if (route === undefined || typeof route.id !== 'string' || typeof route.revision !== 'string' || params === undefined)
    return undefined;
  return {
    kind: 'navigate',
    route: { id: route.id, revision: route.revision },
    params: params as Extract<InteractionPayload, { readonly kind: 'navigate' }>['params'],
  };
}

function actionPayload(value: unknown): Extract<InteractionPayload, { readonly kind: 'action-request' }> | undefined {
  const candidate = record(value);
  const action = record(candidate?.action);
  const input = record(candidate?.input);
  if (
    action === undefined ||
    typeof action.id !== 'string' ||
    typeof action.revision !== 'string' ||
    input === undefined
  )
    return undefined;
  return {
    kind: 'action-request',
    action: { id: action.id, revision: action.revision },
    input: input as Extract<InteractionPayload, { readonly kind: 'action-request' }>['input'],
  };
}

function itemById(values: Values, id: string): Values | undefined {
  const items = Array.isArray(values.items) ? values.items : [];
  return items.map(record).find((item) => item?.id === id);
}

function emitNavigation(node: Node, event: Event, emit: Emit): void {
  const detail = ownedEvent(event, 'varendo-navigation', ['id', 'href', 'source']);
  const id = detail?.id;
  if (typeof id !== 'string') return;
  const item = itemById(valuesOf(node), id);
  const payload = routePayload(item);
  if (payload === undefined || !declared(node, 'navigate', 'navigate', payload.route)) return;
  event.preventDefault();
  emit(node, 'navigate', payload);
}

function emitItemAction(node: Node, event: Event, emit: Emit): void {
  const detail = ownedEvent(event, 'varendo-menu-action', ['id', 'source']);
  const id = detail?.id;
  if (typeof id !== 'string') return;
  const item = itemById(valuesOf(node), id);
  if (item === undefined || item.disabled === true) return;
  const action = actionPayload(item);
  if (action !== undefined && declared(node, 'action', 'action-request', action.action)) {
    emit(node, 'action', action);
    return;
  }
  const route = routePayload(item);
  if (route !== undefined && declared(node, 'navigate', 'navigate', route.route)) {
    emit(node, 'navigate', route);
  }
}

function emitNodeAction(
  node: Node,
  event: Event,
  type: 'varendo-alert-action' | 'varendo-empty-state-action',
  emit: Emit,
): void {
  const detail = ownedEvent(event, type, type === 'varendo-empty-state-action' ? ['kind', 'source'] : ['source']);
  if (detail === undefined || (type === 'varendo-empty-state-action' && detail.kind !== valuesOf(node).kind)) return;
  const payload = actionPayload(valuesOf(node));
  if (payload === undefined || !declared(node, 'action', 'action-request', payload.action)) return;
  emit(node, 'action', payload);
}

function emitTreeNavigation(node: Node, event: Event, emit: Emit): void {
  const detail = ownedEvent(event, 'varendo-tree-nav-select', ['id', 'previousId', 'source']);
  const id = detail?.id;
  if (typeof id !== 'string') return;
  const nodes: Values[] = [];
  const visit = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      const item = record(raw);
      if (item === undefined) continue;
      nodes.push(item);
      visit(item.children);
    }
  };
  visit(valuesOf(node).nodes);
  const item = nodes.find((candidate) => candidate.id === id);
  if (item === undefined || item.disabled === true) return;
  const action = actionPayload(item);
  if (action !== undefined && declared(node, 'action', 'action-request', action.action)) {
    emit(node, 'action', action);
    return;
  }
  const route = routePayload(item);
  if (route !== undefined && declared(node, 'navigate', 'navigate', route.route)) {
    emit(node, 'navigate', route);
  }
}

function cursorFor(values: Values, page: unknown): Values | undefined {
  if (!Array.isArray(values.cursors)) return undefined;
  return values.cursors.map(record).find((candidate) => candidate?.page === page);
}

function pageEnabled(values: Values, direction: 'next' | 'previous', page: number): boolean {
  if (values.pending === true) return false;
  const directionEnabled = direction === 'next' ? values.hasNext === true : values.hasPrevious === true;
  if (!directionEnabled || page < 1) return false;
  return typeof values.pageCount !== 'number' || page <= values.pageCount;
}

function pageStep(values: Values, detail: Values, direction: 'next' | 'previous'): number | undefined {
  const page = detail.page;
  const previousPage = detail.previousPage;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(previousPage) || !Number.isSafeInteger(values.page))
    return undefined;
  if (previousPage !== values.page) return undefined;
  const expected = direction === 'next' ? Number(previousPage) + 1 : Number(previousPage) - 1;
  return page === expected ? Number(page) : undefined;
}

function pagePayload(
  values: Values,
  detail: Values,
): Extract<InteractionPayload, { readonly kind: 'page' }> | undefined {
  const direction = detail.direction;
  if (direction !== 'next' && direction !== 'previous') return undefined;
  const page = pageStep(values, detail, direction);
  if (page === undefined || !pageEnabled(values, direction, page)) return undefined;
  const cursor = cursorFor(values, page);
  if (typeof cursor?.cursor !== 'string') return undefined;
  if (typeof values.outputId !== 'string' || typeof values.queryDigest !== 'string') return undefined;
  return { kind: 'page', outputId: values.outputId, cursor: cursor.cursor, queryDigest: values.queryDigest };
}

function emitPage(node: Node, event: Event, emit: Emit): void {
  const detail = ownedEvent(event, 'varendo-page-change', ['page', 'previousPage', 'direction', 'source']);
  if (detail === undefined) return;
  const payload = pagePayload(valuesOf(node), detail);
  if (payload === undefined || !declared(node, 'page', 'page', PAGE_OPERATION)) return;
  emit(node, 'page', payload);
}

function children(node: Node, child: ChildRenderer): unknown {
  return repeat(
    node.node.children,
    (id) => id,
    (id) => child(id),
  );
}

function tabChildren(node: Node, child: ChildRenderer): unknown {
  const values = valuesOf(node);
  const items = Array.isArray(values.items) ? values.items.map(record) : [];
  return repeat(
    node.node.children,
    (childId) => childId,
    (childId, index) => {
      const item = items[index];
      return item === undefined || typeof item.id !== 'string'
        ? nothing
        : html`<div slot=${item.id} data-varendo-tab-content=${item.id}>${child(childId)}</div>`;
    },
  );
}

/**
 * Render one registered navigation/feedback node through the existing owned
 * component. This function contains event adaptation only; focus, dismissal,
 * keyboard behavior and overlay state remain in the component implementation.
 */
function navigationNode(context: RenderContext): TemplateResult | undefined {
  const { node, child, emit, values, id } = context;
  switch (node.manifest.id) {
    case 'navigation.breadcrumb':
      return html`<varendo-breadcrumb
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .items=${values.items ?? []}
        .label=${text(values.label)}
        @varendo-navigation=${(event: Event) => emitNavigation(node, event, emit)}
      ></varendo-breadcrumb>`;
    case 'navigation.menu':
      return html`<varendo-menu
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .items=${values.items ?? []}
        .label=${text(values.label)}
        @varendo-menu-action=${(event: Event) => emitItemAction(node, event, emit)}
      ></varendo-menu>`;
    case 'navigation.pagination':
      return html`<varendo-pagination
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .page=${values.page}
        .pageCount=${values.pageCount}
        .hasPrevious=${booleanValue(values.hasPrevious, false)}
        .hasNext=${booleanValue(values.hasNext, false)}
        .label=${text(values.label)}
        .pending=${booleanValue(values.pending, false)}
        @varendo-page-change=${(event: Event) => emitPage(node, event, emit)}
      ></varendo-pagination>`;
    case 'navigation.tabs':
      return html`<varendo-tabs
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .items=${values.items ?? []}
        .value=${text(values.value)}
        .defaultValue=${text(values.defaultValue)}
        .activation=${text(values.activation, 'automatic')}
        .orientation=${text(values.orientation, 'horizontal')}
        .idPrefix=${text(values.idPrefix, `varendo-tabs-${id}`)}
        >${tabChildren(node, child)}</varendo-tabs
      >`;
    case 'navigation.tree-nav':
      return html`<varendo-tree-nav
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .nodes=${values.nodes ?? []}
        .expandedIds=${values.expandedIds ?? []}
        .selectedId=${text(values.selectedId)}
        .label=${text(values.label)}
        @varendo-tree-nav-select=${(event: Event) => emitTreeNavigation(node, event, emit)}
      ></varendo-tree-nav>`;
    default:
      return undefined;
  }
}

function overlayFeedbackNode(context: RenderContext): TemplateResult | undefined {
  const { node, child, values, id } = context;
  switch (node.manifest.id) {
    case 'feedback.tooltip':
      return html`<varendo-tooltip
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .label=${text(values.label)}
        .content=${text(values.content)}
        .open=${booleanValue(values.open, false)}
      ></varendo-tooltip>`;
    case 'feedback.popover':
      return html`<varendo-popover
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .label=${text(values.label)}
        .content=${text(values.content)}
        .open=${booleanValue(values.open, false)}
        .modal=${booleanValue(values.modal, false)}
        .closeOnOutside=${booleanValue(values.closeOnOutside, true)}
        >${children(node, child)}</varendo-popover
      >`;
    case 'feedback.dialog':
      return html`<varendo-dialog
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .heading=${text(values.heading)}
        .open=${booleanValue(values.open, false)}
        .modal=${booleanValue(values.modal, true)}
        .closeOnEscape=${booleanValue(values.closeOnEscape, true)}
        >${children(node, child)}</varendo-dialog
      >`;
    case 'feedback.drawer':
      return html`<varendo-drawer
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .heading=${text(values.heading)}
        .open=${booleanValue(values.open, false)}
        .mode=${text(values.mode, 'inline')}
        .side=${text(values.side, 'end')}
        >${children(node, child)}</varendo-drawer
      >`;
    default:
      return undefined;
  }
}

function messageFeedbackNode(context: RenderContext): TemplateResult | undefined {
  const { node, emit, values, id } = context;
  switch (node.manifest.id) {
    case 'feedback.toast':
      return html`<varendo-toast
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .message=${text(values.message)}
        .open=${booleanValue(values.open, false)}
        .tone=${text(values.tone, 'info')}
        .duration=${values.duration}
        .dismissible=${booleanValue(values.dismissible, true)}
      ></varendo-toast>`;
    case 'feedback.alert':
      return html`<varendo-alert
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .heading=${text(values.heading)}
        .message=${text(values.message)}
        .open=${booleanValue(values.open, true)}
        .tone=${text(values.tone, 'info')}
        .actionLabel=${text(values.actionLabel)}
        .dismissible=${booleanValue(values.dismissible, false)}
        @varendo-alert-action=${(event: Event) => emitNodeAction(node, event, 'varendo-alert-action', emit)}
      ></varendo-alert>`;
    case 'feedback.progress':
      return html`<varendo-progress
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .label=${text(values.label)}
        .value=${values.progressValue}
        .max=${values.progressMax}
      ></varendo-progress>`;
    case 'feedback.skeleton':
      return html`<varendo-skeleton
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .label=${text(values.label)}
        .lines=${values.lines}
        .variant=${text(values.variant, 'text')}
        .animated=${booleanValue(values.animated, true)}
      ></varendo-skeleton>`;
    case 'feedback.empty-state':
      return html`<varendo-empty-state
        data-varendo-node-id=${id}
        data-varendo-theme="inherit"
        .kind=${text(values.kind, 'failure')}
        .heading=${text(values.heading)}
        .message=${text(values.message)}
        .actionLabel=${text(values.actionLabel)}
        @varendo-empty-state-action=${(event: Event) => emitNodeAction(node, event, 'varendo-empty-state-action', emit)}
      ></varendo-empty-state>`;
    default:
      return undefined;
  }
}

export function renderNavigationFeedbackNode(
  node: Node,
  child: ChildRenderer,
  emit: Emit,
): TemplateResult | typeof nothing | undefined {
  const context = { node, child, emit, values: valuesOf(node), id: node.node.id };
  return navigationNode(context) ?? overlayFeedbackNode(context) ?? messageFeedbackNode(context);
}
