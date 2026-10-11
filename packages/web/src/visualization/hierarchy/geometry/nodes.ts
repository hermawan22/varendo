import type { Outcome, Scalar, SemanticType } from '@varendo/core';
import type { HierarchyNodeGeometry } from './types.js';
import { compareIdentity, fail, keyFor, labelFor } from './shared.js';
import type { PreparedHierarchy } from './shared.js';
import type { VisualizationRow } from '../../types.js';

export interface CheckedNode {
  readonly identity: string;
  readonly parentIdentity?: string;
  readonly label: string;
  readonly row: VisualizationRow;
  readonly weight?: ExactWeight;
  children: string[];
  depth: number;
}

interface ExactWeight {
  readonly coefficient: bigint;
  readonly scale: number;
}

const ZERO_WEIGHT: ExactWeight = Object.freeze({ coefficient: 0n, scale: 0 });

function normalizeWeight(coefficient: bigint, scale: number): ExactWeight {
  if (coefficient === 0n) return ZERO_WEIGHT;
  let normalized = coefficient;
  let normalizedScale = scale;
  while (normalized % 10n === 0n) {
    normalized /= 10n;
    normalizedScale -= 1;
  }
  return Object.freeze({ coefficient: normalized, scale: normalizedScale });
}

function decimalWeight(text: string): ExactWeight | undefined {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/u.exec(text);
  if (match === null) return undefined;
  const digits = (match[2] ?? '') + (match[3] ?? '');
  const coefficient = BigInt(digits);
  if (match[1] === '-' && coefficient !== 0n) return undefined;
  return normalizeWeight(coefficient, match[3]?.length ?? 0);
}

function numberWeight(value: number): ExactWeight | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const match = /^([+]?[0-9]+)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/iu.exec(String(value));
  if (match === null) return undefined;
  const coefficient = BigInt((match[1] ?? '') + (match[2] ?? ''));
  const exponent = Number(match[3] ?? '0');
  if (!Number.isSafeInteger(exponent)) return undefined;
  return normalizeWeight(coefficient, (match[2]?.length ?? 0) - exponent);
}

function addWeights(left: ExactWeight, right: ExactWeight): ExactWeight {
  if (left.coefficient === 0n) return right;
  if (right.coefficient === 0n) return left;
  const scale = Math.max(left.scale, right.scale);
  const leftCoefficient = left.coefficient * 10n ** BigInt(scale - left.scale);
  const rightCoefficient = right.coefficient * 10n ** BigInt(scale - right.scale);
  return normalizeWeight(leftCoefficient + rightCoefficient, scale);
}

function leadingNumber(coefficient: bigint): { readonly mantissa: number; readonly exponent: number } {
  const digits = coefficient.toString();
  const significant = digits.slice(0, 16);
  return { mantissa: Number(significant) / 10 ** (significant.length - 1), exponent: digits.length - 1 };
}

