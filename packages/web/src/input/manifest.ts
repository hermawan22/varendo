/** Build-time metadata for the input primitive family. No element imports. */
export const AELIQO_INPUT_REFS = {
  textField: { id: 'input.text-field', revision: '1' },
  textArea: { id: 'input.text-area', revision: '1' },
  numberField: { id: 'input.number-field', revision: '1' },
  checkbox: { id: 'input.checkbox', revision: '1' },
  radioGroup: { id: 'input.radio-group', revision: '1' },
  switch: { id: 'input.switch', revision: '1' },
  select: { id: 'input.select', revision: '1' },
  combobox: { id: 'input.combobox', revision: '1' },
  dateField: { id: 'input.date-field', revision: '1' },
  dateRange: { id: 'input.date-range', revision: '1' },
  slider: { id: 'input.slider', revision: '1' },
  searchField: { id: 'input.search-field', revision: '1' },
  fileInput: { id: 'input.file-input', revision: '1' },
  fieldGroup: { id: 'input.field-group', revision: '1' },
  form: { id: 'input.form', revision: '1' },
} as const;

export type AeliqoInputRef = (typeof AELIQO_INPUT_REFS)[keyof typeof AELIQO_INPUT_REFS];
export type AeliqoInputId = AeliqoInputRef['id'];

export interface AeliqoInputDiagnostic {
  readonly code: 'input.config' | 'input.reference';
  readonly message: string;
  readonly retryable: false;
}

export type AeliqoInputOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly AeliqoInputDiagnostic[] };

