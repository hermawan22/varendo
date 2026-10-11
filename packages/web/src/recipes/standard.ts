import type { Diagnostic, Intent, Outcome, PresentationPlan, VersionRef } from '@varendo/core';
import type {
  PresentationClarification,
  PresentationResolverCandidate,
  PresentationValues,
} from '@varendo/core/presentation';
import { AELIQO_CONFIG_SCHEMAS, AELIQO_OPERATION_REFS, AELIQO_PRESENTATION_REFS } from '../region/registry.js';
import { AELIQO_DATA_CONFIG_SCHEMAS, AELIQO_DATA_REFS } from '../region/data-registry.js';
import { AELIQO_VISUALIZATION_CONFIG_SCHEMAS, AELIQO_VISUALIZATION_REFS } from '../region/visualization-registry.js';
import { defineRecipe } from './define.js';
import { comparisonSplitPlan } from './standard-comparison.js';
import { barConfig, dataColumns, measureField, requestedFields, temporalField } from './standard-data.js';
import { trendConfig } from './standard-trend.js';
import type { RecipeContext, RecipeDefinition, StandardRecipeIntent } from './types.js';
import { standardFormRecipe } from './standard-form.js';
import { standardStateMapping } from './standard-state.js';
import { resolverCandidateId } from './candidate-id.js';

export { standardFormRecipe } from './standard-form.js';
export { STANDARD_STATE_MAPPINGS } from './standard-state.js';

interface ViewChoice {
  readonly ref: VersionRef;
  readonly schema: VersionRef;
  readonly role: string;
  readonly operations: readonly VersionRef[];
}

const aliases: Readonly<Record<string, ViewChoice>> = Object.freeze({
  table: {
    ref: AELIQO_PRESENTATION_REFS.table,
    schema: AELIQO_CONFIG_SCHEMAS.table,
    role: 'table',
    operations: [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze],
  },
  cards: {
    ref: AELIQO_DATA_REFS.cardCollection,
    schema: AELIQO_DATA_CONFIG_SCHEMAS.cardCollection,
    role: 'cardCollection',
    operations: [AELIQO_OPERATION_REFS.read],
  },
  list: {
    ref: AELIQO_DATA_REFS.recordList,
    schema: AELIQO_DATA_CONFIG_SCHEMAS.recordList,
    role: 'recordList',
    operations: [AELIQO_OPERATION_REFS.read],
  },
  detail: {
    ref: AELIQO_DATA_REFS.detail,
    schema: AELIQO_DATA_CONFIG_SCHEMAS.detail,
    role: 'detail',
    operations: [AELIQO_OPERATION_REFS.read],
  },
  trend: {
    ref: AELIQO_PRESENTATION_REFS.trend,
    schema: AELIQO_CONFIG_SCHEMAS.trend,
    role: 'trend',
    operations: [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze],
  },
  bar: {
    ref: AELIQO_VISUALIZATION_REFS.bar,
    schema: AELIQO_VISUALIZATION_CONFIG_SCHEMAS.bar,
    role: 'visualization',
    operations: [AELIQO_OPERATION_REFS.analyze],
  },
});

function aliasedView(value: string): ViewChoice | undefined {
  return Object.hasOwn(aliases, value)
    ? aliases[value]
    : Object.values(aliases).find((candidate) => candidate.ref.id === value);
}

function failure(code: string, message: string): Outcome<never> {
  const item: Diagnostic = { code, message, retryable: false };
  return { ok: false, diagnostics: [item] };
}
function sameRef(left: VersionRef, right: VersionRef): boolean {
  return left.id === right.id && left.revision === right.revision;
}
function supportsOperation(operations: readonly VersionRef[], required: VersionRef): boolean {
  return operations.some((operation) => sameRef(operation, required));
}

function allowed(context: RecipeContext, representation: VersionRef): boolean {
  const policy = context.presentationPolicy;
  return policy === undefined || policy.allowedRepresentations.includes(representation.id);
}

