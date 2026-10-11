import {
  createPresentationRegistry,
  validatePresentationPlan,
  type PresentationContext,
  type PresentationManifest,
  type PresentationRegistry,
  type ValidatedPresentation,
} from '@varendo/core/presentation';
import type { Diagnostic, Outcome, ResultRef, VersionRef } from '@varendo/core';

/** Agent proposals and manual authoring use the same canonical registry. */
export type AgentRegisteredViewManifest = PresentationManifest;
export type AgentCompositionRegistry = PresentationRegistry;
export interface ValidatedAgentComposition extends ValidatedPresentation {
  readonly views: readonly VersionRef[];
  readonly resultReferences: readonly ResultRef[];
}

export const createAgentCompositionRegistry = createPresentationRegistry;

/** Pure feasibility only. The host supplies authorized context; this does not
 * evaluate data, grant permissions, or commit a visible presentation. */
export function validateAgentComposition(
  input: unknown,
  registry: PresentationRegistry,
  context: PresentationContext,
): Outcome<ValidatedAgentComposition> {
  if (context === undefined || context === null)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'agent.composition.context',
          message: 'A current host presentation context is required.',
          retryable: false,
        },
      ],
    };
  const checked = validatePresentationPlan(input, context, registry);
  if (!checked.ok) return checked;
  const refs = new Map<string, ResultRef>();
  for (const node of checked.value.nodes) {
    const ref = node.result?.ref;
    if (ref !== undefined)
      refs.set(JSON.stringify([ref.id, ref.revision, ref.outputId, ref.queryDigest, ref.scopeDigest]), ref);
  }
  return {
    ok: true,
    value: Object.freeze({
      ...checked.value,
      views: Object.freeze(checked.value.nodes.map((node) => node.manifest)),
      resultReferences: Object.freeze([...refs.values()]),
    }),
  };
}
export type AgentCompositionDiagnostic = Diagnostic;
