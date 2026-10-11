import {
  createPresentationRegistry,
  type PresentationEnvironment,
  type PresentationRegistry,
} from '@varendo/core/presentation';
import type { Diagnostic, Experience, ResourceDefinition, Result, CommitPreconditions } from '@varendo/core';
import type {
  AeliqoRuntime,
  RuntimeCommittedReceipt,
  RuntimeRegionState,
  RuntimeUnsubscribe,
} from '@varendo/runtime/app';
import type { AeliqoRegionElement } from '../region/aeliqo-region.js';
import { createAeliqoPresentationRegistry, createSelectionIdentityMapping } from '../region/registry.js';
import type { AeliqoInputBindings } from '../region/input-registry.js';
import type { AeliqoRegionResult, AeliqoViewDefinition } from '../region/types.js';
import type { RecipeDefinition, RecipePresentationPolicy } from '../recipes/types.js';
import { canonicalViewId, STANDARD_STATE_MAPPINGS } from '../recipes/standard.js';
import type { AeliqoAppOptions, WebRenderReceipt } from './types.js';

export interface WebRegion {
  readonly id: string;
  readonly resourceId: string;
  readonly target: HTMLElement;
  readonly element: AeliqoRegionElement;
  resize?: ResizeObserver;
  media?: {
    readonly lists: readonly MediaQueryList[];
    readonly onChange: () => void;
  };
  adaptFrame?: number;
  /** Cancels an in-flight presentation before it can publish after a newer render. */
  presentationAbort?: AbortController;
  /** Blocks reentrant renderer emissions until the canonical publication settles. */
  presentationTransaction?: symbol;
  renderAbort?: AbortController;
  draftRevision?: number;
  renderedAuthority?: string;
  sequence: number;
  category: 'wide' | 'narrow' | 'unknown';
  composing: boolean;
  pendingAdapt: boolean;
  actionPending: boolean;
  actionSequence: number;
  actionAttempt?: string;
  actionAbort?: AbortController;
  cancelAction?: () => boolean;
  runtimeSubscription?: RuntimeUnsubscribe;
  readonly values: Map<string, WebRegionValue>;
  readonly drafts: Map<string, WebRegionDraft>;
  last?: {
    readonly receipt: RuntimeCommittedReceipt;
    readonly results: readonly AeliqoRegionResult[];
    readonly descriptors: readonly Result[];
    readonly inputs?: AeliqoInputBindings;
  };
}

type WebRegionValue = {
  readonly nodeId: string;
  readonly portId: string;
  readonly payload: Extract<
    import('@varendo/core').InteractionPayload,
    { readonly kind: 'selection' | 'filter' | 'range' | 'group' | 'page' }
  >;
};
type WebRegionDraft = Extract<import('@varendo/core').InteractionPayload, { readonly kind: 'draft' }>;

export interface WebAppContext {
  readonly options: AeliqoAppOptions;
  readonly runtime: AeliqoRuntime;
  readonly resources: ReadonlyMap<string, import('@varendo/core').ResourceDefinition>;
  readonly recipes: readonly RecipeDefinition[];
  readonly views: readonly AeliqoViewDefinition[];
  readonly patterns?: NonNullable<PresentationRegistry['patterns']>;
  readonly stateMappings?: NonNullable<PresentationRegistry['stateMappings']>;
  readonly regions: Map<string, WebRegion>;
  readonly stateListeners: Map<string, Set<(state: RuntimeRegionState) => void>>;
  disposed: boolean;
}

export function diagnostic(code: string, message: string): Diagnostic {
  return { code, message, retryable: false };
}

export function failedAfterRuntime(
  status: 'unsupported' | 'failed' | 'cancelled' | 'needs-input',
  runtime: RuntimeCommittedReceipt,
  requestId: string,
  diagnostics: readonly [Diagnostic, ...Diagnostic[]],
): WebRenderReceipt {
  return { status, regionId: runtime.regionId, requestId, runtime, diagnostics };
}

