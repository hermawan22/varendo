import type { Outcome } from '@varendo/core';
import type {
  AeliqoNavigationFeedbackAction,
  AeliqoNavigationFeedbackContent,
  AeliqoNavigationFeedbackRoute,
  AeliqoTreeBinding,
  AeliqoTreeBindingNode,
} from './navigation-feedback-types.js';
import {
  MAX_TREE_NODES,
  bounded,
  boundedArray,
  exactKeys,
  fail,
  record,
  requireAction,
  requireContent,
  requireRoute,
} from './navigation-feedback-support.js';

interface TreeNormalizationContext {
  readonly contents: Map<string, AeliqoNavigationFeedbackContent>;
  readonly routes: Map<string, AeliqoNavigationFeedbackRoute>;
  readonly actions: Map<string, AeliqoNavigationFeedbackAction>;
  readonly ids: Set<string>;
  readonly ancestors: Set<object>;
  count: number;
}

export function normalizeTrees(
  value: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
  actions: Map<string, AeliqoNavigationFeedbackAction>,
): Outcome<readonly AeliqoTreeBinding[]> {
  const source = boundedArray(value, 'trees');
  if (!source.ok) return source;
  const seen = new Set<string>();
  const result: AeliqoTreeBinding[] = [];
  for (const raw of source.value) {
    const tree = normalizeTree(raw, contents, routes, actions, seen);
    if (!tree.ok) return tree;
    seen.add(tree.value.id);
    result.push(tree.value);
  }
  return { ok: true, value: result };
}

function normalizeTree(
  raw: unknown,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  routes: Map<string, AeliqoNavigationFeedbackRoute>,
  actions: Map<string, AeliqoNavigationFeedbackAction>,
  seen: ReadonlySet<string>,
): Outcome<AeliqoTreeBinding> {
  const tree = record(raw);
  if (tree === undefined || !validTreeEntry(tree, contents, seen))
    return fail('bindings', 'Tree bindings require unique IDs, host labels and node arrays.');
  const context: TreeNormalizationContext = {
    contents,
    routes,
    actions,
    ids: new Set<string>(),
    ancestors: new Set<object>(),
    count: 0,
  };
  const nodes = normalizeTreeNodes(tree.nodes as readonly unknown[], context);
  if (!nodes.ok) return nodes;
  return { ok: true, value: { id: tree.id as string, labelRef: tree.labelRef as string, nodes: nodes.value } };
}

function validTreeEntry(
  tree: Record<string, unknown> | undefined,
  contents: Map<string, AeliqoNavigationFeedbackContent>,
  seen: ReadonlySet<string>,
): boolean {
  if (tree === undefined || !exactKeys(tree, ['id', 'labelRef', 'nodes'])) return false;
  if (!bounded(tree.id) || seen.has(tree.id) || !requireContent(contents, tree.labelRef)) return false;
  return Array.isArray(tree.nodes);
}

function normalizeTreeNodes(
  source: readonly unknown[],
  context: TreeNormalizationContext,
): Outcome<readonly AeliqoTreeBindingNode[]> {
  if (source.length > MAX_TREE_NODES) return fail('bindings', 'A tree exceeds its bounded node limit.');
  const nodes: AeliqoTreeBindingNode[] = [];
  for (const raw of source) {
    const node = normalizeTreeNode(raw, context);
    if (!node.ok) return node;
    nodes.push(node.value);
  }
  return { ok: true, value: nodes };
}

function normalizeTreeNode(raw: unknown, context: TreeNormalizationContext): Outcome<AeliqoTreeBindingNode> {
  const node = record(raw);
  if (node === undefined || !validTreeNode(node, context))
    return fail('bindings', 'Tree nodes require unique IDs and host labels.');
  context.count += 1;
  if (context.count > MAX_TREE_NODES) return fail('bindings', 'A tree exceeds its bounded node limit.');
  if (context.ancestors.has(node)) return fail('bindings', 'Tree bindings cannot contain cycles.');
  const targetError = treeTargetError(node, context);
  if (targetError !== undefined) return fail('bindings', targetError);
  if (node.children !== undefined && !Array.isArray(node.children))
    return fail('bindings', 'Tree node children must be arrays.');

  context.ids.add(node.id as string);
  context.ancestors.add(node);
  const children = normalizeTreeChildren(node.children, context);
  context.ancestors.delete(node);
  if (!children.ok) return children;
  return { ok: true, value: treeNodeValue(node, children.value) };
}

function validTreeNode(node: Record<string, unknown> | undefined, context: TreeNormalizationContext): boolean {
  if (node === undefined || !exactKeys(node, ['id', 'labelRef', 'children', 'disabled', 'actionRef', 'routeRef']))
    return false;
  if (!bounded(node.id) || context.ids.has(node.id) || !requireContent(context.contents, node.labelRef)) return false;
  return node.disabled === undefined || typeof node.disabled === 'boolean';
}

function treeTargetError(node: Record<string, unknown>, context: TreeNormalizationContext): string | undefined {
  const hasAction = node.actionRef !== undefined;
  const hasRoute = node.routeRef !== undefined;
  if (hasAction && hasRoute) return 'A tree node cannot bind both an action and a route.';
  if (hasAction && !requireAction(context.actions, node.actionRef))
    return 'Tree nodes may reference only registered actions.';
  if (hasRoute && !requireRoute(context.routes, node.routeRef))
    return 'Tree nodes may reference only registered routes.';
  return undefined;
}

function normalizeTreeChildren(
  children: unknown,
  context: TreeNormalizationContext,
): Outcome<readonly AeliqoTreeBindingNode[] | undefined> {
  if (children === undefined) return { ok: true, value: undefined };
  return normalizeTreeNodes(children as readonly unknown[], context);
}

function treeNodeValue(
  node: Record<string, unknown>,
  children: readonly AeliqoTreeBindingNode[] | undefined,
): AeliqoTreeBindingNode {
  return {
    id: node.id as string,
    labelRef: node.labelRef as string,
    ...(children === undefined ? {} : { children }),
    ...(node.disabled === undefined ? {} : { disabled: node.disabled as boolean }),
    ...(typeof node.actionRef === 'string' ? { actionRef: node.actionRef } : {}),
    ...(typeof node.routeRef === 'string' ? { routeRef: node.routeRef } : {}),
  };
}
