import { resolvePresentation } from '@varendo/core/presentation';
import type { Diagnostic, Intent, InteractionState, Result, Task } from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationClarification,
  PresentationRegistry,
  PresentationResolverCandidate,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import type { RuntimeCommittedReceipt } from '@varendo/runtime/app';
import { canonicalViewId, recipeSupports, standardDataRecipe, standardRecipeCandidates } from '../recipes/standard.js';
import type { RecipeDefinition, RecipePresentationPolicy } from '../recipes/types.js';
import type { AeliqoRegionResult } from '../region/types.js';
import type { AeliqoInputBindings } from '../region/input-registry.js';
import {
  diagnostic,
  environmentFor,
  experience,
  registryFor,
  presentationPolicy,
  withoutDataRevision,
  type WebAppContext,
  type WebRegion,
} from './context.js';
import type { AeliqoViewDefinition } from '../region/types.js';
import { projectInteractionState } from '@varendo/runtime/presentation';
import type { RenderContinuity } from './render-continuity.js';
import { projectAppInteraction } from './interaction-projection.js';
import { resolverCandidateId } from '../recipes/candidate-id.js';

interface PreparedDependencies {
  readonly current: NonNullable<RuntimeCommittedReceipt['region']['readSet']>;
  readonly result?: Result;
  readonly results: readonly Result[];
  readonly registry: PresentationRegistry;
  readonly recipe?: RecipeDefinition;
  readonly environment: PresentationEnvironment;
  readonly policy?: RecipePresentationPolicy;
  readonly incumbent?: ValidatedPresentation['plan'];
  readonly transitionBlocked: boolean;
}

export interface PreparedPresentation {
  readonly presentation: ValidatedPresentation;
  readonly environment: PresentationEnvironment;
  readonly interaction: InteractionState | undefined;
}

type Preparation = { readonly ok: true; readonly value: PreparedPresentation } | PreparationFailure;
type PreparationFailure = {
  readonly ok: false;
  readonly status: 'unsupported' | 'failed' | 'needs-input';
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
};
type DependencyResult = { readonly ok: true; readonly value: PreparedDependencies } | PreparationFailure;
type PolicyResult = { readonly ok: true; readonly value?: RecipePresentationPolicy } | PreparationFailure;

function preparationFailure(status: PreparationFailure['status'], item: Diagnostic): PreparationFailure {
  return { ok: false, status, diagnostics: [item] };
}

function currentReadSet(
  receipt: RuntimeCommittedReceipt,
  descriptors: readonly Result[],
): { readonly current: PreparedDependencies['current']; readonly result?: Result } | undefined {
  const current = receipt.region.readSet;
  const result = descriptors[0];
  if (current === undefined || (receipt.task.kind === 'data' && result === undefined)) return undefined;
  return { current, ...(result === undefined ? {} : { result }) };
}

function selectedRecipe(context: WebAppContext, intent: Intent): RecipeDefinition | undefined {
  return context.recipes.find((candidate) => recipeSupports(candidate, intent));
}

function policyForTask(context: WebAppContext, region: WebRegion, task: Task): PolicyResult {
  if (task.kind !== 'data') return { ok: true };
  const resource = context.resources.get(region.resourceId);
  if (resource === undefined)
    return preparationFailure(
      'failed',
      diagnostic('web.app.resource', 'The mounted resource is unavailable for presentation policy.'),
    );
  return { ok: true, value: presentationPolicy(resource) };
}

function supportsPresentation(recipe: RecipeDefinition | undefined, registry: PresentationRegistry): boolean {
  return recipe !== undefined || (registry.patterns?.length ?? 0) > 0;
}

