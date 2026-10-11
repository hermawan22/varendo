import {
  parseWireValue,
  type InteractionState,
  type Outcome,
  type Result,
  type ResultRef,
  type VersionRef,
} from '@varendo/core';
import type {
  PresentationEnvironment,
  PresentationManifest,
  PresentationQuality,
  PresentationValues,
  ResolvedPresentationConfig,
  ValidatedPresentation,
} from '@varendo/core/presentation';
import { nothing, type TemplateResult } from 'lit';
import {
  AELIQO_DATA_CONFIG_SCHEMAS,
  AELIQO_DATA_REFS,
  createAeliqoDataRegistry,
  validateAeliqoDataBinding,
  type AeliqoDataBinding,
  type AeliqoDataComponentId,
  type AeliqoDataRegistryOptions,
  type AeliqoDataResolvedNode,
  type AeliqoValidatedBinding,
} from './data-registry.js';
import { renderAeliqoDataNode, type AeliqoDataHostRequestHandler } from './data-renderer.js';
import { canonicalValue as canonical, freezeValue as freeze, resultRefKey as refKey } from './registry-value.js';

/** The operation identities shared by the existing canonical region registry. */
export const AELIQO_DATA_PRESENTATION_OPERATIONS = Object.freeze({
  read: { id: 'data.read', revision: '1' },
  selection: { id: 'interaction.selection', revision: '1' },
  filter: { id: 'data.filter', revision: '1' },
  compare: { id: 'data.compare', revision: '1' },
} satisfies Record<'read' | 'selection' | 'filter' | 'compare', VersionRef>);

/**
 * Materialized data authorized by the application for one exact ResultRef.
 * The result descriptor is the key; rows are retained only in this host-side
 * binding and are never copied into a presentation plan.
 */
export type AeliqoAuthorizedDataBindings =
  readonly AeliqoDataBinding[] | ReadonlyMap<string, AeliqoDataBinding> | Readonly<Record<string, AeliqoDataBinding>>;

export interface AeliqoDataPresentationRegistry {
  readonly manifests: readonly PresentationManifest[];
  /** Resolve the current authorized snapshot for an exact ResultRef. */
  readonly bindingFor: (ref: ResultRef) => Outcome<AeliqoValidatedBinding>;
  /** Rebuild a helper node from the current host materialization. */
  readonly render: (
    node: ValidatedPresentation['nodes'][number],
    binding: AeliqoDataBinding,
    context?: AeliqoDataPresentationRenderContext,
  ) => TemplateResult | typeof nothing;
}

export interface AeliqoDataPresentationRenderContext {
  readonly interaction?: InteractionState;
  readonly onRequest?: AeliqoDataHostRequestHandler;
}

type DataManifestComponent = Exclude<AeliqoDataComponentId, 'table'>;
type CoreNode = ValidatedPresentation['nodes'][number];

const DATA_COMPONENTS: readonly DataManifestComponent[] = [
  'metric',
  'delta',
  'keyValue',
  'detail',
  'recordList',
  'cardCollection',
  'filterBuilder',
  'selectionSummary',
];

const SELECTION_COMPONENTS: ReadonlySet<DataManifestComponent | 'table'> = new Set([
  'table',
  'recordList',
  'cardCollection',
  'selectionSummary',
]);
const COMPARE_COMPONENTS: ReadonlySet<DataManifestComponent | 'table'> = new Set(['table', 'delta', 'detail']);

const fail = <T>(code: string, message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: `web.data.presentation.${code}`, message, retryable: false }],
});

function versionKey(ref: VersionRef): string {
  return JSON.stringify([ref.id, ref.revision]);
}

function sameRef(left: ResultRef | undefined, right: ResultRef): boolean {
  return left !== undefined && refKey(left) === refKey(right);
}

function sameResult(left: Result, right: Result): boolean {
  return sameRef(left.ref, right.ref) && canonical(left) === canonical(right);
}

function sameRows(left: AeliqoValidatedBinding, right: AeliqoValidatedBinding): boolean {
  // Materialization order is presentation state; content changes require a new
  // authorized snapshot. Identity uniqueness is checked before this comparison.
  return canonical(left.rows.map(canonical).sort()) === canonical(right.rows.map(canonical).sort());
}