function custom(
  context: RecipeContext,
  preferred: string,
):
  | {
      readonly ref: VersionRef;
      readonly schema: VersionRef;
      readonly role: string;
      readonly values: PresentationValues;
    }
  | undefined {
  if (context.result === undefined) return undefined;
  const definition = context.availableViews.find((view) => view.ref.id === preferred);
  const operation = context.task.needs[0]?.operation;
  if (
    definition === undefined ||
    operation === undefined ||
    !allowed(context, definition.ref) ||
    !supportsOperation(definition.manifest.operations, operation)
  )
    return undefined;
  const suggested = definition.manifest.suggestConfig?.(context.task.needs, context.result);
  if (suggested !== undefined && !suggested.ok) return undefined;
  return {
    ref: definition.ref,
    schema: definition.manifest.configSchema,
    role: definition.manifest.roles[0]!,
    values: suggested?.value ?? {},
  };
}

function valuesFor(view: ViewChoice, context: RecipeContext): PresentationValues | undefined {
  if (context.result === undefined) return undefined;
  if (sameRef(view.ref, aliases.table!.ref)) return { columns: dataColumns(context, false), selection: 'none' };
  if (sameRef(view.ref, aliases.bar!.ref)) {
    const config = barConfig(context);
    return config.kind === 'available' ? config.values : undefined;
  }
  const columns = dataColumns(context, true);
  if (sameRef(view.ref, aliases.detail!.ref)) return { fields: columns.map((column) => String(column.key)), columns };
  if (sameRef(view.ref, aliases.cards!.ref)) {
    const headingKey = context.result.fields.find(
      (field) =>
        context.task.needs[0]?.fields.includes(field.id) === true &&
        field.role === 'attribute' &&
        field.type.value === 'text',
    )?.id;
    return { columns, selection: 'none', ...(headingKey === undefined ? {} : { headingKey }) };
  }
  if (sameRef(view.ref, aliases.list!.ref)) return { columns, selection: 'none' };
  return {};
}
type SelectedView = {
  readonly ref: VersionRef;
  readonly schema: VersionRef;
  readonly role: string;
  readonly values: PresentationValues;
};

export interface StandardRecipeCandidates {
  readonly candidates: readonly PresentationResolverCandidate[];
  readonly clarification?: PresentationClarification;
}

function preferredView(context: RecipeContext, preferred: string): SelectedView | undefined {
  const known = aliasedView(preferred);
  const operation = context.task.needs[0]?.operation;
  if (known !== undefined && sameRef(known.ref, aliases.bar!.ref)) {
    const choice = barView(context);
    return choice?.ok === true ? choice.value : undefined;
  }
  if (
    known !== undefined &&
    operation !== undefined &&
    allowed(context, known.ref) &&
    supportsOperation(known.operations, operation) &&
    !sameRef(known.ref, aliases.trend!.ref)
  )
    return viewWithValues(known, context);
  return custom(context, preferred);
}

function viewWithValues(view: ViewChoice, context: RecipeContext): SelectedView {
  return { ...view, values: valuesFor(view, context) ?? {} };
}

function trendView(context: RecipeContext): Outcome<SelectedView> | undefined {
  const trend = aliases.trend!;
  const operation = context.task.needs[0]?.operation;
  if (operation === undefined || !allowed(context, trend.ref) || !supportsOperation(trend.operations, operation))
    return undefined;
  const config = trendConfig(context);
  if (config.kind === 'unavailable') return undefined;
  if (config.kind === 'needs-input') return { ok: false, diagnostics: [config.diagnostic] };
  return { ok: true, value: { ...trend, values: config.values } };
}

function barView(context: RecipeContext): Outcome<SelectedView> | undefined {
  const bar = aliases.bar!;
  const operation = context.task.needs[0]?.operation;
  if (operation === undefined || !allowed(context, bar.ref) || !supportsOperation(bar.operations, operation))
    return undefined;
  const config = barConfig(context);
  if (config.kind === 'unavailable') return undefined;
  return { ok: true, value: { ...bar, values: config.values } };
}

const CONTEXT_VIEWS: Readonly<
  Partial<Record<keyof typeof aliases, (context: RecipeContext) => Outcome<SelectedView> | undefined>>
> = {
  trend: trendView,
  bar: barView,
};

function knownView(context: RecipeContext, name: keyof typeof aliases): Outcome<SelectedView> | undefined {
  const view = aliases[name]!;
  const operation = context.task.needs[0]?.operation;
  if (operation === undefined || !allowed(context, view.ref) || !supportsOperation(view.operations, operation))
    return undefined;
  const build = CONTEXT_VIEWS[name];
  if (build !== undefined) return build(context);
  return { ok: true, value: viewWithValues(view, context) };
}

