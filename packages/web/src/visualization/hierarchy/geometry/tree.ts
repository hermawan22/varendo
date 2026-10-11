import type { Outcome } from '@varendo/core';
import type { VisualizationInputs } from '../../types.js';
import { checkedHierarchyNodes, treeLayout, treemapLayout } from './nodes.js';
import type { CheckedNode, TreemapLayoutResult } from './nodes.js';
import { prepareHierarchy } from './shared.js';
import type { PreparedHierarchyInput } from './shared.js';
import type { HierarchyGeometry, HierarchyGeometryOptions, HierarchyNodeGeometry } from './types.js';

const TREE_DENSITY_REASON =
  'The hierarchy exceeds the configured mark budget or readable graphic density. Exact values remain available in the data table.';
const TREEMAP_DENSITY_REASON =
  'The treemap exceeds the configured mark budget or readable graphic density. Exact values remain available in the data table.';

function hierarchyResult(
  kind: 'tree' | 'treemap',
  state: 'geometry' | 'data-only',
  prepared: PreparedHierarchyInput,
  nodes: readonly HierarchyNodeGeometry[],
  maxDepth: number,
  reason?: string,
): HierarchyGeometry {
  return Object.freeze({
    kind,
    state,
    ...(reason === undefined ? {} : { reason }),
    bound: prepared.prepared.bound,
    result: prepared.prepared.result,
    rows: prepared.prepared.rows,
    nodes,
    width: prepared.dimensions.width,
    height: prepared.dimensions.height,
    maxDepth,
    ...(kind === 'treemap' ? { leafValuePolicy: 'leaf-only' as const } : {}),
  });
}

function dataOnlyHierarchy(
  kind: 'tree' | 'treemap',
  prepared: PreparedHierarchyInput,
  maxDepth: number,
  reason: string,
): Outcome<HierarchyGeometry> {
  return {
    ok: true,
    value: hierarchyResult(kind, 'data-only', prepared, Object.freeze([]), maxDepth, reason),
  };
}

function readableTree(
  nodes: readonly HierarchyNodeGeometry[],
  maximum: number,
  width: number,
  height: number,
): boolean {
  if (nodes.length > maximum) return false;
  return nodes.every(
    (node) => node.width >= 24 && node.height >= 24 && node.x + node.width <= width && node.y + node.height <= height,
  );
}

function readableTreemap(layout: TreemapLayoutResult, maximum: number): boolean {
  if (layout.state === 'data-only' || layout.nodes.length > maximum) return false;
  return layout.nodes.every((node) => node.width <= 0 || node.height <= 0 || (node.width >= 24 && node.height >= 24));
}

function treeNodes(prepared: PreparedHierarchyInput): Outcome<{
  readonly checked: Map<string, CheckedNode>;
  readonly roots: readonly string[];
  readonly maxDepth: number;
}> {
  const checked = checkedHierarchyNodes(prepared.prepared, 'tree', prepared.dimensions.maxDepth);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: {
      checked: checked.value.nodes,
      roots: checked.value.roots,
      maxDepth: checked.value.maxDepth,
    },
  };
}

export function compileTreeGeometry(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions = {},
): Outcome<HierarchyGeometry> {
  const prepared = prepareHierarchy(inputs, 'tree', options);
  if (!prepared.ok) return prepared;
  const checked = treeNodes(prepared.value);
  if (!checked.ok) return checked;
  const nodes = treeLayout(checked.value.checked, prepared.value.dimensions.width, prepared.value.dimensions.height);
  if (
    !readableTree(
      nodes,
      prepared.value.dimensions.maxMarks,
      prepared.value.dimensions.width,
      prepared.value.dimensions.height,
    )
  )
    return dataOnlyHierarchy('tree', prepared.value, checked.value.maxDepth, TREE_DENSITY_REASON);
  return {
    ok: true,
    value: hierarchyResult('tree', 'geometry', prepared.value, nodes, checked.value.maxDepth),
  };
}

function treemapNodes(prepared: PreparedHierarchyInput): Outcome<{
  readonly checked: Map<string, CheckedNode>;
  readonly roots: readonly string[];
  readonly maxDepth: number;
}> {
  const checked = checkedHierarchyNodes(prepared.prepared, 'treemap', prepared.dimensions.maxDepth);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: {
      checked: checked.value.nodes,
      roots: checked.value.roots,
      maxDepth: checked.value.maxDepth,
    },
  };
}

export function compileTreemapGeometry(
  inputs: VisualizationInputs,
  options: HierarchyGeometryOptions = {},
): Outcome<HierarchyGeometry> {
  const prepared = prepareHierarchy(inputs, 'treemap', options);
  if (!prepared.ok) return prepared;
  const checked = treemapNodes(prepared.value);
  if (!checked.ok) return checked;
  const layout = treemapLayout(
    checked.value.checked,
    checked.value.roots,
    prepared.value.dimensions.width,
    prepared.value.dimensions.height,
  );
  const maximum = prepared.value.dimensions.maxMarks;
  if (!readableTreemap(layout, maximum)) {
    return dataOnlyHierarchy(
      'treemap',
      prepared.value,
      checked.value.maxDepth,
      layout.reason ?? TREEMAP_DENSITY_REASON,
    );
  }
  return {
    ok: true,
    value: hierarchyResult('treemap', 'geometry', prepared.value, layout.nodes, checked.value.maxDepth),
  };
}
