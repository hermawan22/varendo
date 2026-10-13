/**
 * Build-time manifest metadata for the foundation family. This module contains
 * no custom element imports; the region registry can validate a node here and
 * resolve registered action/route/content references through host policy.
 */
export const VARENDO_FOUNDATION_REFS = {
  button: { id: 'foundation.button', revision: '1' },
  iconButton: { id: 'foundation.icon-button', revision: '1' },
  link: { id: 'foundation.link', revision: '1' },
  text: { id: 'foundation.text', revision: '1' },
  heading: { id: 'foundation.heading', revision: '1' },
  badge: { id: 'foundation.badge', revision: '1' },
  avatar: { id: 'foundation.avatar', revision: '1' },
  separator: { id: 'foundation.separator', revision: '1' },
  surface: { id: 'foundation.surface', revision: '1' },
  stack: { id: 'foundation.stack', revision: '1' },
  grid: { id: 'foundation.grid', revision: '1' },
  splitPane: { id: 'foundation.split-pane', revision: '1' },
  scrollArea: { id: 'foundation.scroll-area', revision: '1' },
} as const;

export type VarendoFoundationRef = (typeof VARENDO_FOUNDATION_REFS)[keyof typeof VARENDO_FOUNDATION_REFS];
export type VarendoFoundationId = VarendoFoundationRef['id'];

export interface VarendoFoundationDiagnostic {
  readonly code: 'foundation.config' | 'foundation.reference';
  readonly message: string;
  readonly retryable: false;
}

export type VarendoFoundationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly VarendoFoundationDiagnostic[] };