function firstAvailable(context: RecipeContext, names: readonly (keyof typeof aliases)[]): Outcome<SelectedView> {
  for (const name of names) {
    const candidate = knownView(context, name);
    if (candidate !== undefined) return candidate;
  }
  return failure('web.recipe.view-policy', 'No permitted registered view can present this task and result.');
}

function viewForIntent(context: RecipeContext): Outcome<SelectedView> {
  const inlineSize = context.environment.inlineSize;
  const narrow = inlineSize.state === 'known' && inlineSize.value < 640;
  switch (context.intent.kind) {
    case 'detail':
      return firstAvailable(context, ['detail', 'table', 'cards', 'list']);
    case 'compare':
      return firstAvailable(context, ['table']);
    case 'analyze':
      return firstAvailable(context, ['bar', 'trend', 'table']);
    default:
      return firstAvailable(
        context,
        narrow ? ['cards', 'table', 'list', 'trend'] : ['table', 'cards', 'list', 'trend'],
      );
  }
}

function selectedView(context: RecipeContext): Outcome<SelectedView> {
  if (context.result === undefined) throw new TypeError('A standard data recipe requires one Result descriptor.');
  const preferred = context.task.viewPreference?.representation;
  if (preferred !== undefined) {
    const known = aliasedView(preferred);
    if (known !== undefined && sameRef(known.ref, aliases.trend!.ref)) {
      const choice = trendView(context);
      if (choice !== undefined) return choice;
    } else {
      const choice = preferredView(context, preferred);
      if (choice !== undefined) return { ok: true, value: choice };
    }
  }
  return viewForIntent(context);
}

function planForView(context: RecipeContext, view: SelectedView): Outcome<PresentationPlan> {
  if (context.result === undefined)
    return failure('web.recipe.unsupported', 'Standard data recipes require a materialized data Task.');
  const need = context.task.needs[0];
  if (need === undefined) return failure('web.recipe.need', 'The Task has no presentation need.');
  const stateTransfer: Array<PresentationPlan['stateTransfer'][number]> = [];
  if (context.incumbent !== undefined) {
    for (const node of context.incumbent.nodes) {
      const mapping =
        sameRef(node.representation, view.ref) && node.role === view.role
          ? { id: 'aeliqo.state.identity', revision: '1' }
          : standardStateMapping(node.representation, view.ref)?.ref;
      if (mapping === undefined)
        return failure(
          'web.recipe.transition',
          'The current view cannot transfer its interaction state to the requested view.',
        );
      stateTransfer.push({ fromNode: node.id, toNode: 'primary', mapping });
    }
  }
  const plan: PresentationPlan = {
    id: `presentation-${context.task.id}`.slice(0, 160),
    revision: context.task.revision,
    rootId: 'primary',
    preconditions: context.current,
    nodes: [
      {
        id: 'primary',
        role: view.role,
        representation: view.ref,
        result: context.result.ref,
        config: { schema: view.schema, values: view.values },
        children: [],
      },
    ],
    links: [],
    coverage: [{ needId: need.id, nodeIds: ['primary'], operations: [need.operation] }],
    stateTransfer,
    diagnostics: [],
  };
  return { ok: true, value: plan };
}

function build(context: RecipeContext): Outcome<PresentationPlan> {
  if (context.task.kind !== 'data' || context.result === undefined)
    return failure('web.recipe.unsupported', 'Standard data recipes require a materialized data Task.');
  const split = comparisonSplitPlan(context);
  if (split !== undefined) return split;
  const view = selectedView(context);
  if (!view.ok) return view;
  return planForView(context, view.value);
}

export const standardDataRecipe: RecipeDefinition = defineRecipe({
  ref: { id: 'aeliqo.recipe.data', revision: '1' },
  intents: ['browse', 'detail', 'compare', 'analyze'],
  build,
});

function authorableNames(kind: RecipeContext['intent']['kind']): readonly (keyof typeof aliases)[] {
  switch (kind) {
    case 'detail':
      return ['detail', 'table', 'cards', 'list'];
    case 'compare':
      return ['table'];
    case 'analyze':
      return ['bar', 'trend', 'table'];
    default:
      return ['table', 'cards', 'list'];
  }
}

