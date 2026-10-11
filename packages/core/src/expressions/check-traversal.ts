import type { Expression, Outcome, SemanticType, MeaningDefinition } from '../contracts/types.js';
import { prependOutcomePath, semanticFailure } from '../semantics/errors.js';
import { compatibleType, validateSemanticType } from '../semantics/type-utils.js';
import type { CatalogIndex } from '../semantics/types.js';
import { checkCall } from './check-call.js';
import { checkLiteral } from './check-literal.js';
import { expressionReferenceKey } from './check-reference.js';
import type { ExpressionCheckContext, PreparedExpressionContext } from './check-context.js';
import type { FunctionSignature, TypedExpression } from './types.js';

type EnterFrame = {
  readonly kind: 'enter';
  readonly node: Expression;
  readonly path: readonly (string | number)[];
  readonly depth: number;
};

type ExitFrame = {
  readonly kind: 'exit';
  readonly node: Extract<Expression, { kind: 'call' }>;
  readonly path: readonly (string | number)[];
  readonly depth: number;
};

type Frame = EnterFrame | ExitFrame;
type LeafExpression = Exclude<Expression, { kind: 'call' }>;

interface TraversalState {
  readonly stack: Frame[];
  readonly active: Set<object>;
  readonly checked: WeakMap<object, TypedExpression>;
  readonly signatures: WeakMap<object, FunctionSignature | undefined>;
  nodes: number;
  final?: TypedExpression;
}

export function checkExpressionTree(
  root: Expression,
  context: ExpressionCheckContext,
  prepared: PreparedExpressionContext,
): Outcome<TypedExpression> {
  const state = createTraversalState(root);
  while (state.stack.length > 0) {
    const frame = state.stack.pop()!;
    const budgetFailure = checkFrameBudget(frame, state, prepared);
    if (budgetFailure !== undefined) return budgetFailure;
    const outcome =
      frame.kind === 'enter' ? checkEnterFrame(frame, state, context, prepared) : checkExitFrame(frame, state, context);
    if (outcome !== undefined) {
      if (!outcome.ok) return outcome;
      state.final = outcome.value;
    }
  }
  return finalizeExpression(state.final, context.expectedType);
}

function createTraversalState(root: Expression): TraversalState {
  return {
    stack: [{ kind: 'enter', node: root, path: [], depth: 0 }],
    active: new Set(),
    checked: new WeakMap(),
    signatures: new WeakMap(),
    nodes: 0,
  };
}

function checkFrameBudget(
  frame: Frame,
  state: TraversalState,
  prepared: PreparedExpressionContext,
): Outcome<never> | undefined {
  if (frame.kind === 'enter') {
    state.nodes += 1;
    if (state.nodes > prepared.maxNodes)
      return semanticFailure('semantic.budget', 'Expression node budget exceeded.', frame.path);
  }
  if (frame.depth > prepared.maxDepth)
    return semanticFailure('semantic.budget', 'Expression depth budget exceeded.', frame.path);
  return undefined;
}

function checkEnterFrame(
  frame: EnterFrame,
  state: TraversalState,
  context: ExpressionCheckContext,
  prepared: PreparedExpressionContext,
): Outcome<TypedExpression> | undefined {
  const nodeObject = frame.node as object;
  if (state.active.has(nodeObject))
    return semanticFailure('semantic.cycle', 'Expression references itself.', frame.path);
  state.active.add(nodeObject);
  if (frame.node.kind === 'call') {
    queueCall(frame, state, context);
    return undefined;
  }
  const checked = checkLeafNode(frame.node, frame.path, context, prepared);
  state.active.delete(nodeObject);
  if (!checked.ok) return checked;
  state.checked.set(nodeObject, checked.value);
  return checked;
}

function checkLeafNode(
  node: LeafExpression,
  path: readonly (string | number)[],
  context: ExpressionCheckContext,
  prepared: PreparedExpressionContext,
): Outcome<TypedExpression> {
  switch (node.kind) {
    case 'literal':
      return checkLiteral(node, path);
    case 'field':
      return checkField(node, path, context, prepared.index);
    case 'definition':
      return checkDefinition(node, path, context, prepared.definitions);
  }
}