function preparedDependencies(
  context: WebAppContext,
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  resultBindings: readonly AeliqoRegionResult[],
  descriptors: readonly Result[],
  inputs: AeliqoInputBindings | undefined,
  replacingTask: boolean,
  continuity: RenderContinuity | undefined,
): DependencyResult {
  const source = currentReadSet(receipt, descriptors);
  if (source === undefined)
    return preparationFailure(
      'failed',
      diagnostic('web.app.result', 'The committed data Task has no materialized primary Result.'),
    );
  const registry = registryFor(resultBindings, descriptors, context.views, region.resourceId, inputs, context);
  if (registry === undefined)
    return preparationFailure(
      'failed',
      diagnostic('web.app.registry', 'The presentation registry could not be created.'),
    );
  const recipe = selectedRecipe(context, receipt.intent);
  if (!supportsPresentation(recipe, registry))
    return preparationFailure(
      'unsupported',
      diagnostic('web.app.recipe', 'No recipe supports ' + receipt.intent.kind + '.'),
    );
  const environment = environmentFor(region);
  const resolvedPolicy = policyForTask(context, region, receipt.task);
  if (!resolvedPolicy.ok) return resolvedPolicy;
  const policy = resolvedPolicy.value;
  const incumbent = incumbentFor(region, source.current, replacingTask, continuity);
  return {
    ok: true,
    value: {
      current: source.current,
      transitionBlocked: standardResizeBlocked(region, recipe, registry, environment, replacingTask),
      ...(source.result === undefined ? {} : { result: source.result }),
      results: Object.freeze([...descriptors]),
      registry,
      ...(recipe === undefined ? {} : { recipe }),
      environment,
      ...(policy === undefined ? {} : { policy }),
      ...(incumbent === undefined ? {} : { incumbent }),
    },
  };
}

function sameRecipe(left: RecipeDefinition, right: RecipeDefinition): boolean {
  return left.ref.id === right.ref.id && left.ref.revision === right.ref.revision && left.build === right.build;
}

function recipeContext(
  receipt: RuntimeCommittedReceipt,
  inputs: AeliqoInputBindings | undefined,
  views: readonly AeliqoViewDefinition[],
  prepared: PreparedDependencies,
): Parameters<RecipeDefinition['build']>[0] {
  const current = withoutDataRevision(prepared.current);
  return {
    intent: receipt.intent,
    task: receipt.task,
    results: prepared.results,
    ...(prepared.result === undefined ? {} : { result: prepared.result }),
    ...(inputs === undefined ? {} : { inputBindings: inputs }),
    current,
    environment: prepared.environment,
    availableViews: views,
    ...(prepared.policy === undefined ? {} : { presentationPolicy: prepared.policy }),
    ...(prepared.incumbent === undefined ? {} : { incumbent: prepared.incumbent }),
  };
}

function authoredCandidates(
  recipe: RecipeDefinition | undefined,
  context: Parameters<RecipeDefinition['build']>[0],
):
  | {
      readonly ok: true;
      readonly candidates: readonly PresentationResolverCandidate[];
      readonly clarification?: PresentationClarification;
    }
  | PreparationFailure {
  if (recipe === undefined) return { ok: true, candidates: [] };
  if (sameRecipe(recipe, standardDataRecipe)) {
    const authored = standardRecipeCandidates(context);
    if (!authored.ok) return { ok: false, status: 'unsupported', diagnostics: authored.diagnostics };
    return { ok: true, ...authored.value };
  }
  const plan = recipe.build(context);
  if (!plan.ok) {
    const status = plan.diagnostics.some((item) => item.code.startsWith('web.recipe.needs-input.'))
      ? 'needs-input'
      : 'unsupported';
    return { ok: false, status, diagnostics: plan.diagnostics };
  }
  return {
    ok: true,
    candidates: [
      {
        id: resolverCandidateId('recipe', `${recipe.ref.id}.${recipe.ref.revision}`),
        source: 'explicit',
        plan: plan.value,
      },
    ],
  };
}

function resolverTask(task: Task): Task {
  const preference = task.viewPreference;
  if (preference === undefined) return task;
  const representation = canonicalViewId(preference.representation);
  return representation === preference.representation
    ? task
    : { ...task, viewPreference: { ...preference, representation } };
}

