import type { Outcome, PresentationPlan } from '@varendo/core';
import { AELIQO_FOUNDATION_REFS } from '../foundation/manifest.js';
import { AELIQO_OPERATION_REFS } from '../region/registry.js';
import { AELIQO_DATA_CONFIG_SCHEMAS, AELIQO_DATA_REFS } from '../region/data-registry.js';
import { dataColumns } from './standard-data.js';
import type { RecipeContext } from './types.js';

function sameRef(
  left: { readonly id: string; readonly revision: string },
  right: { readonly id: string; readonly revision: string },
): boolean {
  return left.id === right.id && left.revision === right.revision;
}

/** Build the bounded two-pane comparison candidate when the scope can support it. */
export function comparisonSplitPlan(context: RecipeContext): Outcome<PresentationPlan> | undefined {
  if (
    context.intent.kind !== 'compare' ||
    context.result === undefined ||
    !comparisonFits(context) ||
    context.intent.identities.length !== 2 ||
    context.task.viewPreference !== undefined
  )
    return undefined;
  const need = context.task.needs[0];
  if (need === undefined || !sameRef(need.operation, AELIQO_OPERATION_REFS.compare)) return undefined;
  const columns = dataColumns(context, false);
  if (columns.length === 0) return undefined;
  const children = context.intent.identities.map((identityValues, index) => ({
    id: `comparison.${index === 0 ? 'left' : 'right'}`,
    role: 'detail',
    representation: AELIQO_DATA_REFS.detail,
    result: context.result!.ref,
    config: {
      schema: AELIQO_DATA_CONFIG_SCHEMAS.detail,
      values: {
        fields: columns.map((column) => column.key),
        columns,
        identity: context.result!.identity,
        identityValues,
        title: `Comparison ${index + 1}`,
        showIdentity: true,
      },
    },
    children: [],
  }));
  const stateTransfer = comparisonTransfers(context.incumbent);
  if (stateTransfer === undefined) return undefined;
  return {
    ok: true,
    value: {
      id: `presentation-${context.task.id}`.slice(0, 160),
      revision: context.task.revision,
      rootId: 'comparison',
      preconditions: context.current,
      nodes: [
        {
          id: 'comparison',
          role: 'structure',
          representation: AELIQO_FOUNDATION_REFS.splitPane,
          config: {
            schema: { id: 'foundation.split-pane.config', revision: '1' },
            values: {
              bindingRevision: 'unconfigured',
              orientation: 'horizontal',
              position: 50,
              min: 20,
              max: 80,
              step: 5,
            },
          },
          children: children.map((child) => child.id),
        },
        ...children,
      ],
      links: [],
      coverage: [{ needId: need.id, nodeIds: [children[0]!.id, children[1]!.id], operations: [need.operation] }],
      stateTransfer,
      diagnostics: [],
    },
  };
}

function comparisonTransfers(incumbent: PresentationPlan | undefined): PresentationPlan['stateTransfer'] | undefined {
  if (incumbent === undefined) return [];
  const expected = new Map([
    ['comparison', { role: 'structure', ref: AELIQO_FOUNDATION_REFS.splitPane }],
    ['comparison.left', { role: 'detail', ref: AELIQO_DATA_REFS.detail }],
    ['comparison.right', { role: 'detail', ref: AELIQO_DATA_REFS.detail }],
  ]);
  if (incumbent.rootId !== 'comparison' || incumbent.nodes.length !== expected.size) return undefined;
  for (const node of incumbent.nodes) {
    const target = expected.get(node.id);
    if (target === undefined || node.role !== target.role || !sameRef(node.representation, target.ref))
      return undefined;
  }
  return incumbent.nodes.map((node) => ({
    fromNode: node.id,
    toNode: node.id,
    mapping: { id: 'aeliqo.state.identity', revision: '1' },
  }));
}

function comparisonFits(context: RecipeContext): boolean {
  const size = context.environment.inlineSize;
  return size.state === 'known' && (size.value >= 640 || context.incumbent?.rootId === 'comparison');
}
