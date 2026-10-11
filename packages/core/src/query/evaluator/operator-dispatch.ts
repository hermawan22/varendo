import type { Catalog, Outcome } from '../../contracts/types.js';
import { failure, type EvalRelation, type EvalState } from './shared.js';
import type { PlanNode, PlanOperation } from '../types.js';
import { evaluateFilter, evaluateProjection, evaluateScan } from './basic-operators.js';
import { evaluateJoin } from './join-operator.js';
import { evaluateAggregate, evaluateGroup } from './grouping-operators.js';
import { evaluateSort, evaluateTopK, evaluateWindowNode } from './ordered-operators.js';

interface OperatorContext {
  readonly node: PlanNode;
  readonly inputs: readonly EvalRelation[];
  readonly state: EvalState;
  readonly catalog: Catalog;
}

type Operator = (context: OperatorContext) => Outcome<EvalRelation>;

function runScan(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'scan') return failure('query.plan', 'Scan operator received the wrong node.');
  return evaluateScan(context.node, context.state, context.catalog);
}

function runFilter(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'filter') return failure('query.plan', 'Filter operator received the wrong node.');
  return evaluateFilter(context.node, context.inputs, context.state);
}

function runProjection(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'project' && context.node.op !== 'derive' && context.node.op !== 'time-bucket')
    return failure('query.plan', 'Projection operator received the wrong node.');
  return evaluateProjection(context.node, context.inputs, context.state);
}

function runJoin(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'join' && context.node.op !== 'semijoin')
    return failure('query.plan', 'Join operator received the wrong node.');
  return evaluateJoin(context.node, context.inputs, context.state, context.catalog);
}

function runGroup(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'group') return failure('query.plan', 'Group operator received the wrong node.');
  return evaluateGroup(context.node, context.inputs, context.state);
}

function runAggregate(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'aggregate') return failure('query.plan', 'Aggregate operator received the wrong node.');
  return evaluateAggregate(context.node, context.inputs, context.state);
}

function runSort(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'sort') return failure('query.plan', 'Sort operator received the wrong node.');
  return evaluateSort(context.node, context.inputs, context.state);
}

function runTopK(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'top-k') return failure('query.plan', 'Top-K operator received the wrong node.');
  return evaluateTopK(context.node, context.inputs);
}

function runWindow(context: OperatorContext): Outcome<EvalRelation> {
  if (context.node.op !== 'window') return failure('query.plan', 'Window operator received the wrong node.');
  return evaluateWindowNode(context.node, context.inputs, context.state);
}

const OPERATORS: Record<PlanOperation, Operator> = {
  scan: runScan,
  filter: runFilter,
  project: runProjection,
  derive: runProjection,
  'time-bucket': runProjection,
  window: runWindow,
  join: runJoin,
  semijoin: runJoin,
  group: runGroup,
  aggregate: runAggregate,
  sort: runSort,
  'top-k': runTopK,
};

export function executeOperator(
  node: PlanNode,
  inputs: readonly EvalRelation[],
  state: EvalState,
  catalog: Catalog,
): Outcome<EvalRelation> {
  const operation = OPERATORS[node.op];
  return operation({ node, inputs, state, catalog });
}