function resolvedPlan(
  receipt: RuntimeCommittedReceipt,
  descriptors: readonly Result[],
  inputs: AeliqoInputBindings | undefined,
  views: readonly AeliqoViewDefinition[],
  prepared: PreparedDependencies,
  requestId: string,
  surfaceGeneration: number,
): { readonly ok: true; readonly value: ValidatedPresentation } | PreparationFailure {
  const current = withoutDataRevision(prepared.current);
  const authored = authoredCandidates(prepared.recipe, recipeContext(receipt, inputs, views, prepared));
  if (!authored.ok) return authored;
  const decision = resolvePresentation({
    id: requestId,
    revision: receipt.task.revision,
    preconditions: { ...current, results: descriptors.map((result) => result.ref) },
    context: {
      task: resolverTask(receipt.task),
      experience: experience(
        prepared.registry,
        prepared.current.experienceRevision,
        prepared.policy,
        prepared.recipe === undefined,
      ),
      results: descriptors,
      current,
      environment: prepared.environment,
      transitionBlocked: prepared.transitionBlocked,
      rendererCapabilities: prepared.registry.manifests.map((manifest) => manifest.ref),
      stateMappingCapabilities: prepared.registry.stateMappings?.map((mapping) => mapping.ref) ?? [],
      ...(prepared.incumbent === undefined ? {} : { incumbent: prepared.incumbent }),
    },
    registry: prepared.registry,
    target: {
      address: {
        runtimeId: 'aeliqo.web.runtime',
        scopeInstanceId: `region.${receipt.regionId}`,
        activationEpoch: 1,
        surfaceId: receipt.regionId,
        surfaceGeneration,
      },
      state: 'active',
    },
    candidates: authored.candidates,
    ...(authored.clarification === undefined ? {} : { clarification: authored.clarification }),
  });
  if (decision.status === 'ready') return { ok: true, value: decision.plan };
  return {
    ok: false,
    status: decision.status,
    diagnostics: [decision.diagnostic],
  };
}

export function preparePresentation(
  context: WebAppContext,
  region: WebRegion,
  receipt: RuntimeCommittedReceipt,
  resultBindings: readonly AeliqoRegionResult[],
  descriptors: readonly Result[],
  requestId: string,
  surfaceGeneration: number,
  inputs?: AeliqoInputBindings,
  replacingTask = false,
  continuity?: RenderContinuity,
): Preparation {
  const dependencies = preparedDependencies(
    context,
    region,
    receipt,
    resultBindings,
    descriptors,
    inputs,
    replacingTask,
    continuity,
  );
  if (!dependencies.ok) return dependencies;
  const validated = resolvedPlan(
    receipt,
    descriptors,
    inputs,
    context.views,
    dependencies.value,
    requestId,
    surfaceGeneration,
  );
  if (!validated.ok) return validated;
  const projection = projectPreparedState(region, validated.value, replacingTask, continuity);
  if (!projection.ok) return { ok: false, status: 'unsupported', diagnostics: projection.diagnostics };
  return {
    ok: true,
    value: {
      presentation: validated.value,
      environment: dependencies.value.environment,
      interaction: projection.value,
    },
  };
}

function projectPreparedState(
  region: WebRegion,
  next: ValidatedPresentation,
  replacingTask: boolean,
  continuity?: RenderContinuity,
) {
  if (continuity?.kind === 'retain')
    return projectInteractionState(region.element.presentation, next, continuity.interaction);
  if (replacingTask) return { ok: true as const, value: undefined };
  return projectAppInteraction(region, next);
}

function incumbentFor(
  region: WebRegion,
  current: PreparedDependencies['current'],
  replacingTask: boolean,
  continuity: RenderContinuity | undefined,
) {
  if (continuity?.kind === 'retain') return continuity.incumbent;
  const prior = region.element.presentation?.plan;
  return !replacingTask && prior?.preconditions.taskRevision === current.taskRevision ? prior : undefined;
}

/** Standard views keep the established breakpoint band; registered layouts see every measured size. */
function standardResizeBlocked(
  region: WebRegion,
  recipe: RecipeDefinition | undefined,
  registry: PresentationRegistry,
  environment: PresentationEnvironment,
  replacingTask: boolean,
): boolean {
  if (replacingTask || recipe === undefined || !sameRecipe(recipe, standardDataRecipe)) return false;
  if ((registry.patterns?.length ?? 0) > 0 || environment.inlineSize.state !== 'known') return false;
  const measuredCategory = environment.inlineSize.value < 640 ? 'narrow' : 'wide';
  return region.category !== 'unknown' && measuredCategory !== region.category;
}
