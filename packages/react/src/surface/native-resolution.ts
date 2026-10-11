import type { VersionRef } from '@varendo/core';
import { resolvePresentation, type PresentationResolverInput } from '@varendo/core/presentation';
import type { SurfaceController, SurfaceSnapshot } from '@varendo/runtime/surfaces';
import type { ReactViewDefinition, ReactViewRegistry } from './types.js';

export function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function matchesCommittedTarget<I, S>(
  surface: SurfaceController<I, S>,
  snapshot: SurfaceSnapshot<I, S>,
  input: PresentationResolverInput,
): boolean {
  const publicAddress = snapshot.address;
  const target = input.target.address;
  if (target.runtimeId !== publicAddress.runtimeId || target.scopeInstanceId !== publicAddress.scopeInstanceId)
    return false;
  if (
    target.activationEpoch !== publicAddress.activationEpoch ||
    target.surfaceGeneration !== publicAddress.surfaceGeneration
  )
    return false;
  if (target.surfaceId !== input.context.task.regionId) return false;
  if (surface.presentationEvidence === undefined) return true;
  const committed = surface.presentationEvidence();
  return (
    committed !== undefined &&
    committed.target.address.surfaceId === target.surfaceId &&
    committed.task.id === input.context.task.id &&
    committed.task.revision === input.context.task.revision
  );
}

export function resolvedView<I, S>(
  surface: SurfaceController<I, S>,
  snapshot: SurfaceSnapshot<I, S>,
  views: ReactViewRegistry<I, S>,
  input: PresentationResolverInput,
  preference?: VersionRef,
  size?: { readonly inline: number; readonly block: number },
): ReactViewDefinition<I, S> | undefined {
  if (!matchesCommittedTarget(surface, snapshot, input)) return undefined;
  const rendererCapabilities = input.context.rendererCapabilities.filter((ref) => views.resolve(ref) !== undefined);
  const task =
    preference === undefined
      ? input.context.task
      : { ...input.context.task, viewPreference: { representation: preference.id, strength: 'explicit' as const } };
  const decision = resolvePresentation({
    ...input,
    context: {
      ...input.context,
      task,
      rendererCapabilities,
      environment:
        size === undefined
          ? input.context.environment
          : {
              ...input.context.environment,
              inlineSize: { state: 'known', value: size.inline },
              blockSize: { state: 'known', value: size.block },
            },
    },
    target:
      snapshot.phase === 'disposed' || snapshot.phase === 'denied'
        ? { ...input.target, state: 'revoked' }
        : input.target,
  });
  if (decision.status !== 'ready') return undefined;
  const root = decision.plan.plan.nodes.find((node) => node.id === decision.plan.plan.rootId);
  if (root === undefined || (preference !== undefined && !sameRef(root.representation, preference))) return undefined;
  return views.resolve(root.representation);
}