function bindingEntries(input: AeliqoAuthorizedDataBindings): readonly (readonly [string, AeliqoDataBinding])[] {
  if (input instanceof Map) return [...input.entries()];
  if (Array.isArray(input)) return input.map((binding) => [refKey(binding.result.ref), binding] as const);
  return Object.entries(input);
}

function snapshotBindings(
  input: AeliqoAuthorizedDataBindings,
  options: AeliqoDataRegistryOptions,
): Outcome<ReadonlyMap<string, AeliqoValidatedBinding>> {
  try {
    const entries = bindingEntries(input);
    if (entries.length > 128) return fail('binding', 'The authorized data binding table is too large.');
    const map = new Map<string, AeliqoValidatedBinding>();
    for (const [key, binding] of entries) {
      const checked = validateAeliqoDataBinding(binding, options);
      if (!checked.ok) return checked;
      const actualKey = refKey(checked.value.result.ref);
      // A caller supplied map key is an index, never authority. It must still
      // name the exact ResultRef so an accidental alias cannot shadow a result.
      if (key !== actualKey) return fail('binding', 'Authorized data bindings must be keyed by their exact ResultRef.');
      if (map.has(actualKey))
        return fail('binding', 'An exact ResultRef may have only one authorized materialization.');
      map.set(
        actualKey,
        freeze({
          result: checked.value.result,
          rows: checked.value.rows,
          columns: checked.value.columns,
          scope: checked.value.scope,
        }),
      );
    }
    return { ok: true, value: map };
  } catch {
    return fail('binding', 'The authorized data binding table could not be validated.');
  }
}

function dataComponent(ref: VersionRef): DataManifestComponent | 'table' | undefined {
  return (Object.keys(AELIQO_DATA_REFS) as AeliqoDataComponentId[]).find((component) => {
    const candidate = AELIQO_DATA_REFS[component];
    return candidate.id === ref.id && candidate.revision === ref.revision;
  }) as DataManifestComponent | 'table' | undefined;
}

function shouldRead(component: DataManifestComponent | 'table', config: AeliqoDataResolvedNode['config']): boolean {
  if (component === 'filterBuilder') return false;
  if (component !== 'selectionSummary') return true;
  return config.fields.length > 0 || config.ports.some((port) => port.payload === 'selection');
}

function supportsSelection(component: DataManifestComponent | 'table'): boolean {
  return SELECTION_COMPONENTS.has(component);
}

function operationsFor(
  component: DataManifestComponent | 'table',
  config: AeliqoDataResolvedNode['config'],
): readonly VersionRef[] {
  const operations: VersionRef[] = [];
  const add = (operation: VersionRef): void => {
    if (!operations.some((candidate) => versionKey(candidate) === versionKey(operation))) operations.push(operation);
  };
  if (shouldRead(component, config)) add(AELIQO_DATA_PRESENTATION_OPERATIONS.read);
  if (COMPARE_COMPONENTS.has(component)) add(AELIQO_DATA_PRESENTATION_OPERATIONS.compare);
  if (component === 'filterBuilder') add(AELIQO_DATA_PRESENTATION_OPERATIONS.filter);
  if (supportsSelection(component) && config.ports.some((port) => port.payload === 'selection'))
    add(AELIQO_DATA_PRESENTATION_OPERATIONS.selection);
  return operations;
}

function manifestOperations(component: DataManifestComponent): readonly VersionRef[] {
  switch (component) {
    case 'delta':
    case 'detail':
      return [AELIQO_DATA_PRESENTATION_OPERATIONS.read, AELIQO_DATA_PRESENTATION_OPERATIONS.compare];
    case 'filterBuilder':
      return [AELIQO_DATA_PRESENTATION_OPERATIONS.filter];
    case 'selectionSummary':
      return [AELIQO_DATA_PRESENTATION_OPERATIONS.selection, AELIQO_DATA_PRESENTATION_OPERATIONS.read];
    case 'recordList':
    case 'cardCollection':
      return [AELIQO_DATA_PRESENTATION_OPERATIONS.read, AELIQO_DATA_PRESENTATION_OPERATIONS.selection];
    default:
      return [AELIQO_DATA_PRESENTATION_OPERATIONS.read];
  }
}

