import type { Diagnostic, Outcome, VersionRef } from '../contracts/types.js';
import { versionRefKey } from '../contracts/stable.js';
import type { CustomIntentDefinition, IntentCompilerRegistry } from './types.js';

const key = versionRefKey;
function validRef(ref: VersionRef): boolean {
  return (
    ref.id.includes('.') &&
    ref.id.length <= 160 &&
    ref.revision.length > 0 &&
    ref.revision.length <= 160 &&
    !/[\s\u0000-\u001f\u007f]/u.test(ref.id) &&
    !/[\s\u0000-\u001f\u007f]/u.test(ref.revision)
  );
}
function failure(code: string, message: string, path: readonly (string | number)[]): Outcome<never> {
  const item: Diagnostic = { code, message, path, retryable: false };
  return { ok: false, diagnostics: [item] };
}

export function createIntentCompilerRegistry(
  definitions: readonly CustomIntentDefinition[],
): Outcome<IntentCompilerRegistry> {
  const installed = new Map<string, CustomIntentDefinition>();
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]!;
    if (!validRef(definition.ref))
      return failure('intent.registry-ref', 'Custom intent IDs must be namespaced and versioned.', [
        'definitions',
        index,
        'ref',
      ]);
    if (definition.capabilities.some((capability) => capability.length === 0 || capability.length > 160))
      return failure('intent.registry-capability', 'Custom intent capabilities must be bounded identifiers.', [
        'definitions',
        index,
        'capabilities',
      ]);
    const refKey = key(definition.ref);
    if (installed.has(refKey))
      return failure(
        'intent.registry-duplicate',
        `Custom intent ${definition.ref.id}@${definition.ref.revision} is registered more than once.`,
        ['definitions', index, 'ref'],
      );
    installed.set(
      refKey,
      Object.freeze({
        ...definition,
        ref: Object.freeze({ ...definition.ref }),
        capabilities: Object.freeze([...definition.capabilities]),
      }),
    );
  }
  const snapshot = Object.freeze([...installed.values()]);
  return {
    ok: true,
    value: Object.freeze({
      definitions: snapshot,
      resolve(ref: VersionRef) {
        return installed.get(key(ref));
      },
    }),
  };
}
