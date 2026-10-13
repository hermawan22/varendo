import { parseWireValue, type Outcome, type Scalar, type VersionRef } from '@varendo/core';
import type { PresentationManifest, PresentationValues, ResolvedPresentationConfig } from '@varendo/core/presentation';
import { VARENDO_FOUNDATION_MANIFESTS } from '../foundation/manifest.js';
import { freezeValue as freeze } from './registry-value.js';
import { bounded, ref, safeHref, uniqueRefs } from './navigation-feedback-support.js';

/** Immutable application-owned bindings. Change the Experience revision when these change. */
export interface VarendoFoundationBindings {
  readonly revision: string;
  readonly contents?: readonly { readonly id: string; readonly text: string }[];
  readonly actions?: readonly {
    readonly id: string;
    readonly action: VersionRef;
    readonly input: Readonly<Record<string, Scalar>>;
  }[];
  readonly routes?: readonly {
    readonly id: string;
    readonly route: VersionRef;
    readonly params: Readonly<Record<string, Scalar>>;
    readonly href: string;
  }[];
  readonly identities?: readonly {
    readonly id: string;
    readonly name: string;
    readonly src?: string;
    readonly alt?: string;
  }[];
}
const fail = <T>(message: string): Outcome<T> => ({
  ok: false,
  diagnostics: [{ code: 'web.presentation.foundation-binding', message, retryable: false }],
});
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function scalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (record(value) &&
      Object.keys(value).length === 1 &&
      typeof value.decimal === 'string' &&
      value.decimal.length <= 512 &&
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value.decimal))
  );
}
function scalarRecord(value: unknown): value is Readonly<Record<string, Scalar>> {
  return (
    record(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(([key, value]) => bounded(key) && scalar(value))
  );
}
type FoundationBindingKind = 'contents' | 'actions' | 'routes' | 'identities';

const FOUNDATION_BINDING_KINDS: readonly FoundationBindingKind[] = ['contents', 'actions', 'routes', 'identities'];

function bindingFields(kind: FoundationBindingKind): readonly string[] {
  switch (kind) {
    case 'contents':
      return ['id', 'text'];
    case 'actions':
      return ['id', 'action', 'input'];
    case 'routes':
      return ['id', 'route', 'params', 'href'];
    case 'identities':
      return ['id', 'name', 'src', 'alt'];
  }
}

function hasUnknownFields(item: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(item).some((key) => !allowed.includes(key));
}

function contentBindingError(item: Record<string, unknown>): string | undefined {
  return bounded(item.text, 4096) ? undefined : 'Registered content requires bounded nonempty text.';
}

function actionBindingError(item: Record<string, unknown>): string | undefined {
  return ref(item.action) && scalarRecord(item.input)
    ? undefined
    : 'Registered actions require a versioned action and scalar input.';
}

function routeBindingError(item: Record<string, unknown>): string | undefined {
  return ref(item.route) && scalarRecord(item.params) && safeHref(item.href)
    ? undefined
    : 'Registered routes require a versioned route, scalar parameters and a safe destination.';
}

function identityBindingError(item: Record<string, unknown>): string | undefined {
  if (!bounded(item.name)) return 'Registered identity content is invalid.';
  if (item.src !== undefined && !safeHref(item.src, true)) return 'Registered identity content is invalid.';
  if (item.alt !== undefined && !bounded(item.alt)) return 'Registered identity content is invalid.';
  return undefined;
}

function foundationBindingError(kind: FoundationBindingKind, item: Record<string, unknown>): string | undefined {
  if (hasUnknownFields(item, bindingFields(kind))) return 'A foundation binding contains an unknown field.';
  switch (kind) {
    case 'contents':
      return contentBindingError(item);
    case 'actions':
      return actionBindingError(item);
    case 'routes':
      return routeBindingError(item);
    case 'identities':
      return identityBindingError(item);
  }
}

function collectionError(kind: FoundationBindingKind, items: unknown): string | undefined {
  if (!Array.isArray(items) || items.length > 128) return 'Foundation binding collections are bounded to 128 entries.';
  const ids = new Set<string>();
  for (const item of items) {
    if (!record(item) || !bounded(item.id) || ids.has(item.id))
      return 'Foundation binding identifiers must be unique bounded strings.';
    ids.add(item.id);
    const error = foundationBindingError(kind, item);
    if (error !== undefined) return error;
  }
  return undefined;
}

function copyBindings(input: VarendoFoundationBindings | undefined): Outcome<VarendoFoundationBindings> {
  if (input === undefined) return { ok: true, value: { revision: 'unconfigured' } };
  const parsed = parseWireValue(input);
  if (!parsed.ok) return fail('Foundation bindings must be bounded JSON data.');
  const value: unknown = JSON.parse(JSON.stringify(parsed.value));
  if (!record(value) || !bounded(value.revision)) return fail('Foundation binding metadata is invalid.');
  if (hasUnknownFields(value, ['revision', ...FOUNDATION_BINDING_KINDS]))
    return fail('Foundation binding metadata is invalid.');
  for (const kind of FOUNDATION_BINDING_KINDS) {
    const items = value[kind];
    if (items === undefined) continue;
    const error = collectionError(kind, items);
    if (error !== undefined) return fail(error);
  }
  return { ok: true, value: freeze(value) as unknown as VarendoFoundationBindings };
}

type FoundationManifest = (typeof VARENDO_FOUNDATION_MANIFESTS)[number];

const CONTAINER_IDS = new Set([
  'foundation.surface',
  'foundation.stack',
  'foundation.grid',
  'foundation.scroll-area',
  'foundation.split-pane',
]);

function manifestOperations(manifest: FoundationManifest, bindings: VarendoFoundationBindings): readonly VersionRef[] {
  if (manifest.ref.id === 'foundation.link') return uniqueRefs((bindings.routes ?? []).map((entry) => entry.route));
  if (manifest.role === 'action') return uniqueRefs((bindings.actions ?? []).map((entry) => entry.action));
  return [];
}

function manifestChildren(manifest: FoundationManifest): PresentationManifest['children'] {
  if (manifest.ref.id === 'foundation.split-pane') return { min: 2, max: 2 };
  if (CONTAINER_IDS.has(manifest.ref.id)) return { min: 0, max: 32 };
  return { min: 0, max: 0 };
}

function resolvedConfig(
  values: Record<string, unknown>,
  ports: ResolvedPresentationConfig['ports'] = [],
  operations: VersionRef[] = [],
): Outcome<ResolvedPresentationConfig> {
  return { ok: true, value: { values: values as PresentationValues, fields: [], ports, operations } };
}

function applyContentReferences(
  values: Record<string, unknown>,
  bindings: VarendoFoundationBindings,
): string | undefined {
  const references = [
    ['contentRef', 'text'],
    ['labelRef', 'label'],
  ] as const;
  for (const [referenceKey, valueKey] of references) {
    const reference = values[referenceKey];
    if (reference === undefined) continue;
    const content = bindings.contents?.find((entry) => entry.id === reference);
    if (content === undefined) return 'The requested content reference is not registered.';
    values[valueKey] = content.text;
  }
  return undefined;
}

function applyAvatarBinding(values: Record<string, unknown>, bindings: VarendoFoundationBindings): string | undefined {
  const identity = bindings.identities?.find((entry) => entry.id === values.identityRef);
  if (identity === undefined) return 'The requested identity reference is not registered.';
  values.name = identity.name;
  if (identity.src !== undefined) values.src = identity.src;
  if (identity.alt !== undefined) values.alt = identity.alt;
  return undefined;
}

function actionConfig(
  manifestId: string,
  values: Record<string, unknown>,
  bindings: VarendoFoundationBindings,
): Outcome<ResolvedPresentationConfig> | undefined {
  if (manifestId !== 'foundation.button' && manifestId !== 'foundation.icon-button') return undefined;
  const action = bindings.actions?.find((entry) => entry.id === values.actionRef);
  if (action === undefined) return fail('The requested action reference is not registered.');
  if (values.type !== undefined && values.type !== 'button')
    return fail('Semantic buttons require type button; native submit/reset belongs to the direct form path.');
  values.action = action.action;
  values.actionInput = action.input;
  values.type = 'button';
  return resolvedConfig(values, [{ id: 'action', direction: 'output', payload: 'action-request' }], [action.action]);
}

function routeConfig(
  manifestId: string,
  values: Record<string, unknown>,
  bindings: VarendoFoundationBindings,
): Outcome<ResolvedPresentationConfig> | undefined {
  if (manifestId !== 'foundation.link') return undefined;
  const route = bindings.routes?.find((entry) => entry.id === values.routeRef);
  if (route === undefined) return fail('The requested route reference is not registered.');
  values.route = route.route;
  values.params = route.params;
  values.href = route.href;
  return resolvedConfig(values, [{ id: 'navigate', direction: 'output', payload: 'navigate' }], [route.route]);
}

function resolveFoundationConfig(
  values: PresentationValues,
  manifest: FoundationManifest,
  bindings: VarendoFoundationBindings,
): Outcome<ResolvedPresentationConfig> {
  if (values.bindingRevision !== bindings.revision)
    return fail('The foundation binding revision does not match the pinned configuration.');
  const { bindingRevision: _bindingRevision, ...leafValues } = values;
  const checked = manifest.resolveConfig(leafValues);
  if (!checked.ok) return fail(checked.diagnostics[0]?.message ?? 'Foundation configuration is invalid.');
  const resolved: Record<string, unknown> = { ...checked.value.values, bindingRevision: bindings.revision };
  const contentError = applyContentReferences(resolved, bindings);
  if (contentError !== undefined) return fail(contentError);
  if (manifest.ref.id === 'foundation.avatar') {
    const identityError = applyAvatarBinding(resolved, bindings);
    if (identityError !== undefined) return fail(identityError);
  }
  const action = actionConfig(manifest.ref.id, resolved, bindings);
  if (action !== undefined) return action;
  const route = routeConfig(manifest.ref.id, resolved, bindings);
  if (route !== undefined) return route;
  return resolvedConfig(resolved);
}

function createFoundationManifest(
  manifest: FoundationManifest,
  bindings: VarendoFoundationBindings,
): PresentationManifest {
  return {
    ref: manifest.ref,
    configSchema: { id: `${manifest.ref.id}.config`, revision: '1' },
    roles: [manifest.role],
    operations: manifestOperations(manifest, bindings),
    result: 'none',
    children: manifestChildren(manifest),
    visibility: CONTAINER_IDS.has(manifest.ref.id) ? 'simultaneous' : 'leaf',
    extension: false,
    resolveConfig: (values) => resolveFoundationConfig(values, manifest, bindings),
  };
}

/** Adapts owned primitives to the SAME core presentation validator used by data views. */
export function createFoundationPresentationManifests(
  input?: VarendoFoundationBindings,
): Outcome<readonly PresentationManifest[]> {
  const copied = copyBindings(input);
  if (!copied.ok) return copied;
  const manifests = VARENDO_FOUNDATION_MANIFESTS.map((manifest) => createFoundationManifest(manifest, copied.value));
  return { ok: true, value: manifests };
}