function presentationValues(value: Readonly<Record<string, unknown>>): Outcome<PresentationValues> {
  const parsed = parseWireValue(value);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value))
    return fail('config', 'The data presentation configuration is not bounded wire data.');
  return { ok: true, value: freeze(parsed.value as PresentationValues) };
}

function configFor(
  component: DataManifestComponent | 'table',
  values: PresentationValues,
  result: Result | undefined,
  bindings: ReadonlyMap<string, AeliqoValidatedBinding>,
  helper: ReturnType<typeof createAeliqoDataRegistry>,
): Outcome<ResolvedPresentationConfig> {
  if (result === undefined) return fail('binding', 'A data representation requires an authorized Result.');
  const binding = bindings.get(refKey(result.ref));
  if (binding === undefined)
    return fail('stale', 'The authorized ResultRef is not present in the current materialization table.');
  if (!sameResult(binding.result, result))
    return fail('stale', 'The materialized Result descriptor is stale for this ResultRef.');
  const resolved = helper.resolve({ id: 'presentation-data', component, config: values }, binding);
  if (!resolved.ok) return resolved;
  if (!sameRef(resolved.value.result.ref, result.ref))
    return fail('stale', 'The data helper returned a different ResultRef.');
  const resolvedValues = presentationValues(resolved.value.config.values);
  if (!resolvedValues.ok) return resolvedValues;
  return {
    ok: true,
    value: {
      values: resolvedValues.value,
      fields: freeze([...resolved.value.config.fields]),
      ports: freeze(resolved.value.config.ports.map((port) => freeze({ ...port }))),
      operations: operationsFor(component, resolved.value.config),
    },
  };
}

function buildManifest(
  component: DataManifestComponent,
  bindings: ReadonlyMap<string, AeliqoValidatedBinding>,
  options: AeliqoDataRegistryOptions,
): PresentationManifest {
  const helper = createAeliqoDataRegistry(options);
  const assess = adaptiveQuality(component);
  return freeze({
    ref: AELIQO_DATA_REFS[component],
    configSchema: AELIQO_DATA_CONFIG_SCHEMAS[component],
    roles: [`${component}`],
    operations: manifestOperations(component),
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: false,
    resolveConfig: (values, result) => configFor(component, values, result, bindings, helper),
    ...(assess === undefined ? {} : { assess: (_config, _result, environment) => assess(environment) }),
  });
}

const ADAPTIVE_QUALITY: Readonly<
  Partial<Record<DataManifestComponent, (environment: PresentationEnvironment) => Outcome<PresentationQuality>>>
> = {
  cardCollection: (environment) => {
    const narrow = environment.inlineSize.state === 'known' && environment.inlineSize.value < 640;
    return {
      ok: true,
      value: {
        taskFit: narrow ? 90 : 75,
        informationDensity: narrow ? 70 : 60,
        interactionEffort: narrow ? 5 : 10,
        legibilityPenalty: 0,
      },
    };
  },
  recordList: () => ({
    ok: true,
    value: { taskFit: 80, informationDensity: 55, interactionEffort: 5, legibilityPenalty: 0 },
  }),
  detail: () => ({
    ok: true,
    value: { taskFit: 95, informationDensity: 70, interactionEffort: 5, legibilityPenalty: 0 },
  }),
};

function adaptiveQuality(
  component: DataManifestComponent,
): ((environment: PresentationEnvironment) => Outcome<PresentationQuality>) | undefined {
  return ADAPTIVE_QUALITY[component];
}

/** Build the eight canonical data manifests that complement the existing data.table@1 manifest. */
export function createAeliqoDataPresentationManifests(
  input: AeliqoAuthorizedDataBindings,
  options: AeliqoDataRegistryOptions = {},
): Outcome<readonly PresentationManifest[]> {
  const bindings = snapshotBindings(input, options);
  if (!bindings.ok) return bindings;
  return {
    ok: true,
    value: freeze(DATA_COMPONENTS.map((component) => buildManifest(component, bindings.value, options))),
  };
}