function checkField(
  node: Extract<Expression, { kind: 'field' }>,
  path: readonly (string | number)[],
  context: ExpressionCheckContext,
  index: CatalogIndex,
): Outcome<TypedExpression> {
  const qualifiedEntity = fieldEntity(node);
  if (hasEntityConflict(qualifiedEntity, context.entityId))
    return semanticFailure('semantic.entity-grain', 'A field expression has conflicting entity bindings.', [
      ...path,
      'entity',
    ]);
  const field = index.resolveField(qualifiedEntity ?? context.entityId, node.ref);
  if (!field.ok) return prependOutcomePath(path, field);
  return {
    ok: true,
    value: {
      expression: node,
      type: field.value.type,
      context: context.evaluationContext ?? 'row',
      entityId: field.value.entityId,
    },
  };
}

function hasEntityConflict(qualifiedEntity: string | undefined, entityId: string | undefined): boolean {
  return qualifiedEntity !== undefined && entityId !== undefined && qualifiedEntity !== entityId;
}

function checkDefinition(
  node: Extract<Expression, { kind: 'definition' }>,
  path: readonly (string | number)[],
  context: ExpressionCheckContext,
  definitions: ReadonlyMap<string, MeaningDefinition>,
): Outcome<TypedExpression> {
  const key = expressionReferenceKey(node.ref);
  const meaning = definitions.get(key);
  if (meaning === undefined)
    return semanticFailure('semantic.unknown-definition', `Meaning ${key} is not registered.`, [...path, 'ref']);
  const typeCheck = validateSemanticType(meaning.output, [...path, 'ref']);
  if (!typeCheck.ok) return typeCheck;
  return {
    ok: true,
    value: { expression: node, type: meaning.output, context: context.evaluationContext ?? 'row' },
  };
}

function queueCall(frame: EnterFrame, state: TraversalState, context: ExpressionCheckContext): void {
  const node = frame.node as Extract<Expression, { kind: 'call' }>;
  state.signatures.set(node, context.registry.resolve(node.function));
  state.stack.push({ kind: 'exit', node, path: frame.path, depth: frame.depth });
  for (let index = node.arguments.length - 1; index >= 0; index -= 1) {
    state.stack.push({
      kind: 'enter',
      node: node.arguments[index]!,
      path: [...frame.path, 'arguments', index],
      depth: frame.depth + 1,
    });
  }
}

function checkExitFrame(
  frame: ExitFrame,
  state: TraversalState,
  context: ExpressionCheckContext,
): Outcome<TypedExpression> {
  const nodeObject = frame.node as object;
  const signature = state.signatures.get(nodeObject);
  if (signature === undefined) return failUnknownFunction(frame, state);
  const argumentsOutcome = readCheckedArguments(frame, state);
  if (!argumentsOutcome.ok) {
    state.active.delete(nodeObject);
    return argumentsOutcome;
  }
  const result = checkCall(frame.node, signature, argumentsOutcome.value, frame.path, context.evaluationContext);
  state.active.delete(nodeObject);
  if (!result.ok) return result;
  state.checked.set(nodeObject, result.value);
  return result;
}

function failUnknownFunction(frame: ExitFrame, state: TraversalState): Outcome<never> {
  state.active.delete(frame.node as object);
  return semanticFailure(
    'semantic.function-version',
    `Function ${frame.node.function.id}@${frame.node.function.revision} is not registered.`,
    [...frame.path, 'function'],
  );
}

function readCheckedArguments(frame: ExitFrame, state: TraversalState): Outcome<TypedExpression[]> {
  const arguments_: TypedExpression[] = [];
  for (let index = 0; index < frame.node.arguments.length; index += 1) {
    const argument = state.checked.get(frame.node.arguments[index] as object);
    if (argument === undefined)
      return semanticFailure('semantic.expression', 'A child expression was not checked.', [
        ...frame.path,
        'arguments',
        index,
      ]);
    arguments_.push(argument);
  }
  return { ok: true, value: arguments_ };
}

function finalizeExpression(
  final: TypedExpression | undefined,
  expectedType: SemanticType | undefined,
): Outcome<TypedExpression> {
  if (final === undefined) return semanticFailure('semantic.expression', 'Expression did not produce a typed result.');
  if (expectedType !== undefined && !compatibleType(final.type, expectedType))
    return semanticFailure(
      'semantic.type-mismatch',
      'Expression output is incompatible with the expected semantic type.',
      [],
    );
  return { ok: true, value: final };
}

function fieldEntity(node: Extract<Expression, { kind: 'field' }>): string | undefined {
  const candidate = node as Extract<Expression, { kind: 'field' }> & { readonly entity?: unknown };
  return typeof candidate.entity === 'string' ? candidate.entity : undefined;
}
