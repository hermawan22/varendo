import * as z from 'zod/mini';
import { idSchema, versionRefSchema } from '../schemas.js';
import { parseExperience } from '../parse.js';
import { inspectWire } from '../ingress.js';
import { WIRE_LIMITS } from '../limits.js';
import type { Diagnostic, Experience, Outcome, Task, VersionRef, Wire } from '../types.js';
import { compareText, versionRefKey } from '../stable.js';
import { validateTaskStructure } from '../task/index.js';
import type { TaskStructure } from '../task/index.js';

const ids = z.array(idSchema).check(z.maxLength(WIRE_LIMITS.array));
const refs = z.array(versionRefSchema).check(z.maxLength(WIRE_LIMITS.array));
const positive = z.int().check(z.minimum(1));
/** Host-supplied restrictions intersect; labels do not establish authority or grants. */
const restrictionSchema = z.strictObject({
  id: idSchema,
  allowedRepresentations: z.optional(ids),
  allowedPatterns: z.optional(ids),
  allowedOperations: z.optional(refs),
  extensionAllowlist: z.optional(refs),
  mode: z.optional(z.enum(['fixed', 'adaptive', 'composable'])),
  agentAllowed: z.optional(z.boolean()),
  allowWithoutPreset: z.optional(z.boolean()),
  maxNodes: z.optional(positive),
  maxExpansions: z.optional(positive),
  transitionPolicy: z.optional(z.enum(['stable', 'explicit-only'])),
});
const restrictionsSchema = z.array(restrictionSchema).check(z.maxLength(16));
export type ExperienceRestriction = Wire<z.infer<typeof restrictionSchema>>;
export type ExperienceConstraints = {
  readonly experience: Experience;
  readonly task: Task;
  readonly mode: Experience['mode'];
  readonly agentAllowed: boolean;
  readonly allowedRepresentations: readonly string[];
  readonly allowedPatterns: readonly string[];
  readonly extensionAllowlist: readonly VersionRef[];
  /** Undefined means this pass supplies no operation allowlist, never a grant. */
  readonly allowedOperations: readonly VersionRef[] | undefined;
  readonly requiredOperationIds: readonly string[];
  readonly taskNeeds: Task['needs'];
  readonly unavailableOptionalNeeds: readonly string[];
  readonly allowWithoutPreset: boolean;
  readonly maxNodes: number;
  readonly maxExpansions: number;
  readonly representationReplacementAllowed: boolean;
  readonly compositionChangeAllowed: boolean;
  readonly transitionPolicy: Experience['transitionPolicy'];
  readonly preferredRepresentation: string | undefined;
  readonly appliedRestrictions: readonly string[];
};
/** Chapter06 initial search ceiling. Exhaustion is not a proof of impossibility. */
export const PRESENTATION_EXPANSION_LIMIT = 64;
const refKey = versionRefKey;
const modes = ['fixed', 'adaptive', 'composable'] as const;
function intersect<T>(current: readonly T[], limit: readonly T[], key: (value: T) => string): T[] {
  const permitted = new Set(limit.map(key));
  return current.filter((value) => permitted.has(key(value)));
}
function distinctRefs(values: readonly VersionRef[]): VersionRef[] {
  return [...new Map(values.map((value) => [refKey(value), value])).entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, value]) => value);
}

interface MutableConstraints {
  representations: string[];
  patterns: string[];
  extensions: VersionRef[];
  operations: readonly VersionRef[] | undefined;
  mode: number;
  agentAllowed: boolean;
  allowWithoutPreset: boolean;
  maxNodes: number;
  maxExpansions: number;
  transitionPolicy: Experience['transitionPolicy'];
  readonly applied: Set<string>;
}

function initialConstraints(experience: Experience): MutableConstraints {
  return {
    representations: [...new Set(experience.allowedRepresentations)],
    patterns: [...new Set(experience.allowedPatterns)],
    extensions: [...experience.extensionAllowlist],
    operations: undefined,
    mode: modes.indexOf(experience.mode),
    agentAllowed: experience.agentAllowed,
    allowWithoutPreset: experience.composition.allowWithoutPreset,
    maxNodes: Math.min(experience.composition.maxNodes, WIRE_LIMITS.presentationNodes),
    maxExpansions: Math.min(experience.composition.maxExpansions, PRESENTATION_EXPANSION_LIMIT),
    transitionPolicy: experience.transitionPolicy,
    applied: new Set<string>(),
  };
}