export interface AeliqoInputConfig {
  readonly ref: AeliqoInputRef;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface AeliqoInputManifest {
  readonly ref: AeliqoInputRef;
  readonly tagName: `aeliqo-${string}`;
  readonly role: 'input' | 'structure';
  readonly namedParts: readonly string[];
  readonly events: readonly string[];
  readonly configKeys: readonly string[];
  readonly resolveConfig: (input: unknown) => AeliqoInputOutcome<AeliqoInputConfig>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fail(code: AeliqoInputDiagnostic['code'], message: string): AeliqoInputOutcome<never> {
  return { ok: false, diagnostics: [{ code, message, retryable: false }] };
}

const stringField = (value: unknown, max = 256): boolean =>
  value === undefined || (typeof value === 'string' && value.length <= max);
const requiredString = (value: unknown, max = 256): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const booleanField = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
const finiteField = (value: unknown, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
const enumField =
  <T extends string>(allowed: readonly T[]) =>
  (value: unknown): boolean =>
    value === undefined || (typeof value === 'string' && allowed.includes(value as T));

type Validator = (value: unknown, values: Readonly<Record<string, unknown>>) => boolean;

function validate(
  ref: AeliqoInputRef,
  keys: readonly string[],
  input: unknown,
  validators: Readonly<Record<string, Validator>> = {},
): AeliqoInputOutcome<AeliqoInputConfig> {
  const values = record(input);
  if (values === undefined) return fail('input.config', `${ref.id} configuration must be an object.`);
  if (Object.keys(values).some((key) => !keys.includes(key)))
    return fail('input.config', `${ref.id} configuration contains an unknown field.`);
  for (const key of keys) {
    const validator = validators[key];
    if (validator !== undefined && !validator(values[key], values))
      return fail('input.config', `${ref.id} configuration field ${key} is malformed.`);
  }
  return { ok: true, value: { ref, values: Object.freeze({ ...values }) } };
}

function manifest(
  ref: AeliqoInputRef,
  tagName: `aeliqo-${string}`,
  role: AeliqoInputManifest['role'],
  namedParts: readonly string[],
  events: readonly string[],
  configKeys: readonly string[],
  resolver: (input: unknown) => AeliqoInputOutcome<AeliqoInputConfig>,
): AeliqoInputManifest {
  return { ref, tagName, role, namedParts, events, configKeys, resolveConfig: resolver };
}

const commonKeys = ['label', 'description', 'required', 'disabled', 'readOnly', 'name'] as const;
const commonValidators = {
  label: (value: unknown) => stringField(value, 512),
  description: (value: unknown) => stringField(value, 2048),
  required: booleanField,
  disabled: booleanField,
  readOnly: booleanField,
  name: (value: unknown) => stringField(value, 128),
} satisfies Readonly<Record<string, Validator>>;
const withCommon = (keys: readonly string[]): readonly string[] => [...commonKeys, ...keys];
const merged = (validators: Readonly<Record<string, Validator>>): Readonly<Record<string, Validator>> => ({
  ...commonValidators,
  ...validators,
});

const selectValidators = {
  value: (value: unknown) => stringField(value, 256),
  emptyLabel: (value: unknown) => stringField(value, 256),
};
const numericValidators = {
  value: (value: unknown) => stringField(value, 512),
  min: (value: unknown) => stringField(value, 512),
  max: (value: unknown) => stringField(value, 512),
  step: (value: unknown) => stringField(value, 128),
};

export const AELIQO_INPUT_MANIFESTS: readonly AeliqoInputManifest[] = [
  manifest(
    AELIQO_INPUT_REFS.textField,
    'aeliqo-text-field',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'placeholder', 'autocomplete', 'inputType']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.textField,
        withCommon(['value', 'defaultValue', 'placeholder', 'autocomplete', 'inputType']),
        input,
        merged({
          value: (value) => stringField(value, 16_384),
          defaultValue: (value) => stringField(value, 16_384),
          placeholder: (value) => stringField(value, 1024),
          autocomplete: (value) => stringField(value, 128),
          inputType: enumField([
            'text',
            'search',
            'url',
            'tel',
            'email',
            'password',
            'date',
            'month',
            'week',
            'time',
            'datetime-local',
            'number',
          ]),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.textArea,
    'aeliqo-text-area',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'rows']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.textArea,
        withCommon(['value', 'defaultValue', 'rows']),
        input,
        merged({
          value: (value) => stringField(value, 65_536),
          defaultValue: (value) => stringField(value, 65_536),
          rows: (value) => finiteField(value, 1, 100),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.numberField,
    'aeliqo-number-field',
    'input',
    ['field', 'label', 'input', 'unit', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'min', 'max', 'step', 'unit']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.numberField,
        withCommon(['value', 'defaultValue', 'min', 'max', 'step', 'unit']),
        input,
        merged(numericValidators),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.checkbox,
    'aeliqo-checkbox',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-validation'],
    withCommon(['checked', 'defaultChecked', 'indeterminate', 'value']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.checkbox,
        withCommon(['checked', 'defaultChecked', 'indeterminate', 'value']),
        input,
        merged({
          checked: booleanField,
          defaultChecked: booleanField,
          indeterminate: booleanField,
          value: (value) => requiredString(value, 256),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.radioGroup,
    'aeliqo-radio-group',
    'input',
    ['field', 'label', 'option', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'orientation']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.radioGroup,
        withCommon(['value', 'defaultValue', 'orientation']),
        input,
        merged({
          value: (value) => stringField(value, 256),
          defaultValue: (value) => stringField(value, 256),
          orientation: enumField(['horizontal', 'vertical']),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.switch,
    'aeliqo-switch',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-validation'],
    withCommon(['checked', 'defaultChecked', 'value']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.switch,
        withCommon(['checked', 'defaultChecked', 'value']),
        input,
        merged({ checked: booleanField, defaultChecked: booleanField, value: (value) => requiredString(value, 256) }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.select,
    'aeliqo-select',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'emptyLabel']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.select,
        withCommon(['value', 'defaultValue', 'emptyLabel']),
        input,
        merged(selectValidators),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.combobox,
    'aeliqo-combobox',
    'input',
    ['field', 'label', 'input', 'listbox', 'option', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'query', 'minQueryLength']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.combobox,
        withCommon(['value', 'defaultValue', 'query', 'minQueryLength']),
        input,
        merged({
          value: (value) => stringField(value, 256),
          defaultValue: (value) => stringField(value, 256),
          query: (value) => stringField(value, 1024),
          minQueryLength: (value) => finiteField(value, 0, 256),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.dateField,
    'aeliqo-date-field',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'min', 'max', 'calendar']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.dateField,
        withCommon(['value', 'defaultValue', 'min', 'max', 'calendar']),
        input,
        merged({
          value: (value) => stringField(value, 10),
          defaultValue: (value) => stringField(value, 10),
          min: (value) => stringField(value, 10),
          max: (value) => stringField(value, 10),
          calendar: enumField(['gregory']),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.dateRange,
    'aeliqo-date-range',
    'input',
    ['field', 'label', 'input', 'start-label', 'end-label', 'policy', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['start', 'end', 'boundary', 'timezone', 'calendar']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.dateRange,
        withCommon(['start', 'end', 'boundary', 'timezone', 'calendar']),
        input,
        merged({
          start: (value) => stringField(value, 10),
          end: (value) => stringField(value, 10),
          boundary: enumField(['inclusive', 'exclusive']),
          timezone: enumField(['calendar']),
          calendar: enumField(['gregory']),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.slider,
    'aeliqo-slider',
    'input',
    ['field', 'label', 'input', 'text-input', 'unit', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'min', 'max', 'step', 'unit']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.slider,
        withCommon(['value', 'defaultValue', 'min', 'max', 'step', 'unit']),
        input,
        merged({
          value: (value) => finiteField(value),
          defaultValue: (value) => finiteField(value),
          min: (value) => finiteField(value),
          max: (value) => finiteField(value),
          step: (value) => finiteField(value, Number.MIN_VALUE),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.searchField,
    'aeliqo-search-field',
    'input',
    ['field', 'label', 'input', 'description', 'error'],
    ['aeliqo-input-change', 'aeliqo-search', 'aeliqo-validation'],
    withCommon(['value', 'defaultValue', 'queryOnInput', 'debounceMs']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.searchField,
        withCommon(['value', 'defaultValue', 'queryOnInput', 'debounceMs']),
        input,
        merged({
          value: (value) => stringField(value, 16_384),
          defaultValue: (value) => stringField(value, 16_384),
          queryOnInput: booleanField,
          debounceMs: (value) => finiteField(value, 0, 10_000),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.fileInput,
    'aeliqo-file-input',
    'input',
    ['field', 'label', 'input', 'files', 'description', 'error'],
    ['aeliqo-file-change', 'aeliqo-validation'],
    withCommon(['accept', 'multiple', 'capture', 'maxFiles', 'maxBytes']),
    (input) =>
      validate(
        AELIQO_INPUT_REFS.fileInput,
        withCommon(['accept', 'multiple', 'capture', 'maxFiles', 'maxBytes']),
        input,
        merged({
          accept: (value) => stringField(value, 1024),
          multiple: booleanField,
          capture: (value) => stringField(value, 64),
          maxFiles: (value) => finiteField(value, 0, 500),
          maxBytes: (value) => finiteField(value, 0, 1_000_000_000),
        }),
      ),
  ),
  manifest(
    AELIQO_INPUT_REFS.fieldGroup,
    'aeliqo-field-group',
    'structure',
    ['group', 'legend', 'description', 'error'],
    [],
    ['legend', 'description', 'error', 'disabled'],
    (input) =>
      validate(AELIQO_INPUT_REFS.fieldGroup, ['legend', 'description', 'error', 'disabled'], input, {
        legend: (value) => stringField(value, 512),
        description: (value) => stringField(value, 2048),
        error: (value) => stringField(value, 2048),
        disabled: booleanField,
      }),
  ),
  manifest(
    AELIQO_INPUT_REFS.form,
    'aeliqo-form',
    'structure',
    ['form', 'error-summary', 'submit'],
    ['aeliqo-form-submit', 'aeliqo-form-reset'],
    ['label', 'noValidate', 'submitLabel'],
    (input) =>
      validate(AELIQO_INPUT_REFS.form, ['label', 'noValidate', 'submitLabel'], input, {
        label: (value) => stringField(value, 512),
        noValidate: booleanField,
        submitLabel: (value) => stringField(value, 256),
      }),
  ),
];

export function getAeliqoInputManifest(id: AeliqoInputId): AeliqoInputManifest | undefined {
  return AELIQO_INPUT_MANIFESTS.find((candidate) => candidate.ref.id === id);
}
