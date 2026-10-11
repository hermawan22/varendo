import type { MeaningDefinition, Outcome } from '../contracts/types.js';
import { prependOutcomePath, semanticFailure } from './errors.js';
import { versionKey } from './catalog.js';
import { stableJson } from '../contracts/stable.js';

export interface MeaningClosureRoot {
  readonly meaning: MeaningDefinition;
  readonly path: readonly (string | number)[];
}

interface PathNode {
  readonly parent: PathNode | undefined;
  readonly segment: string | number;
}

interface ClosureFrame {
  meaning: MeaningDefinition;
  readonly path: PathNode | undefined;
  nextDependency: number;
  entered: boolean;
}

type ClosureContext = { readonly registry: { readonly digest: string } };

interface ClosureState<Context extends ClosureContext> {
  readonly available: Map<string, MeaningDefinition>;
  readonly visiting: Set<string>;
  readonly visited: Set<string>;
  readonly stack: ClosureFrame[];
  readonly context: Context;
}

type ValidateClosureMeaning<Context> = (
  meaning: MeaningDefinition,
  context: Context,
  definitions: ReadonlyMap<string, MeaningDefinition>,
) => Outcome<MeaningDefinition>;
type ClosureFailure = Outcome<never> | undefined;

function pathFromArray(path: readonly (string | number)[]): PathNode | undefined {
  let result: PathNode | undefined;
  for (const segment of path) result = { parent: result, segment };
  return result;
}

function appendPath(path: PathNode | undefined, ...segments: readonly (string | number)[]): PathNode | undefined {
  let result = path;
  for (const segment of segments) result = { parent: result, segment };
  return result;
}

function materializePath(path: PathNode | undefined): readonly (string | number)[] {
  const result: (string | number)[] = [];
  for (let current = path; current !== undefined; current = current.parent) result.push(current.segment);
  result.reverse();
  return result;
}

function pushFrame(stack: ClosureFrame[], meaning: MeaningDefinition, path: PathNode | undefined): void {
  stack.push({ meaning, path, nextDependency: 0, entered: false });
}

function enterFrame<Context extends ClosureContext>(
  frame: ClosureFrame,
  state: ClosureState<Context>,
  validate: ValidateClosureMeaning<Context>,
): Outcome<boolean> {
  const identity = versionKey(frame.meaning);
  if (state.visited.has(identity)) {
    state.stack.pop();
    return { ok: true, value: false };
  }
  if (state.visiting.has(identity))
    return semanticFailure(
      'semantic.cycle',
      `Meaning dependency cycle includes ${identity}.`,
      materializePath(frame.path),
    );
  state.visiting.add(identity);
  const checked = validate(frame.meaning, state.context, state.available);
  if (!checked.ok) return prependOutcomePath(materializePath(frame.path), checked);
  frame.meaning = checked.value;
  frame.entered = true;
  return { ok: true, value: true };
}

function completeFrame(frame: ClosureFrame, stack: ClosureFrame[], visiting: Set<string>, visited: Set<string>): void {
  const identity = versionKey(frame.meaning);
  visiting.delete(identity);
  visited.add(identity);
  stack.pop();
}

function advanceFrame<Context extends ClosureContext>(
  frame: ClosureFrame,
  state: ClosureState<Context>,
): ClosureFailure {
  if (frame.nextDependency >= frame.meaning.dependencies.length) {
    completeFrame(frame, state.stack, state.visiting, state.visited);
    return undefined;
  }
  const dependencyIndex = frame.nextDependency++;
  const dependency = frame.meaning.dependencies[dependencyIndex]!;
  const identity = versionKey(dependency);
  const child = state.available.get(identity);
  const path = appendPath(frame.path, 'dependencies', dependencyIndex);
  if (child === undefined)
    return semanticFailure(
      'semantic.unknown-dependency',
      `Meaning dependency ${identity} is not available.`,
      materializePath(path),
    );
  if (child.functionRegistryDigest !== state.context.registry.digest)
    return semanticFailure(
      'semantic.stale-registry',
      `Meaning dependency ${child.id}@${child.revision} pins a different function registry digest.`,
      materializePath(path),
    );
  if (state.visiting.has(identity))
    return semanticFailure('semantic.cycle', `Meaning dependency cycle includes ${identity}.`, materializePath(path));
  if (!state.visited.has(identity)) pushFrame(state.stack, child, path);
  return undefined;
}

function walkRoot<Context extends ClosureContext>(
  root: MeaningClosureRoot,
  state: ClosureState<Context>,
  validate: ValidateClosureMeaning<Context>,
): ClosureFailure {
  pushFrame(state.stack, root.meaning, pathFromArray(root.path));
  while (state.stack.length > 0) {
    const frame = state.stack[state.stack.length - 1]!;
    if (!frame.entered) {
      const entered = enterFrame(frame, state, validate);
      if (!entered.ok) return entered;
      if (!entered.value) continue;
    }
    const advanced = advanceFrame(frame, state);
    if (advanced !== undefined) return advanced;
  }
  return undefined;
}

function registerRoots(
  roots: readonly MeaningClosureRoot[],
  available: Map<string, MeaningDefinition>,
): ClosureFailure {
  for (const root of roots) {
    const identity = versionKey(root.meaning);
    const prior = available.get(identity);
    if (prior === undefined) available.set(identity, root.meaning);
    else if (stableJson(prior) !== stableJson(root.meaning))
      return semanticFailure(
        'semantic.definition-conflict',
        `Meaning ${identity} conflicts with an existing definition.`,
        root.path,
      );
  }
  return undefined;
}

/** Validate the reachable definition graph without recursive calls or stack growth. */
export function validateMeaningDependencyClosure<Context extends ClosureContext>(
  roots: readonly MeaningClosureRoot[],
  seed: ReadonlyMap<string, MeaningDefinition>,
  context: Context,
  validate: ValidateClosureMeaning<Context>,
): Outcome<void> {
  const available = new Map(seed);
  const registered = registerRoots(roots, available);
  if (registered !== undefined) return registered;
  const state: ClosureState<Context> = {
    available,
    visiting: new Set(),
    visited: new Set(),
    stack: [],
    context,
  };
  for (const root of roots) {
    if (state.visited.has(versionKey(root.meaning))) continue;
    const result = walkRoot(root, state, validate);
    if (result !== undefined) return result;
  }
  return { ok: true, value: undefined };
}