function unfilteredCustom(context: RecipeContext, preferred: string): SelectedView | undefined {
  if (context.result === undefined) return undefined;
  const definition = context.availableViews.find((view) => view.ref.id === preferred);
  if (definition === undefined) return undefined;
  const suggested = definition.manifest.suggestConfig?.(context.task.needs, context.result);
  if (suggested !== undefined && !suggested.ok) return undefined;
  return {
    ref: definition.ref,
    schema: definition.manifest.configSchema,
    role: definition.manifest.roles[0]!,
    values: suggested?.value ?? {},
  };
}

function clarificationChoices(context: RecipeContext, kind: 'measure' | 'time') {
  if (context.result === undefined) return [];
  const requested = requestedFields(context);
  const compatible = context.result.fields.filter((field) => {
    if (kind === 'time') return temporalField(field);
    return measureField(field);
  });
  return compatible
    .filter((field) => requested.has(field.id))
    .map((field) => ({ id: field.id, label: field.id }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function trendClarification(context: RecipeContext, diagnostic: Diagnostic): PresentationClarification {
  const kind = diagnostic.code.endsWith('.time') ? 'time' : 'measure';
  return { kind, representation: aliases.trend!.ref, diagnostic, choices: clarificationChoices(context, kind) };
}
function authorable(context: RecipeContext, name: keyof typeof aliases): boolean {
  const operation = context.task.needs[0]?.operation;
  const view = aliases[name]!;
  return operation !== undefined && allowed(context, view.ref) && supportsOperation(view.operations, operation);
}
function authorKnownView(context: RecipeContext, name: keyof typeof aliases): Outcome<SelectedView> {
  if (name === 'bar') {
    const choice = barView(context);
    return choice ?? failure('web.recipe.bar', 'No registered categorical bar view can present this task.');
  }
  if (name !== 'trend') return { ok: true, value: viewWithValues(aliases[name]!, context) };
  const config = trendConfig(context);
  if (config.kind === 'needs-input') return { ok: false, diagnostics: [config.diagnostic] };
  if (config.kind === 'unavailable')
    return failure('web.recipe.needs-input.time', 'Choose a requested time field before rendering a trend.');
  return { ok: true, value: { ...aliases.trend!, values: config.values } };
}
function resolverCandidate(
  context: RecipeContext,
  id: string,
  view: SelectedView,
): Outcome<readonly PresentationResolverCandidate[]> {
  const plan = planForView(context, view);
  if (!plan.ok)
    return plan.diagnostics.every((item) => item.code === 'web.recipe.transition') ? { ok: true, value: [] } : plan;
  return { ok: true, value: [{ id, source: 'explicit', plan: plan.value }] };
}

function appendPreferredCustom(
  context: RecipeContext,
  preferred: string | undefined,
  preferredAlias: keyof typeof aliases | undefined,
  candidates: PresentationResolverCandidate[],
): Outcome<void> {
  if (preferred === undefined || preferredAlias !== undefined) return { ok: true, value: undefined };
  const customView = unfilteredCustom(context, preferred);
  if (customView === undefined) return { ok: true, value: undefined };
  const customCandidate = resolverCandidate(context, resolverCandidateId('custom', preferred), customView);
  if (!customCandidate.ok) return customCandidate;
  candidates.push(...customCandidate.value);
  return { ok: true, value: undefined };
}

type AuthoredCandidates = {
  readonly candidates: PresentationResolverCandidate[];
  readonly clarification?: PresentationClarification;
};

function preferredAlias(preferred: string | undefined): keyof typeof aliases | undefined {
  if (preferred === undefined) return undefined;
  return Object.entries(aliases).find(([name, view]) => name === preferred || view.ref.id === preferred)?.[0] as
    keyof typeof aliases | undefined;
}

function authoredCandidates(
  context: RecipeContext,
  preferred: keyof typeof aliases | undefined,
): Outcome<AuthoredCandidates> {
  const candidates: PresentationResolverCandidate[] = [];
  const names = new Set(authorableNames(context.intent.kind));
  if (preferred !== undefined) names.add(preferred);
  let clarification: PresentationClarification | undefined;
  const eligibleNames = [...names].filter((name) => authorable(context, name)).sort();
  for (const name of eligibleNames) {
    const view = authorKnownView(context, name);
    if (!view.ok) {
      const diagnostic = view.diagnostics[0]!;
      if (name === 'trend') clarification = trendClarification(context, diagnostic);
      continue;
    }
    const authored = resolverCandidate(context, `standard.${name}`, view.value);
    if (!authored.ok) return authored;
    candidates.push(...authored.value);
  }
  return {
    ok: true,
    value: {
      candidates: chartsBeforeTable(context, preferred, candidates),
      ...(clarification === undefined ? {} : { clarification }),
    },
  };
}

/** An analysis answers with an eligible chart; the table stays the fallback unless the request names it. */
function chartsBeforeTable(
  context: RecipeContext,
  preferred: keyof typeof aliases | undefined,
  candidates: PresentationResolverCandidate[],
): PresentationResolverCandidate[] {
  const charted =
    context.intent.kind === 'analyze' &&
    preferred !== 'table' &&
    candidates.some((candidate) => candidate.id === 'standard.bar' || candidate.id === 'standard.trend');
  return charted ? candidates.filter((candidate) => candidate.id !== 'standard.table') : candidates;
}

/** Author deterministic standard candidates; core remains the sole eligibility and ranking authority. */
export function standardRecipeCandidates(context: RecipeContext): Outcome<StandardRecipeCandidates> {
  if (context.task.kind !== 'data' || context.result === undefined)
    return failure('web.recipe.unsupported', 'Standard data recipes require a materialized data Task.');
  const preferred = context.task.viewPreference?.representation;
  const preferredAliasValue = preferredAlias(preferred);
  const authored = authoredCandidates(context, preferredAliasValue);
  if (!authored.ok) return authored;
  const candidates = authored.value.candidates;
  let clarification = authored.value.clarification;
  const split = comparisonSplitPlan(context);
  if (split?.ok === true) candidates.push({ id: 'standard.comparison', source: 'explicit', plan: split.value });
  const custom = appendPreferredCustom(context, preferred, preferredAliasValue, candidates);
  if (!custom.ok) return custom;
  if (clarification !== undefined && candidates.some((candidate) => candidate.id === 'standard.bar'))
    clarification = undefined;
  return {
    ok: true,
    value: {
      candidates: candidates.sort((left, right) => left.id.localeCompare(right.id)),
      ...(clarification === undefined ? {} : { clarification }),
    },
  };
}

export const STANDARD_RECIPES: readonly RecipeDefinition[] = Object.freeze([standardDataRecipe, standardFormRecipe]);

export const STANDARD_VIEW_REFS = Object.freeze({
  table: AELIQO_PRESENTATION_REFS.table,
  cards: AELIQO_DATA_REFS.cardCollection,
  list: AELIQO_DATA_REFS.recordList,
  detail: AELIQO_DATA_REFS.detail,
  trend: AELIQO_PRESENTATION_REFS.trend,
  bar: AELIQO_VISUALIZATION_REFS.bar,
});

/** Resolve a resource-facing standard alias to the canonical renderer representation ID. */
export function canonicalViewId(view: string): string {
  const alias = Object.hasOwn(aliases, view) ? aliases[view] : undefined;
  return (alias ?? Object.values(aliases).find((candidate) => candidate.ref.id === view))?.ref.id ?? view;
}

export function recipeSupports(recipe: RecipeDefinition, kind: StandardRecipeIntent): boolean;
export function recipeSupports(recipe: RecipeDefinition, intent: Intent): boolean;
export function recipeSupports(recipe: RecipeDefinition, input: StandardRecipeIntent | Intent): boolean {
  if (typeof input === 'string') return recipe.intents.some((intent) => intent === input);
  if (input.kind === 'custom')
    return recipe.intents.some(
      (registered) =>
        typeof registered !== 'string' &&
        registered.id === input.intent.id &&
        registered.revision === input.intent.revision,
    );
  return recipe.intents.some((registered) => registered === input.kind);
}

const INTENT_OPERATIONS: Readonly<Partial<Record<RecipeContext['intent']['kind'], VersionRef>>> = {
  compare: AELIQO_OPERATION_REFS.compare,
  analyze: AELIQO_OPERATION_REFS.analyze,
};

export function standardOperationFor(kind: RecipeContext['intent']['kind']): VersionRef {
  return INTENT_OPERATIONS[kind] ?? AELIQO_OPERATION_REFS.read;
}