function weightAsNumber(weight: ExactWeight): number | undefined {
  if (weight.coefficient === 0n) return 0;
  const leading = leadingNumber(weight.coefficient);
  const value = Number(String(leading.mantissa) + 'e' + String(leading.exponent - weight.scale));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function ratioAsNumber(weight: ExactWeight, total: ExactWeight): number | undefined {
  if (weight.coefficient === 0n) return 0;
  if (total.coefficient === 0n) return undefined;
  const numerator = leadingNumber(weight.coefficient);
  const denominator = leadingNumber(total.coefficient);
  const exponent = numerator.exponent - weight.scale - denominator.exponent + total.scale;
  const ratio = Number(String(numerator.mantissa / denominator.mantissa) + 'e' + String(exponent));
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  if (ratio > 1) return ratio <= 1 + Number.EPSILON * 8 ? 1 : undefined;
  return ratio;
}

type ValueField = { readonly id: string; readonly type: SemanticType };

function valueFieldFor(prepared: PreparedHierarchy, view: 'tree' | 'treemap'): Outcome<ValueField | undefined> {
  const spec = prepared.bound.spec;
  if (spec.view !== view) return fail('view', 'The bound view changed during materialization.');
  if (spec.view === 'tree') return { ok: true, value: undefined };
  const field = prepared.result.fields.find((candidate) => candidate.id === spec.value);
  if (field === undefined) return fail('field', 'The treemap value field is unavailable.');
  return { ok: true, value: field };
}

function readWeight(value: Scalar | undefined): Outcome<ExactWeight> {
  if (value === null) return fail('treemap-value', 'Treemap values must be non-null and nonnegative.');
  if (value === undefined) return fail('treemap-value', 'Treemap values must be numeric.');
  let weight: ExactWeight | undefined;
  if (typeof value === 'object') weight = decimalWeight(value.decimal);
  else if (typeof value === 'number') weight = numberWeight(value);
  else return fail('treemap-value', 'Treemap values must be numeric.');
  if (weight === undefined) return fail('treemap-value', 'Treemap values must be finite and nonnegative.');
  return { ok: true, value: weight };
}

function checkedRow(
  prepared: PreparedHierarchy,
  row: VisualizationRow,
  valueField: ValueField | undefined,
): Outcome<CheckedNode> {
  const identity = keyFor(row.values, prepared.nodeFields, false);
  if (!identity.ok) return identity;
  if (identity.value === undefined) return fail('identity', 'A node identity is unavailable.');
  const parent = keyFor(row.values, prepared.parentFields, true);
  if (!parent.ok) return parent;
  let weight: ExactWeight | undefined;
  if (valueField !== undefined) {
    const checkedWeight = readWeight(row.values[valueField.id]);
    if (!checkedWeight.ok) return checkedWeight;
    weight = checkedWeight.value;
  }
  return {
    ok: true,
    value: {
      identity: identity.value,
      ...(parent.value === undefined ? {} : { parentIdentity: parent.value }),
      label: labelFor(row.values, prepared.labelField, identity.value),
      row,
      ...(weight === undefined ? {} : { weight }),
      children: [],
      depth: 0,
    },
  };
}

function createNodes(
  prepared: PreparedHierarchy,
  valueField: ValueField | undefined,
): Outcome<Map<string, CheckedNode>> {
  const nodes = new Map<string, CheckedNode>();
  for (const row of prepared.rows) {
    const checked = checkedRow(prepared, row, valueField);
    if (!checked.ok) return checked;
    if (nodes.has(checked.value.identity)) return fail('duplicate-node', 'Hierarchy node keys must be unique.');
    nodes.set(checked.value.identity, checked.value);
  }
  return { ok: true, value: nodes };
}

function linkNodes(nodes: Map<string, CheckedNode>): Outcome<string[]> {
  const roots: string[] = [];
  for (const node of nodes.values()) {
    if (node.parentIdentity === undefined) {
      roots.push(node.identity);
      continue;
    }
    const parent = nodes.get(node.parentIdentity);
    if (parent === undefined)
      return fail('missing-parent', 'Every non-root hierarchy node must reference a supplied parent.');
    parent.children.push(node.identity);
  }
  roots.sort();
  for (const node of nodes.values()) node.children.sort();
  return { ok: true, value: roots };
}

function visitNode(
  identity: string,
  depth: number,
  maxDepth: number,
  nodes: Map<string, CheckedNode>,
  visiting: Set<string>,
  finished: Set<string>,
): Outcome<true> {
  const node = nodes.get(identity);
  if (node === undefined) return fail('identity', 'A hierarchy node reference is unavailable.');
  if (visiting.has(identity)) return fail('cycle', 'Hierarchy parent keys contain a cycle.');
  if (finished.has(identity)) return { ok: true, value: true };
  if (depth > maxDepth) return fail('depth', 'Hierarchy depth exceeds the ' + maxDepth + ' level bound.');
  visiting.add(identity);
  node.depth = depth;
  for (const child of node.children) {
    const checked = visitNode(child, depth + 1, maxDepth, nodes, visiting, finished);
    if (!checked.ok) return checked;
  }
  visiting.delete(identity);
  finished.add(identity);
  return { ok: true, value: true };
}

function checkedDepths(nodes: Map<string, CheckedNode>, roots: readonly string[], maxDepth: number): Outcome<number> {
  const visiting = new Set<string>();
  const finished = new Set<string>();
  for (const root of roots) {
    const checked = visitNode(root, 0, maxDepth, nodes, visiting, finished);
    if (!checked.ok) return checked;
  }
  if (finished.size !== nodes.size)
    return fail('cycle', 'Hierarchy parent keys contain a cycle or disconnected component.');
  let deepest = 0;
  for (const node of nodes.values()) deepest = Math.max(deepest, node.depth);
  return { ok: true, value: deepest };
}

export function checkedHierarchyNodes(
  prepared: PreparedHierarchy,
  view: 'tree' | 'treemap',
  maxDepth: number,
): Outcome<{ nodes: Map<string, CheckedNode>; roots: string[]; maxDepth: number }> {
  const valueField = valueFieldFor(prepared, view);
  if (!valueField.ok) return valueField;
  const nodes = createNodes(prepared, valueField.value);
  if (!nodes.ok) return nodes;
  const roots = linkNodes(nodes.value);
  if (!roots.ok) return roots;
  const depth = checkedDepths(nodes.value, roots.value, maxDepth);
  if (!depth.ok) return depth;
  return { ok: true, value: { nodes: nodes.value, roots: roots.value, maxDepth: depth.value } };
}

function nodeOrder(left: CheckedNode, right: CheckedNode): number {
  return left.depth - right.depth || compareIdentity(left.identity, right.identity);
}

function toHierarchyGeometry(
  node: CheckedNode,
  x: number,
  y: number,
  width: number,
  height: number,
): HierarchyNodeGeometry {
  return {
    identity: node.identity,
    rowIdentity: node.row.identity,
    label: node.label,
    ...(node.parentIdentity === undefined ? {} : { parentIdentity: node.parentIdentity }),
    depth: node.depth,
    children: Object.freeze([...node.children]),
    x,
    y,
    width,
    height,
    leaf: node.children.length === 0,
  };
}

export function treeLayout(
  nodes: Map<string, CheckedNode>,
  width: number,
  height: number,
): readonly HierarchyNodeGeometry[] {
  const padding = 16;
  const levels = groupByDepth(nodes);
  const maximumLevel = Math.max(0, ...levels.keys());
  const levelHeight = Math.max(1, Math.min(64, (height - padding * 2) / Math.max(1, maximumLevel + 1)));
  const output: HierarchyNodeGeometry[] = [];
  for (const [depth, list] of levels) {
    const gap = 2;
    const cellWidth = Math.max(
      1,
      (width - padding * 2 - gap * Math.max(0, list.length - 1)) / Math.max(1, list.length),
    );
    list.forEach((node, index) => {
      output.push(
        toHierarchyGeometry(
          node,
          padding + index * (cellWidth + gap),
          padding + depth * levelHeight,
          cellWidth,
          Math.max(1, levelHeight - 2),
        ),
      );
    });
  }
  return Object.freeze(output);
}

function groupByDepth(nodes: Map<string, CheckedNode>): Map<number, CheckedNode[]> {
  const levels = new Map<number, CheckedNode[]>();
  for (const node of [...nodes.values()].sort(nodeOrder)) {
    const list = levels.get(node.depth) ?? [];
    list.push(node);
    levels.set(node.depth, list);
  }
  return levels;
}

export interface TreemapLayoutResult {
  readonly state: 'geometry' | 'data-only';
  readonly reason?: string;
  readonly nodes: readonly HierarchyNodeGeometry[];
}

interface TreemapBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TreemapContext {
  readonly nodes: Map<string, CheckedNode>;
  readonly subtreeWeights: Map<string, ExactWeight>;
  readonly boxes: Map<string, TreemapBox>;
  unsafeRatio: boolean;
}

function subtreeWeight(
  identity: string,
  nodes: Map<string, CheckedNode>,
  cache: Map<string, ExactWeight>,
): ExactWeight {
  const cached = cache.get(identity);
  if (cached !== undefined) return cached;
  const node = nodes.get(identity)!;
  let total = node.children.length === 0 ? (node.weight ?? ZERO_WEIGHT) : ZERO_WEIGHT;
  for (const child of node.children) total = addWeights(total, subtreeWeight(child, nodes, cache));
  cache.set(identity, total);
  return total;
}

function computeSubtreeWeights(nodes: Map<string, CheckedNode>, roots: readonly string[]): Map<string, ExactWeight> {
  const weights = new Map<string, ExactWeight>();
  for (const root of roots) subtreeWeight(root, nodes, weights);
  return weights;
}

function numericNodeValues(nodes: Map<string, CheckedNode>): Map<string, number> | undefined {
  const values = new Map<string, number>();
  for (const node of nodes.values()) {
    const value = weightAsNumber(node.weight ?? ZERO_WEIGHT);
    if (value === undefined) return undefined;
    values.set(node.identity, value);
  }
  return values;
}

function siblingRatios(children: readonly string[], context: TreemapContext): readonly number[] | undefined {
  const total = children.reduce(
    (sum, child) => addWeights(sum, context.subtreeWeights.get(child) ?? ZERO_WEIGHT),
    ZERO_WEIGHT,
  );
  const rawRatios = children.map((child) => ratioAsNumber(context.subtreeWeights.get(child) ?? ZERO_WEIGHT, total));
  if (rawRatios.some((ratio) => ratio === undefined)) return undefined;
  const ratios = rawRatios.map((ratio) => ratio ?? 0);
  const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (!Number.isFinite(ratioTotal) || (ratioTotal === 0 && total.coefficient !== 0n)) return undefined;
  if (ratioTotal === 0) return ratios;
  return ratios.map((ratio) => ratio / ratioTotal);
}

function lastPositiveIndex(ratios: readonly number[]): number {
  let index = -1;
  for (let current = 0; current < ratios.length; current += 1) {
    if (ratios[current] !== 0) index = current;
  }
  return index;
}

function childExtent(
  ratio: number,
  index: number,
  lastPositive: number,
  extentLimit: number,
  cursor: number,
): number | undefined {
  if (ratio === 0) return 0;
  const extent = index === lastPositive ? extentLimit - cursor : extentLimit * ratio;
  if (!Number.isFinite(extent) || extent <= 0) return undefined;
  return extent;
}

function placeChild(identity: string, context: TreemapContext, box: TreemapBox, depth: number): void {
  context.boxes.set(identity, box);
  const node = context.nodes.get(identity);
  if (node === undefined) {
    context.unsafeRatio = true;
    return;
  }
  if (node.children.length > 0) {
    placeChildren(node.children, box.x, box.y, box.width, box.height, depth + 1, context);
  }
}

function placeChildren(
  children: readonly string[],
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
  context: TreemapContext,
): void {
  if (context.unsafeRatio || children.length === 0) return;
  const ratios = siblingRatios(children, context);
  if (ratios === undefined) {
    context.unsafeRatio = true;
    return;
  }
  const lastPositive = lastPositiveIndex(ratios);
  const horizontal = depth % 2 === 0;
  const extentLimit = horizontal ? width : height;
  let cursor = 0;
  for (let index = 0; index < children.length; index += 1) {
    const identity = children[index]!;
    const extent = childExtent(ratios[index]!, index, lastPositive, extentLimit, cursor);
    if (extent === undefined) {
      context.unsafeRatio = true;
      return;
    }
    const childWidth = horizontal ? extent : width;
    const childHeight = horizontal ? height : extent;
    const childX = horizontal ? x + cursor : x;
    const childY = horizontal ? y : y + cursor;
    placeChild(
      identity,
      context,
      {
        x: childX,
        y: childY,
        width: Math.max(0, childWidth),
        height: Math.max(0, childHeight),
      },
      depth,
    );
    cursor += extent;
  }
}

function dataOnly(reason: string): TreemapLayoutResult {
  return { state: 'data-only', reason, nodes: Object.freeze([]) };
}

function geometryFromBoxes(
  nodes: Map<string, CheckedNode>,
  boxes: Map<string, TreemapBox>,
  numericValues: Map<string, number>,
): readonly HierarchyNodeGeometry[] | undefined {
  const output: HierarchyNodeGeometry[] = [];
  for (const node of [...nodes.values()].sort(nodeOrder)) {
    const box = boxes.get(node.identity);
    if (box === undefined) return undefined;
    output.push({
      ...toHierarchyGeometry(node, box.x, box.y, box.width, box.height),
      value: numericValues.get(node.identity) ?? 0,
    });
  }
  return Object.freeze(output);
}

export function treemapLayout(
  nodes: Map<string, CheckedNode>,
  roots: readonly string[],
  width: number,
  height: number,
): TreemapLayoutResult {
  const subtreeWeights = computeSubtreeWeights(nodes, roots);
  const numericValues = numericNodeValues(nodes);
  if (numericValues === undefined)
    return dataOnly(
      'A treemap value is outside the safe floating-point geometry range. Exact values remain available in the data table.',
    );
  const context: TreemapContext = { nodes, subtreeWeights, boxes: new Map(), unsafeRatio: false };
  placeChildren(roots, 0, 0, width, height, 0, context);
  if (context.unsafeRatio)
    return dataOnly(
      'A positive treemap weight cannot be represented safely in bounded geometry. Exact values remain available in the data table.',
    );
  const geometry = geometryFromBoxes(nodes, context.boxes, numericValues);
  if (geometry === undefined)
    return dataOnly(
      'Treemap geometry could not cover every authorized node. Exact values remain available in the data table.',
    );
  return { state: 'geometry', nodes: geometry };
}