function appendDiagnostic(
  diagnostics: Diagnostic[],
  code: string,
  message: string,
  path: readonly (string | number)[],
): void {
  if (diagnostics.length >= WIRE_LIMITS.diagnostics) return;
  diagnostics.push({ code, message, path, retryable: false });
}

function applyCollectionRestrictions(state: MutableConstraints, restriction: ExperienceRestriction): void {
  if (restriction.allowedRepresentations !== undefined)
    state.representations = intersect(state.representations, restriction.allowedRepresentations, (value) => value);
  if (restriction.allowedPatterns !== undefined)
    state.patterns = intersect(state.patterns, restriction.allowedPatterns, (value) => value);
  if (restriction.extensionAllowlist !== undefined)
    state.extensions = intersect(state.extensions, restriction.extensionAllowlist, refKey);
  if (restriction.allowedOperations !== undefined)
    state.operations = intersectOperations(state.operations, restriction.allowedOperations);
}

function intersectOperations(
  current: readonly VersionRef[] | undefined,
  restriction: readonly VersionRef[],
): readonly VersionRef[] {
  return current === undefined ? restriction : intersect(current, restriction, refKey);
}

function applyPolicyRestrictions(state: MutableConstraints, restriction: ExperienceRestriction): void {
  if (restriction.mode !== undefined) state.mode = Math.min(state.mode, modes.indexOf(restriction.mode));
  if (restriction.agentAllowed === false) state.agentAllowed = false;
  if (restriction.allowWithoutPreset === false) state.allowWithoutPreset = false;
  if (restriction.maxNodes !== undefined) state.maxNodes = Math.min(state.maxNodes, restriction.maxNodes);
  if (restriction.maxExpansions !== undefined)
    state.maxExpansions = Math.min(state.maxExpansions, restriction.maxExpansions);
  if (restriction.transitionPolicy === 'explicit-only') state.transitionPolicy = 'explicit-only';
}

function applyRestrictions(
  restrictions: readonly ExperienceRestriction[],
  state: MutableConstraints,
  diagnostics: Diagnostic[],
): void {
  for (let index = 0; index < restrictions.length; index += 1) {
    const restriction = restrictions[index]!;
    if (state.applied.has(restriction.id))
      appendDiagnostic(diagnostics, 'experience.restriction-duplicate', 'Restriction IDs must be unique.', [
        'restrictions',
        index,
        'id',
      ]);
    state.applied.add(restriction.id);
    applyCollectionRestrictions(state, restriction);
    applyPolicyRestrictions(state, restriction);
  }
}

function restrictExplicitRepresentation(task: Task, state: MutableConstraints): void {
  const preference = task.viewPreference;
  if (preference?.strength !== 'explicit') return;
  state.representations = state.representations.filter((id) => id === preference.representation);
}

function validateRepresentations(state: MutableConstraints, diagnostics: Diagnostic[]): void {
  if (state.representations.length > 0) return;
  appendDiagnostic(
    diagnostics,
    'experience.representation-conflict',
    'No representation satisfies the profile and explicit restrictions.',
    ['allowedRepresentations'],
  );
}

function validateRequiredOperationIds(
  experience: Experience,
  permittedIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  for (let index = 0; index < experience.requiredOperations.length; index += 1) {
    if (permittedIds.has(experience.requiredOperations[index]!)) continue;
    appendDiagnostic(
      diagnostics,
      'experience.operation-conflict',
      'A required profile operation is excluded by the restrictions.',
      ['requiredOperations', index],
    );
  }
}

function validateTaskNeed(
  need: Task['needs'][number],
  index: number,
  permitted: ReadonlySet<string>,
  unavailable: string[],
  diagnostics: Diagnostic[],
): void {
  if (permitted.has(refKey(need.operation))) return;
  if (!need.required) {
    unavailable.push(need.id);
    return;
  }
  appendDiagnostic(
    diagnostics,
    'experience.operation-conflict',
    'A required task operation or its revision is excluded by the restrictions.',
    ['task', 'needs', index, 'operation'],
  );
}

