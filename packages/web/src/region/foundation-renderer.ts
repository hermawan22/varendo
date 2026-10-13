import type { InteractionPayload } from '@varendo/core';
import type { ValidatedPresentation, PresentationValues } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { VarendoFoundationId } from '../foundation/manifest.js';
import type { VarendoActionEvent, VarendoLinkEvent } from '../foundation/events.js';

type Node = ValidatedPresentation['nodes'][number];
type Emit = (node: Node, port: string, payload: InteractionPayload) => void;
type ChildRenderer = (id: string) => unknown;

interface FoundationRenderContext {
  readonly node: Node;
  readonly id: string;
  readonly values: PresentationValues;
  readonly child: ChildRenderer;
  readonly emit: Emit;
}

type FoundationRenderer = (context: FoundationRenderContext) => TemplateResult;

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown) => value === true;

function actionListener(context: FoundationRenderContext) {
  return (event: VarendoActionEvent): void => {
    event.preventDefault();
    context.emit(context.node, 'action', {
      kind: 'action-request',
      action: context.values.action as Extract<InteractionPayload, { kind: 'action-request' }>['action'],
      input: context.values.actionInput as Extract<InteractionPayload, { kind: 'action-request' }>['input'],
    });
  };
}

function navigationListener(context: FoundationRenderContext) {
  return (event: VarendoLinkEvent): void => {
    if (event.detail.target === '_blank' || event.detail.modified === true) return;
    event.preventDefault();
    context.emit(context.node, 'navigate', {
      kind: 'navigate',
      route: context.values.route as Extract<InteractionPayload, { kind: 'navigate' }>['route'],
      params: context.values.params as Extract<InteractionPayload, { kind: 'navigate' }>['params'],
    });
  };
}

function renderChildren(context: FoundationRenderContext) {
  return repeat(
    context.node.node.children,
    (id) => id,
    (id) => context.child(id),
  );
}

function renderButton(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-button
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .label=${text(context.values.text)}
    .variant=${context.values.variant ?? 'solid'}
    .size=${context.values.size ?? 'medium'}
    type="button"
    @varendo-action=${actionListener(context)}
  ></varendo-button>`;
}

function renderIconButton(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-icon-button
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .label=${text(context.values.text)}
    .size=${context.values.size ?? 'medium'}
    type="button"
    @varendo-action=${actionListener(context)}
    ><span slot="icon" aria-hidden="true">⋯</span></varendo-icon-button
  >`;
}

function renderLink(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-link
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .label=${text(context.values.text)}
    .href=${text(context.values.href)}
    .target=${context.values.target ?? '_self'}
    @varendo-link=${navigationListener(context)}
  ></varendo-link>`;
}

function renderText(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-text
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .text=${text(context.values.text)}
    .as=${context.values.as ?? 'span'}
    .muted=${bool(context.values.muted)}
  ></varendo-text>`;
}

function renderHeading(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-heading
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .text=${text(context.values.text)}
    .level=${context.values.level ?? 2}
    .size=${context.values.size ?? 'heading'}
  ></varendo-heading>`;
}

function renderBadge(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-badge
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .text=${text(context.values.text)}
    .tone=${context.values.tone ?? 'neutral'}
  ></varendo-badge>`;
}

function renderAvatar(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-avatar
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .name=${text(context.values.name)}
    .src=${text(context.values.src)}
    .alt=${text(context.values.alt)}
    .size=${context.values.size ?? 'medium'}
    .decorative=${bool(context.values.decorative)}
  ></varendo-avatar>`;
}

function renderSeparator(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-separator
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .orientation=${context.values.orientation ?? 'horizontal'}
    .decorative=${context.values.decorative ?? true}
  ></varendo-separator>`;
}

function renderSurface(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-surface
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .as=${context.values.as ?? 'div'}
    .tone=${context.values.tone ?? 'surface'}
    .label=${text(context.values.label)}
    >${renderChildren(context)}</varendo-surface
  >`;
}

function renderStack(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-stack
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .direction=${context.values.direction ?? 'column'}
    .gap=${context.values.gap ?? 16}
    .align=${context.values.align ?? 'stretch'}
    .justify=${context.values.justify ?? 'start'}
    .wrap=${bool(context.values.wrap)}
    >${renderChildren(context)}</varendo-stack
  >`;
}

function renderGrid(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-grid
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .columns=${context.values.columns ?? 2}
    .gap=${context.values.gap ?? 16}
    .minItem=${context.values.minItem ?? 'medium'}
    >${renderChildren(context)}</varendo-grid
  >`;
}

function renderScrollArea(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-scroll-area
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .axis=${context.values.axis ?? 'y'}
    .label=${text(context.values.label)}
    >${renderChildren(context)}</varendo-scroll-area
  >`;
}

function splitPaneChild(context: FoundationRenderContext, index: number, slot: string) {
  const id = context.node.node.children[index];
  const content = id === undefined ? nothing : context.child(id);
  return html`<div slot=${slot}>${content}</div>`;
}

function renderSplitPane(context: FoundationRenderContext): TemplateResult {
  return html`<varendo-split-pane
    data-varendo-node-id=${context.id}
    data-varendo-theme="inherit"
    .orientation=${context.values.orientation ?? 'horizontal'}
    .defaultPosition=${context.values.position ?? 50}
    .min=${context.values.min ?? 20}
    .max=${context.values.max ?? 80}
    .step=${context.values.step ?? 5}
    >${splitPaneChild(context, 0, 'start')}${splitPaneChild(context, 1, 'end')}</varendo-split-pane
  >`;
}

const FOUNDATION_RENDERERS: Partial<Record<VarendoFoundationId, FoundationRenderer>> = {
  'foundation.button': renderButton,
  'foundation.icon-button': renderIconButton,
  'foundation.link': renderLink,
  'foundation.text': renderText,
  'foundation.heading': renderHeading,
  'foundation.badge': renderBadge,
  'foundation.avatar': renderAvatar,
  'foundation.separator': renderSeparator,
  'foundation.surface': renderSurface,
  'foundation.stack': renderStack,
  'foundation.grid': renderGrid,
  'foundation.scroll-area': renderScrollArea,
  'foundation.split-pane': renderSplitPane,
};

/** This dispatcher accepts only the values produced by the registered foundation resolver. */
export function renderFoundationNode(node: Node, child: ChildRenderer, emit: Emit): TemplateResult | undefined {
  const renderer = FOUNDATION_RENDERERS[node.manifest.id as VarendoFoundationId];
  if (renderer === undefined) return undefined;
  return renderer({ node, id: node.node.id, values: node.config.values, child, emit });
}