export interface VarendoFoundationConfig {
  readonly ref: VarendoFoundationRef;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface VarendoFoundationManifest {
  readonly ref: VarendoFoundationRef;
  readonly tagName: `varendo-${string}`;
  readonly role: 'action' | 'content' | 'structure';
  readonly namedParts: readonly string[];
  readonly events: readonly string[];
  readonly configKeys: readonly string[];
  readonly resolveConfig: (input: unknown) => VarendoFoundationOutcome<VarendoFoundationConfig>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fail(code: VarendoFoundationDiagnostic['code'], message: string): VarendoFoundationOutcome<never> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

type ConfigFieldValidator = (value: unknown, values: Readonly<Record<string, unknown>>) => boolean;

const boundedString = (value: unknown, maximum = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;
const optionalString = (value: unknown): boolean => value === undefined || boundedString(value);
const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
const optionalFinite =
  (minimum: number, maximum: number): ConfigFieldValidator =>
  (value) =>
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum);
const optionalInteger =
  (minimum: number, maximum: number, allowed?: readonly number[]): ConfigFieldValidator =>
  (value) =>
    value === undefined ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum &&
      (allowed === undefined || allowed.includes(value)));
const optionalEnum =
  <T extends string>(allowed: readonly T[]): ConfigFieldValidator =>
  (value) =>
    value === undefined || (typeof value === 'string' && allowed.includes(value as T));

function validate(
  ref: VarendoFoundationRef,
  keys: readonly string[],
  input: unknown,
  validators: Readonly<Record<string, ConfigFieldValidator>> = {},
): VarendoFoundationOutcome<VarendoFoundationConfig> {
  try {
    const values = record(input);
    if (values === undefined) return fail('foundation.config', `${ref.id} configuration must be an object.`);
    if (Object.keys(values).some((key) => !keys.includes(key)))
      return fail('foundation.config', `${ref.id} configuration contains an unknown field.`);
    for (const key of keys) {
      const validator = validators[key];
      if (validator !== undefined && !validator(values[key], values))
        return fail('foundation.config', `${ref.id} configuration field ${key} is malformed.`);
    }
    return { ok: true, value: { ref, values: Object.freeze({ ...values }) } };
  } catch {
    return fail('foundation.config', `${ref.id} configuration is malformed.`);
  }
}

function requiredReferences(
  ref: VarendoFoundationRef,
  keys: readonly string[],
  input: unknown,
  references: readonly string[],
  validators: Readonly<Record<string, ConfigFieldValidator>> = {},
): VarendoFoundationOutcome<VarendoFoundationConfig> {
  const checked = validate(ref, keys, input, validators);
  if (!checked.ok) return checked;
  for (const reference of references) {
    if (!boundedString(checked.value.values[reference]))
      return fail('foundation.reference', `${ref.id} requires a registered ${reference}.`);
  }
  return checked;
}

function requiredReference(
  ref: VarendoFoundationRef,
  keys: readonly string[],
  input: unknown,
  reference: string,
  validators: Readonly<Record<string, ConfigFieldValidator>> = {},
): VarendoFoundationOutcome<VarendoFoundationConfig> {
  return requiredReferences(ref, keys, input, [reference], validators);
}

const manifest = (
  ref: VarendoFoundationRef,
  tagName: `varendo-${string}`,
  role: VarendoFoundationManifest['role'],
  namedParts: readonly string[],
  events: readonly string[],
  configKeys: readonly string[],
  resolver: (input: unknown) => VarendoFoundationOutcome<VarendoFoundationConfig>,
): VarendoFoundationManifest => ({ ref, tagName, role, namedParts, events, configKeys, resolveConfig: resolver });

const actionKeys = ['actionRef', 'contentRef', 'variant', 'size', 'type'] as const;
const iconActionKeys = ['actionRef', 'contentRef', 'size', 'type'] as const;
const linkKeys = ['routeRef', 'contentRef', 'target'] as const;
const actionValidators = {
  actionRef: (value: unknown) => boundedString(value),
  contentRef: (value: unknown) => boundedString(value),
  variant: optionalEnum(['solid', 'outline', 'ghost', 'danger'] as const),
  size: optionalEnum(['small', 'medium', 'large'] as const),
  type: optionalEnum(['button', 'submit', 'reset'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const iconActionValidators = {
  actionRef: (value: unknown) => boundedString(value),
  contentRef: (value: unknown) => boundedString(value),
  size: optionalEnum(['small', 'medium', 'large'] as const),
  type: optionalEnum(['button', 'submit', 'reset'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const linkValidators = {
  routeRef: (value: unknown) => boundedString(value),
  contentRef: (value: unknown) => boundedString(value),
  target: optionalEnum(['_self', '_blank'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const textValidators = {
  contentRef: (value: unknown) => boundedString(value),
  as: optionalEnum(['span', 'p', 'div', 'small', 'strong', 'em', 'label'] as const),
  muted: optionalBoolean,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const headingValidators = {
  contentRef: (value: unknown) => boundedString(value),
  level: optionalInteger(1, 6),
  size: optionalEnum(['display', 'heading', 'title', 'body'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const badgeValidators = {
  contentRef: (value: unknown) => boundedString(value),
  tone: optionalEnum(['neutral', 'info', 'success', 'warning', 'danger'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const avatarValidators = {
  identityRef: (value: unknown) => boundedString(value),
  size: optionalEnum(['small', 'medium', 'large'] as const),
  decorative: optionalBoolean,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const separatorValidators = {
  orientation: optionalEnum(['horizontal', 'vertical'] as const),
  decorative: optionalBoolean,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const surfaceValidators = {
  as: optionalEnum(['div', 'section', 'article'] as const),
  tone: optionalEnum(['canvas', 'surface', 'raised'] as const),
  labelRef: optionalString,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const stackValidators = {
  direction: optionalEnum(['row', 'column'] as const),
  gap: optionalInteger(0, 48, [0, 4, 8, 12, 16, 24, 32, 48]),
  align: optionalEnum(['start', 'center', 'end', 'stretch'] as const),
  justify: optionalEnum(['start', 'center', 'end', 'between'] as const),
  wrap: optionalBoolean,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const gridValidators = {
  columns: optionalInteger(1, 6),
  gap: optionalInteger(4, 48, [4, 8, 12, 16, 24, 32, 48]),
  minItem: optionalEnum(['small', 'medium', 'large'] as const),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
const splitValidators = {
  orientation: optionalEnum(['horizontal', 'vertical'] as const),
  position: optionalFinite(0, 100),
  min: optionalFinite(0, 99),
  max: optionalFinite(1, 100),
  step: optionalFinite(Number.MIN_VALUE, 100),
} satisfies Readonly<Record<string, ConfigFieldValidator>>;
function splitConfig(input: unknown): VarendoFoundationOutcome<VarendoFoundationConfig> {
  const checked = validate(
    VARENDO_FOUNDATION_REFS.splitPane,
    ['orientation', 'position', 'min', 'max', 'step'],
    input,
    splitValidators,
  );
  if (!checked.ok) return checked;
  const values = checked.value.values;
  if (typeof values.min === 'number' && typeof values.max === 'number' && values.min >= values.max)
    return fail('foundation.config', 'foundation.split-pane requires min to be less than max.');
  if (typeof values.position === 'number' && typeof values.min === 'number' && values.position < values.min)
    return fail('foundation.config', 'foundation.split-pane position must respect min.');
  if (typeof values.position === 'number' && typeof values.max === 'number' && values.position > values.max)
    return fail('foundation.config', 'foundation.split-pane position must respect max.');
  return checked;
}
const scrollValidators = {
  axis: optionalEnum(['x', 'y', 'both'] as const),
  labelRef: optionalString,
} satisfies Readonly<Record<string, ConfigFieldValidator>>;

export const VARENDO_FOUNDATION_MANIFESTS: readonly VarendoFoundationManifest[] = [
  manifest(
    VARENDO_FOUNDATION_REFS.button,
    'varendo-button',
    'action',
    ['button', 'pending'],
    ['varendo-action'],
    actionKeys,
    (input) =>
      requiredReferences(
        VARENDO_FOUNDATION_REFS.button,
        actionKeys,
        input,
        ['actionRef', 'contentRef'],
        actionValidators,
      ),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.iconButton,
    'varendo-icon-button',
    'action',
    ['button', 'icon', 'pending'],
    ['varendo-action'],
    iconActionKeys,
    (input) =>
      requiredReferences(
        VARENDO_FOUNDATION_REFS.iconButton,
        iconActionKeys,
        input,
        ['actionRef', 'contentRef'],
        iconActionValidators,
      ),
  ),
  manifest(VARENDO_FOUNDATION_REFS.link, 'varendo-link', 'action', ['link'], ['varendo-link'], linkKeys, (input) =>
    requiredReferences(VARENDO_FOUNDATION_REFS.link, linkKeys, input, ['routeRef', 'contentRef'], linkValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.text,
    'varendo-text',
    'content',
    ['text'],
    [],
    ['contentRef', 'as', 'muted'],
    (input) =>
      requiredReference(
        VARENDO_FOUNDATION_REFS.text,
        ['contentRef', 'as', 'muted'],
        input,
        'contentRef',
        textValidators,
      ),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.heading,
    'varendo-heading',
    'content',
    ['heading'],
    [],
    ['contentRef', 'level', 'size'],
    (input) =>
      requiredReference(
        VARENDO_FOUNDATION_REFS.heading,
        ['contentRef', 'level', 'size'],
        input,
        'contentRef',
        headingValidators,
      ),
  ),
  manifest(VARENDO_FOUNDATION_REFS.badge, 'varendo-badge', 'content', ['badge'], [], ['contentRef', 'tone'], (input) =>
    requiredReference(VARENDO_FOUNDATION_REFS.badge, ['contentRef', 'tone'], input, 'contentRef', badgeValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.avatar,
    'varendo-avatar',
    'content',
    ['avatar', 'image', 'initials'],
    [],
    ['identityRef', 'size', 'decorative'],
    (input) =>
      requiredReference(
        VARENDO_FOUNDATION_REFS.avatar,
        ['identityRef', 'size', 'decorative'],
        input,
        'identityRef',
        avatarValidators,
      ),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.separator,
    'varendo-separator',
    'structure',
    ['separator'],
    [],
    ['orientation', 'decorative'],
    (input) => validate(VARENDO_FOUNDATION_REFS.separator, ['orientation', 'decorative'], input, separatorValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.surface,
    'varendo-surface',
    'structure',
    ['surface'],
    [],
    ['as', 'tone', 'labelRef'],
    (input) => validate(VARENDO_FOUNDATION_REFS.surface, ['as', 'tone', 'labelRef'], input, surfaceValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.stack,
    'varendo-stack',
    'structure',
    ['stack'],
    [],
    ['direction', 'gap', 'align', 'justify', 'wrap'],
    (input) =>
      validate(VARENDO_FOUNDATION_REFS.stack, ['direction', 'gap', 'align', 'justify', 'wrap'], input, stackValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.grid,
    'varendo-grid',
    'structure',
    ['grid'],
    [],
    ['columns', 'gap', 'minItem'],
    (input) => validate(VARENDO_FOUNDATION_REFS.grid, ['columns', 'gap', 'minItem'], input, gridValidators),
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.splitPane,
    'varendo-split-pane',
    'structure',
    ['split', 'start', 'splitter', 'end'],
    ['varendo-split-change'],
    ['orientation', 'position', 'min', 'max', 'step'],
    splitConfig,
  ),
  manifest(
    VARENDO_FOUNDATION_REFS.scrollArea,
    'varendo-scroll-area',
    'structure',
    ['scroll'],
    [],
    ['axis', 'labelRef'],
    (input) => validate(VARENDO_FOUNDATION_REFS.scrollArea, ['axis', 'labelRef'], input, scrollValidators),
  ),
];

export function getVarendoFoundationManifest(id: VarendoFoundationId): VarendoFoundationManifest | undefined {
  return VARENDO_FOUNDATION_MANIFESTS.find((candidate) => candidate.ref.id === id);
}