function validateOperationRestrictions(
  experience: Experience,
  task: Task,
  state: MutableConstraints,
  unavailable: string[],
  diagnostics: Diagnostic[],
): void {
  if (state.operations === undefined) return;
  const permitted = new Set(state.operations.map(refKey));
  const permittedIds = new Set(state.operations.map((operation) => operation.id));
  validateRequiredOperationIds(experience, permittedIds, diagnostics);
  for (let index = 0; index < task.needs.length; index += 1)
    validateTaskNeed(task.needs[index]!, index, permitted, unavailable, diagnostics);
}

function resolvedValue(
  experience: Experience,
  task: Task,
  state: MutableConstraints,
  unavailableOptionalNeeds: readonly string[],
): ExperienceConstraints {
  return {
    experience,
    task,
    mode: modes[state.mode]!,
    agentAllowed: state.agentAllowed,
    allowedRepresentations: state.representations.sort(),
    allowedPatterns: state.patterns.sort(),
    extensionAllowlist: distinctRefs(state.extensions),
    allowedOperations: state.operations === undefined ? undefined : distinctRefs(state.operations),
    requiredOperationIds: [...new Set(experience.requiredOperations)].sort(),
    taskNeeds: task.needs,
    unavailableOptionalNeeds,
    allowWithoutPreset: state.allowWithoutPreset,
    maxNodes: state.maxNodes,
    maxExpansions: state.maxExpansions,
    representationReplacementAllowed: state.mode > 0,
    compositionChangeAllowed: state.mode > 1,
    transitionPolicy: state.transitionPolicy,
    preferredRepresentation:
      task.viewPreference?.strength === 'preferred' ? task.viewPreference.representation : undefined,
    appliedRestrictions: [...state.applied].sort(),
  };
}

/**
 * Intersect hard restrictions without scoring preferences or removing required operations.
 * This does not prove renderer capability, accessible layout, authorized effects or transition safety.
 * The caller supplies authenticated policy independently and validates the eventual candidate.
 */
export function resolveExperienceConstraints(
  experienceInput: unknown,
  taskInput: unknown,
  restrictionInput: readonly ExperienceRestriction[] = [],
): Outcome<ExperienceConstraints> {
  const resolved = resolveExperienceContext(experienceInput, taskInput, restrictionInput);
  return resolved.ok ? { ok: true, value: resolved.value.constraints } : resolved;
}

/** Package-internal preparation: retain the owned task analysis for presentation validation. */
export function resolveExperienceContext(
  experienceInput: unknown,
  taskInput: unknown,
  restrictionInput: readonly ExperienceRestriction[] = [],
): Outcome<{ readonly constraints: ExperienceConstraints; readonly taskStructure: TaskStructure }> {
  const parsed = parseExperience(experienceInput);
  if (!parsed.ok) return parsed;
  const taskResult = validateTaskStructure(taskInput);
  if (!taskResult.ok) return taskResult;
  const inspected = inspectWire(restrictionInput);
  if (!inspected.ok) return inspected;
  const restrictions = z.safeParse(restrictionsSchema, inspected.value);
  if (!restrictions.success)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'experience.restriction-shape',
          message: 'Restrictions must use the declared bounded fields and values.',
          path: ['restrictions'],
          retryable: false,
        },
      ],
    };
  const experience = parsed.value;
  const task = taskResult.value.task;
  const diagnostics: Diagnostic[] = [];
  const state = initialConstraints(experience);
  applyRestrictions(restrictions.data as readonly ExperienceRestriction[], state, diagnostics);
  restrictExplicitRepresentation(task, state);
  validateRepresentations(state, diagnostics);
  const unavailableOptionalNeeds: string[] = [];
  validateOperationRestrictions(experience, task, state, unavailableOptionalNeeds, diagnostics);
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics as [Diagnostic, ...Diagnostic[]] };
  return {
    ok: true,
    value: {
      constraints: resolvedValue(experience, task, state, unavailableOptionalNeeds),
      taskStructure: taskResult.value,
    },
  };
}