export function withoutDataRevision(
  readSet: NonNullable<RuntimeCommittedReceipt['region']['readSet']>,
): CommitPreconditions {
  const { dataRevision: _dataRevision, ...pins } = readSet;
  return pins;
}

function refKey(ref: Result['ref']): string {
  return JSON.stringify([
    ref.id,
    ref.revision,
    ref.sourceLineage ?? null,
    ref.outputId,
    ref.queryDigest,
    ref.scopeDigest,
  ]);
}

export function materialize(
  receipt: RuntimeCommittedReceipt,
): { readonly results: readonly AeliqoRegionResult[]; readonly descriptors: readonly Result[] } | undefined {
  const results: AeliqoRegionResult[] = [];
  const descriptors: Result[] = [];
  for (const output of receipt.outputs) {
    const snapshot = output.handle.snapshot();
    if (snapshot.descriptor === undefined || (snapshot.status !== 'ready' && snapshot.status !== 'partial'))
      return undefined;
    descriptors.push(snapshot.descriptor);
    results.push({
      ref: snapshot.descriptor.ref,
      rows: snapshot.batches.flatMap((batch) => batch.rows),
      columns: snapshot.descriptor.fields.map((field) => ({ key: field.id, label: field.label })),
    });
  }
  return { results: Object.freeze(results), descriptors: Object.freeze(descriptors) };
}

function measuredSize(value: number): PresentationEnvironment['inlineSize'] {
  if (value <= 0) return { state: 'unknown' };
  return { state: 'known', value };
}

function mediaMatches(view: Window | null, query: string): boolean {
  return view?.matchMedia(query).matches === true;
}

export const ADAPTIVE_MEDIA_QUERIES = [
  '(pointer: coarse)',
  '(hover: hover)',
  '(prefers-reduced-motion: reduce)',
  '(forced-colors: active)',
] as const;

function targetLocale(region: WebRegion, view: Window | null): string {
  return region.target.lang || region.target.ownerDocument.documentElement.lang || view?.navigator.language || 'en-US';
}

export function environmentFor(region: WebRegion): PresentationEnvironment {
  const view = region.target.ownerDocument.defaultView;
  const bounds = region.target.getBoundingClientRect();
  const direction = view?.getComputedStyle(region.target).direction === 'rtl' ? 'rtl' : 'ltr';
  return {
    inlineSize: measuredSize(bounds.width),
    blockSize: measuredSize(bounds.height),
    textScale: { state: 'unknown' },
    pointer: mediaMatches(view, '(pointer: coarse)') ? 'coarse' : 'unknown',
    hover: mediaMatches(view, '(hover: hover)') ? 'available' : 'unknown',
    keyboard: 'unknown',
    locale: targetLocale(region, view),
    direction,
    reducedMotion: mediaMatches(view, '(prefers-reduced-motion: reduce)'),
    forcedColors: mediaMatches(view, '(forced-colors: active)'),
  };
}

export function category(width: number, previous: WebRegion['category']): WebRegion['category'] {
  if (!(width > 0)) return 'unknown';
  if (previous === 'wide') return width < 616 ? 'narrow' : 'wide';
  if (previous === 'narrow') return width > 664 ? 'wide' : 'narrow';
  return width < 640 ? 'narrow' : 'wide';
}

function deepActive(document: Document): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement !== null && active?.shadowRoot?.activeElement !== undefined)
    active = active.shadowRoot.activeElement;
  return active;
}

function composedContains(container: Element, node: Element): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === container) return true;
    const root: Node = current.getRootNode();
    const host: Node | undefined = root !== current ? shadowHost(root) : undefined;
    const parent: Node | null = current.parentNode;
    current = host ?? parent;
  }
  return false;
}

function shadowHost(root: Node): Node | undefined {
  if (!('host' in root)) return undefined;
  const host: unknown = root.host;
  return host !== null && typeof host === 'object' ? (host as Node) : undefined;
}

