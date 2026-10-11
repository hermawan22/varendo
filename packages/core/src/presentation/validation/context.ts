import { parseEnvironment, parseResult, parsePresentationPlan } from '../../contracts/parse.js';
import { validateCommitReadSet } from '../../contracts/commit.js';
import { WIRE_LIMITS } from '../../contracts/limits.js';
import { resolveExperienceContext } from '../../contracts/experience/index.js';
import type { Outcome, Result, Task } from '../../contracts/types.js';
import type { PresentationContext, PresentationRegistry } from '../types.js';
import { freezePresentation, presentationFailure as fail, versionKey } from '../registry.js';
import type { PreparedPresentationContext, PresentationValidationCache } from './types.js';
import { refKey, parseRendererCapabilities } from './shared.js';

export function preparePresentationRegistry(
  registry: PresentationRegistry,
): Outcome<ReadonlyMap<string, PresentationRegistry['manifests'][number]>> {
  if (
    !Array.isArray(registry?.manifests) ||
    registry.manifests.length === 0 ||
    registry.manifests.length > WIRE_LIMITS.presentationNodes
  )
    return fail('registry', 'The representation registry is malformed or exceeds its bound.');
  const manifests = new Map(registry.manifests.map((manifest) => [versionKey(manifest.ref), manifest]));
  if (manifests.size !== registry.manifests.length)
    return fail('registry', 'Representation references must be unique.');
  return { ok: true, value: manifests };
}

export function preparePresentationValidationCache(
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
  manifestIndex?: ReadonlyMap<string, PresentationRegistry['manifests'][number]>,
): Outcome<PresentationValidationCache> {
  const manifests =
    manifestIndex === undefined ? preparePresentationRegistry(registry) : { ok: true as const, value: manifestIndex };
  if (!manifests.ok) return manifests;

  const resultFields = new Map<Result, ReadonlySet<string>>();
  const resultsByRef = new Map<string, Result>();
  for (const result of prepared.results) {
    resultFields.set(result, new Set(result.fields.map((field) => field.id)));
    resultsByRef.set(refKey(result.ref), result);
  }

  const taskOutputs = new Map<string, Extract<Task, { kind: 'data' }>['outputs'][number]>();
  if (prepared.task.kind === 'data') {
    for (const output of prepared.task.outputs) taskOutputs.set(output.id, output);
  }

  return {
    ok: true,
    value: {
      preparedContext: prepared,
      registry,
      manifests: manifests.value,
      renderer: new Set(prepared.rendererCapabilities.map(versionKey)),
      extensions: new Set(prepared.constraints.extensionAllowlist.map(versionKey)),
      allowedRepresentations: new Set(prepared.constraints.allowedRepresentations),
      allowedOperations:
        prepared.constraints.allowedOperations === undefined
          ? undefined
          : new Set(prepared.constraints.allowedOperations.map(versionKey)),
      requiredOperations: new Set(prepared.constraints.requiredOperationIds),
      resultFields,
      resultsByRef,
      taskInputs: new Set(prepared.task.kind === 'presentation' ? prepared.task.inputs.map(refKey) : []),
      taskNeeds: new Map(prepared.constraints.taskNeeds.map((need) => [need.id, need])),
      taskOutputs,
      nodeGraphs: new Map(),
      presentationGraphs: new Map(),
      emptyGraphs: new Map(),
      coverageAnalyses: new WeakMap(),
      readSetOutcomes: new WeakMap(),
      resolvedConfigs: new WeakMap(),
      checkedConfigs: new WeakMap(),
      treeEntries: [],
    },
  };
}

function prepareAuthorizedResults(
  inputs: PresentationContext['results'],
  currentResults: readonly import('../../contracts/types.js').ResultRef[],
): Outcome<readonly Result[]> {
  if (!Array.isArray(inputs) || inputs.length > WIRE_LIMITS.outputs)
    return fail('results', 'The authorized result descriptors must be bounded.');

  const parsedResults: Result[] = [];
  const seen = new Set<string>();
  const authorized = new Set(currentResults.map(refKey));
  try {
    for (const input of inputs) {
      const parsed = parseResult(input);
      if (!parsed.ok) return parsed;
      const key = refKey(parsed.value.ref);
      if (seen.has(key)) return fail('results', 'The descriptor list repeats a result reference.');
      if (!authorized.has(key))
        return fail('results', 'A supplied result descriptor is not present in the current authorized read set.');
      seen.add(key);
      parsedResults.push(freezePresentation(parsed.value));
    }
  } catch {
    return fail('results', 'The authorized result descriptors could not be parsed.');
  }
  return { ok: true, value: freezePresentation(parsedResults) };
}

export function preparePresentationContext(context: PresentationContext): Outcome<PreparedPresentationContext> {
  const resolved = resolveExperienceContext(context.experience, context.task, context.restrictions);
  if (!resolved.ok) return resolved;
  const { constraints, taskStructure } = resolved.value;
  const environment = parseEnvironment(context.environment);
  if (!environment.ok) return environment;
  const current = validateCommitReadSet(context.current, context.current);
  if (!current.ok) return current;
  const rendererCapabilities = parseRendererCapabilities(context.rendererCapabilities);
  if (!rendererCapabilities.ok) return rendererCapabilities;
  const results = prepareAuthorizedResults(context.results, current.value.results);
  if (!results.ok) return results;

  const incumbent = prepareIncumbent(context);
  if (!incumbent.ok) return incumbent;
  const task = freezePresentation(constraints.task);
  const experience = freezePresentation(constraints.experience);
  const environmentValue = freezePresentation(environment.value);
  const currentValue = freezePresentation(current.value);
  const patternContext = freezePresentation({
    task,
    experience,
    results: results.value,
    current: currentValue,
    environment: environmentValue,
    ...(incumbent.value === undefined ? {} : { incumbent: incumbent.value }),
  });
  return {
    ok: true,
    value: freezePresentation({
      constraints: freezePresentation(constraints),
      task,
      experience,
      results: results.value,
      current: currentValue,
      environment: environmentValue,
      rendererCapabilities: rendererCapabilities.value,
      taskStructure: freezePresentation(taskStructure),
      patternContext,
    }),
  };
}

function prepareIncumbent(context: PresentationContext) {
  if (context.incumbent === undefined) return { ok: true as const, value: undefined };
  const parsed = parsePresentationPlan(context.incumbent);
  if (!parsed.ok) return parsed;
  const refs = parsed.value.nodes.flatMap((node) => (node.result === undefined ? [] : [node.result]));
  const current = validateCommitReadSet(parsed.value.preconditions, context.current, refs);
  if (!current.ok) return current;
  return { ok: true as const, value: freezePresentation(parsed.value) };
}