/** Create a complete data presentation bridge, including current binding lookup and rendering. */
export function createAeliqoDataPresentationRegistry(
  input: AeliqoAuthorizedDataBindings,
  options: AeliqoDataRegistryOptions = {},
): Outcome<AeliqoDataPresentationRegistry> {
  const bindings = snapshotBindings(input, options);
  if (!bindings.ok) return bindings;
  const manifests = freeze(DATA_COMPONENTS.map((component) => buildManifest(component, bindings.value, options)));
  const helper = createAeliqoDataRegistry(options);
  const bindingFor = (ref: ResultRef): Outcome<AeliqoValidatedBinding> => {
    const binding = bindings.value.get(refKey(ref));
    return binding === undefined
      ? fail('stale', 'The requested ResultRef is not authorized in this presentation revision.')
      : { ok: true, value: binding };
  };
  const render = (
    node: CoreNode,
    binding: AeliqoDataBinding,
    context: AeliqoDataPresentationRenderContext = {},
  ): TemplateResult | typeof nothing =>
    renderAeliqoDataPresentationNodeWith(helper, node, binding, options, bindings.value, context);
  return { ok: true, value: freeze({ manifests, bindingFor, render }) };
}

function currentBinding(
  current: AeliqoDataBinding,
  expected: Result,
  authorized: AeliqoValidatedBinding,
  options: AeliqoDataRegistryOptions,
): AeliqoValidatedBinding | undefined {
  if (!sameRef(current.result.ref, expected.ref)) return undefined;
  const checked = validateAeliqoDataBinding(current, options);
  if (!checked.ok || !sameResult(checked.value.result, expected)) return undefined;
  if (!sameRows(authorized, checked.value)) return undefined;
  if (canonical(authorized.scope) !== canonical(checked.value.scope)) return undefined;
  if (canonical(authorized.columns) !== canonical(checked.value.columns)) return undefined;
  return checked.value;
}

function resolvedNodeMatches(
  resolved: AeliqoDataResolvedNode,
  node: CoreNode,
  component: DataManifestComponent | 'table',
): boolean {
  return (
    canonical(resolved.config.fields) === canonical(node.config.fields) &&
    canonical(resolved.config.ports) === canonical(node.config.ports) &&
    canonical(resolved.config.values) === canonical(node.config.values) &&
    canonical(operationsFor(component, resolved.config)) === canonical(node.config.operations)
  );
}

function renderAeliqoDataPresentationNodeWith(
  helper: ReturnType<typeof createAeliqoDataRegistry>,
  node: CoreNode,
  current: AeliqoDataBinding,
  options: AeliqoDataRegistryOptions,
  authorized: ReadonlyMap<string, AeliqoValidatedBinding>,
  context: AeliqoDataPresentationRenderContext,
): TemplateResult | typeof nothing {
  const component = dataComponent(node.manifest);
  if (component === undefined || node.result === undefined) return nothing;
  const authorizedBinding = authorized.get(refKey(node.result.ref));
  if (authorizedBinding === undefined) return nothing;
  const checked = currentBinding(current, node.result, authorizedBinding, options);
  if (checked === undefined) return nothing;
  const resolved = helper.resolve({ id: node.node.id, component, config: node.config.values }, checked);
  if (!resolved.ok || !sameRef(resolved.value.result.ref, node.result.ref)) return nothing;
  if (!resolvedNodeMatches(resolved.value, node, component)) return nothing;
  return renderAeliqoDataNode(resolved.value, context);
}

/** Render a core validated data node from current host materialization only. */
export function renderAeliqoDataPresentationNode(
  node: CoreNode,
  current: AeliqoDataBinding,
  context: AeliqoDataPresentationRenderContext = {},
  options: AeliqoDataRegistryOptions = {},
): TemplateResult | typeof nothing {
  const component = dataComponent(node.manifest);
  if (component === undefined || node.result === undefined) return nothing;
  const helper = createAeliqoDataRegistry(options);
  const checked = validateAeliqoDataBinding(current, options);
  if (
    !checked.ok ||
    !sameRef(checked.value.result.ref, node.result.ref) ||
    !sameResult(checked.value.result, node.result)
  )
    return nothing;
  return renderAeliqoDataPresentationNodeWith(
    helper,
    node,
    current,
    options,
    new Map([[refKey(checked.value.result.ref), checked.value]]),
    context,
  );
}