export function interactionLocked(region: WebRegion): boolean {
  if (region.composing || region.actionPending) return true;
  const active = deepActive(region.target.ownerDocument);
  if (active === null || !composedContains(region.element, active)) return false;
  return active.matches('input, textarea, select, [contenteditable="true"], [data-aeliqo-dirty="true"]');
}

export function registryFor(
  results: readonly AeliqoRegionResult[],
  descriptors: readonly Result[],
  views: readonly AeliqoViewDefinition[],
  resourceId: string,
  inputs?: AeliqoInputBindings,
  registrations: Pick<AeliqoAppOptions, 'patterns' | 'stateMappings'> = {},
): PresentationRegistry | undefined {
  const byRef = new Map(descriptors.map((descriptor) => [refKey(descriptor.ref), descriptor]));
  const visualizations = results.flatMap((binding) => {
    const descriptor = byRef.get(refKey(binding.ref));
    if (descriptor === undefined) return [];
    return [
      {
        result: descriptor,
        context: binding.visualizationContext ?? { results: [descriptor] },
        datasets: [{ result: binding.ref, rows: binding.rows }],
      },
    ];
  });
  const base = createAeliqoPresentationRegistry({
    ...(inputs === undefined ? {} : { inputs }),
    data: results.flatMap((binding) => {
      const result = byRef.get(refKey(binding.ref));
      return result === undefined
        ? []
        : [{ result, rows: binding.rows, ...(binding.columns === undefined ? {} : { columns: binding.columns }) }];
    }),
    visualizations,
    resolveEntity: () => resourceId,
  });
  if (!base.ok) return undefined;
  const mappings = [...base.value.mappings];
  if (mappings.length === 0 && descriptors.length === 1 && descriptors[0]!.identity.length > 0)
    mappings.push(createSelectionIdentityMapping(resourceId, descriptors[0]!.identity, descriptors[0]!.rowGrain));
  const combined = createPresentationRegistry(
    [...base.value.manifests, ...views.map((view) => view.manifest)],
    mappings,
    [...(base.value.patterns ?? []), ...(registrations.patterns ?? [])],
    [...(base.value.stateMappings ?? []), ...STANDARD_STATE_MAPPINGS, ...(registrations.stateMappings ?? [])],
  );
  return combined.ok ? combined.value : undefined;
}

export function presentationPolicy(resource: ResourceDefinition): RecipePresentationPolicy {
  return Object.freeze({
    allowedRepresentations: Object.freeze(resource.presentation.allowedViews.map(canonicalViewId)),
  });
}

export function experience(
  registry: PresentationRegistry,
  revision: string,
  policy?: RecipePresentationPolicy,
  requirePattern = false,
): Experience {
  const permitted = new Set(policy?.allowedRepresentations ?? registry.manifests.map((manifest) => manifest.ref.id));
  const permittedByResourceOrStructure = (manifest: PresentationRegistry['manifests'][number]): boolean =>
    permitted.has(manifest.ref.id) ||
    (manifest.result === 'none' && manifest.operations.length === 0 && manifest.roles.includes('structure'));
  return {
    version: '1',
    id: 'aeliqo.web.app',
    revision,
    mode: (registry.patterns?.length ?? 0) > 0 ? 'composable' : 'adaptive',
    agentAllowed: true,
    allowedRepresentations: registry.manifests
      .filter(permittedByResourceOrStructure)
      .map((manifest) => manifest.ref.id),
    allowedPatterns: registry.patterns?.map((pattern) => pattern.ref.id) ?? [],
    composition: { allowWithoutPreset: !requirePattern, maxNodes: 32, maxExpansions: 64 },
    requiredOperations: [],
    tokenProfile: { id: 'tokens.default', revision: '1' },
    extensionAllowlist: registry.manifests
      .filter((manifest) => manifest.extension && permittedByResourceOrStructure(manifest))
      .map((manifest) => manifest.ref),
    transitionPolicy: 'stable',
  };
}
