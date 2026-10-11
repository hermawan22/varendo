import type { InteractionPayload } from '@varendo/core';
import type { ValidatedPresentation, PresentationValues } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { AeliqoFoundationId } from '../foundation/manifest.js';
import type { AeliqoActionEvent, AeliqoLinkEvent } from '../foundation/events.js';

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
  return (event: AeliqoActionEvent): void => {
    event.preventDefault();
    context.emit(context.node, 'action', {
      kind: 'action-request',
      action: context.values.action as Extract<InteractionPayload, { kind: 'action-request' }>['action'],
      input: context.values.actionInput as Extract<InteractionPayload, { kind: 'action-request' }>['input'],
    });
  };
}

function navigationListener(context: FoundationRenderContext) {
  return (event: AeliqoLinkEvent): void => {
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
  return html`<aeliqo-button
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .label=${text(context.values.text)}
    .variant=${context.values.variant ?? 'solid'}
    .size=${context.values.size ?? 'medium'}
    type="button"
    @aeliqo-action=${actionListener(context)}
  ></aeliqo-button>`;
}

function renderIconButton(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-icon-button
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .label=${text(context.values.text)}
    .size=${context.values.size ?? 'medium'}
    type="button"
    @aeliqo-action=${actionListener(context)}
    ><span slot="icon" aria-hidden="true">⋯</span></aeliqo-icon-button
  >`;
}

function renderLink(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-link
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .label=${text(context.values.text)}
    .href=${text(context.values.href)}
    .target=${context.values.target ?? '_self'}
    @aeliqo-link=${navigationListener(context)}
  ></aeliqo-link>`;
}

function renderText(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-text
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .text=${text(context.values.text)}
    .as=${context.values.as ?? 'span'}
    .muted=${bool(context.values.muted)}
  ></aeliqo-text>`;
}

function renderHeading(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-heading
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .text=${text(context.values.text)}
    .level=${context.values.level ?? 2}
    .size=${context.values.size ?? 'heading'}
  ></aeliqo-heading>`;
}

function renderBadge(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-badge
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .text=${text(context.values.text)}
    .tone=${context.values.tone ?? 'neutral'}
  ></aeliqo-badge>`;
}

function renderAvatar(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-avatar
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .name=${text(context.values.name)}
    .src=${text(context.values.src)}
    .alt=${text(context.values.alt)}
    .size=${context.values.size ?? 'medium'}
    .decorative=${bool(context.values.decorative)}
  ></aeliqo-avatar>`;
}

function renderSeparator(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-separator
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .orientation=${context.values.orientation ?? 'horizontal'}
    .decorative=${context.values.decorative ?? true}
  ></aeliqo-separator>`;
}

function renderSurface(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-surface
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .as=${context.values.as ?? 'div'}
    .tone=${context.values.tone ?? 'surface'}
    .label=${text(context.values.label)}
    >${renderChildren(context)}</aeliqo-surface
  >`;
}

function renderStack(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-stack
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .direction=${context.values.direction ?? 'column'}
    .gap=${context.values.gap ?? 16}
    .align=${context.values.align ?? 'stretch'}
    .justify=${context.values.justify ?? 'start'}
    .wrap=${bool(context.values.wrap)}
    >${renderChildren(context)}</aeliqo-stack
  >`;
}

function renderGrid(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-grid
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .columns=${context.values.columns ?? 2}
    .gap=${context.values.gap ?? 16}
    .minItem=${context.values.minItem ?? 'medium'}
    >${renderChildren(context)}</aeliqo-grid
  >`;
}

function renderScrollArea(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-scroll-area
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .axis=${context.values.axis ?? 'y'}
    .label=${text(context.values.label)}
    >${renderChildren(context)}</aeliqo-scroll-area
  >`;
}

function splitPaneChild(context: FoundationRenderContext, index: number, slot: string) {
  const id = context.node.node.children[index];
  const content = id === undefined ? nothing : context.child(id);
  return html`<div slot=${slot}>${content}</div>`;
}

function renderSplitPane(context: FoundationRenderContext): TemplateResult {
  return html`<aeliqo-split-pane
    data-aeliqo-node-id=${context.id}
    data-aeliqo-theme="inherit"
    .orientation=${context.values.orientation ?? 'horizontal'}
    .defaultPosition=${context.values.position ?? 50}
    .min=${context.values.min ?? 20}
    .max=${context.values.max ?? 80}
    .step=${context.values.step ?? 5}
    >${splitPaneChild(context, 0, 'start')}${splitPaneChild(context, 1, 'end')}</aeliqo-split-pane
  >`;
}

const FOUNDATION_RENDERERS: Partial<Record<AeliqoFoundationId, FoundationRenderer>> = {
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
  const renderer = FOUNDATION_RENDERERS[node.manifest.id as AeliqoFoundationId];
  if (renderer === undefined) return undefined;
  return renderer({ node, id: node.node.id, values: node.config.values, child, emit });
}
