import type { Expression, VersionRef } from '../contracts/types.js';

export { versionRefKey as expressionReferenceKey } from '../contracts/stable.js';

export function collectDefinitionRefs(expression: Expression): readonly VersionRef[] {
  const refs: VersionRef[] = [];
  const stack = [expression];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'definition') refs.push(node.ref);
    if (node.kind === 'call')
      for (let index = node.arguments.length - 1; index >= 0; index -= 1) stack.push(node.arguments[index]!);
  }
  return refs;
}
