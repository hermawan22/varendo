import { validateScalar, type Outcome, type Scalar, type SemanticType } from '@varendo/core';
import { VARENDO_INPUT_REFS, type VarendoInputId } from '../input/manifest.js';
import type { VarendoInputBinding, VarendoInputDraftBinding } from './input-registry-types.js';
import { NUMERIC_TYPE_VALUES } from './data-registry-common.js';
import {
  boundedId,
  boundedText,
  clone,
  commonConfig,
  copyJson,
  dateValue,
  fail,
  fieldBinding,
  finiteNumber,
  jsonRecord,
  numberValue,
  numericText,
  optionList,
  record,
  typeValue,
  versionRef,
} from './input-registry-support.js';

type ConfigValidator = (config: Record<string, unknown>) => boolean;

interface ConfigFields {
  readonly text: (key: string, max: number) => boolean;
  readonly bool: (key: string) => boolean;
  readonly enum: (key: string, allowed: readonly string[]) => boolean;
}

interface InputTargets {
  readonly draft?: VarendoInputDraftBinding;
  readonly range?: {
    readonly start: VarendoInputDraftBinding;
    readonly end: VarendoInputDraftBinding;
  };
}

const DRAFT_INPUTS = new Set([
  'input.text-field',
  'input.text-area',
  'input.number-field',
  'input.checkbox',
  'input.radio-group',
  'input.switch',
  'input.select',
  'input.combobox',
  'input.date-field',
  'input.slider',
  'input.search-field',
]);

const NUMERIC_INPUTS = new Set(['input.number-field', 'input.slider']);
const BOOLEAN_INPUTS = new Set(['input.checkbox', 'input.switch']);
const TEXT_VALUE_INPUTS = new Set([
  'input.text-field',
  'input.text-area',
  'input.search-field',
  'input.date-field',
  'input.radio-group',
  'input.select',
  'input.combobox',
]);

const CONFIG_KEYS: Record<VarendoInputId, readonly string[]> = {
  'input.text-field': ['value', 'defaultValue', 'placeholder', 'autocomplete', 'inputType'],
  'input.text-area': ['value', 'defaultValue', 'rows'],
  'input.number-field': ['value', 'defaultValue', 'min', 'max', 'step', 'unit'],
  'input.checkbox': ['checked', 'defaultChecked', 'indeterminate', 'value'],
  'input.radio-group': ['value', 'defaultValue', 'orientation', 'options'],
  'input.switch': ['checked', 'defaultChecked', 'value'],
  'input.select': ['value', 'defaultValue', 'emptyLabel', 'options'],
  'input.combobox': ['value', 'defaultValue', 'query', 'minQueryLength', 'placeholder', 'options'],
  'input.date-field': ['value', 'defaultValue', 'min', 'max', 'calendar'],
  'input.date-range': ['start', 'end', 'defaultStart', 'defaultEnd', 'boundary', 'timezone', 'calendar'],
  'input.slider': ['value', 'defaultValue', 'min', 'max', 'step', 'unit'],
  'input.search-field': ['value', 'defaultValue', 'queryOnInput', 'debounceMs', 'placeholder', 'autocomplete'],
  'input.file-input': ['accept', 'multiple', 'capture', 'maxFiles', 'maxBytes'],
  'input.field-group': ['legend', 'description', 'error', 'disabled'],
  'input.form': ['label', 'noValidate', 'submitLabel'],
};

function configFields(config: Record<string, unknown>): ConfigFields {
  const has = (key: string): boolean => Object.hasOwn(config, key);
  return {
    text: (key, max) => !has(key) || boundedText(config[key], max),
    bool: (key) => !has(key) || typeof config[key] === 'boolean',
    enum: (key, allowed) => !has(key) || (typeof config[key] === 'string' && allowed.includes(config[key] as string)),
  };
}

function validTextField(fields: ConfigFields): boolean {
  return (
    fields.text('value', 16_384) &&
    fields.text('defaultValue', 16_384) &&
    fields.text('placeholder', 1_024) &&
    fields.text('autocomplete', 128) &&
    fields.enum('inputType', [
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
    ])
  );
}

function validTextArea(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return fields.text('value', 65_536) && fields.text('defaultValue', 65_536) && finiteNumber(config.rows, 1, 100);
}

function validNumberField(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    numericText(config.value) &&
    numericText(config.defaultValue) &&
    numericText(config.min) &&
    numericText(config.max) &&
    numericText(config.step) &&
    fields.text('unit', 128)
  );
}

function validBooleanControl(fields: ConfigFields): boolean {
  return (
    fields.bool('checked') && fields.bool('defaultChecked') && fields.bool('indeterminate') && fields.text('value', 256)
  );
}

function validOptionList(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return fields.text('value', 256) && fields.text('defaultValue', 256) && optionList(config.options);
}

function validRadioOrientation(fields: ConfigFields): boolean {
  return fields.enum('orientation', ['horizontal', 'vertical']);
}

function validSelectEmptyLabel(fields: ConfigFields): boolean {
  return fields.text('emptyLabel', 256);
}

function validCombobox(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    fields.text('query', 1_024) && finiteNumber(config.minQueryLength, 0, 256) && fields.text('placeholder', 1_024)
  );
}

function validDateField(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    fields.text('value', 10) &&
    fields.text('defaultValue', 10) &&
    dateValue(config.value) &&
    dateValue(config.defaultValue) &&
    dateValue(config.min) &&
    dateValue(config.max) &&
    fields.enum('calendar', ['gregory'])
  );
}

function validDateRange(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    dateValue(config.start) &&
    dateValue(config.end) &&
    dateValue(config.defaultStart) &&
    dateValue(config.defaultEnd) &&
    fields.enum('boundary', ['inclusive', 'exclusive']) &&
    fields.enum('timezone', ['calendar']) &&
    fields.enum('calendar', ['gregory'])
  );
}

function validSlider(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    finiteNumber(config.value) &&
    finiteNumber(config.defaultValue) &&
    finiteNumber(config.min) &&
    finiteNumber(config.max) &&
    finiteNumber(config.step, Number.MIN_VALUE) &&
    fields.text('unit', 128)
  );
}

function validSearchField(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    fields.text('value', 16_384) &&
    fields.text('defaultValue', 16_384) &&
    fields.bool('queryOnInput') &&
    finiteNumber(config.debounceMs, 0, 10_000) &&
    fields.text('placeholder', 1_024) &&
    fields.text('autocomplete', 128)
  );
}

function validFileInput(config: Record<string, unknown>, fields: ConfigFields): boolean {
  return (
    fields.text('accept', 1_024) &&
    fields.bool('multiple') &&
    fields.text('capture', 64) &&
    finiteNumber(config.maxFiles, 0, 500) &&
    finiteNumber(config.maxBytes, 0, 1_000_000_000)
  );
}

function validFieldGroup(fields: ConfigFields): boolean {
  return (
    fields.text('legend', 512) &&
    fields.text('description', 2_048) &&
    fields.text('error', 2_048) &&
    fields.bool('disabled')
  );
}

function validForm(fields: ConfigFields): boolean {
  return fields.text('label', 512) && fields.bool('noValidate') && fields.text('submitLabel', 256);
}

const CONFIG_VALIDATORS: Record<VarendoInputId, ConfigValidator> = {
  'input.text-field': (config) => validTextField(configFields(config)),
  'input.text-area': (config) => validTextArea(config, configFields(config)),
  'input.number-field': (config) => validNumberField(config, configFields(config)),
  'input.checkbox': (config) => validBooleanControl(configFields(config)),
  'input.radio-group': (config) => validRadioOrientation(configFields(config)),
  'input.switch': (config) => validBooleanControl(configFields(config)),
  'input.select': (config) => validSelectEmptyLabel(configFields(config)),
  'input.combobox': (config) => validCombobox(config, configFields(config)),
  'input.date-field': (config) => validDateField(config, configFields(config)),
  'input.date-range': (config) => validDateRange(config, configFields(config)),
  'input.slider': (config) => validSlider(config, configFields(config)),
  'input.search-field': (config) => validSearchField(config, configFields(config)),
  'input.file-input': (config) => validFileInput(config, configFields(config)),
  'input.field-group': (config) => validFieldGroup(configFields(config)),
  'input.form': (config) => validForm(configFields(config)),
};

const CONFIG_ERRORS: Record<VarendoInputId, string> = {
  'input.text-field': 'Text field configuration is invalid.',
  'input.text-area': 'Text area configuration is invalid.',
  'input.number-field': 'Number field configuration is invalid.',
  'input.checkbox': 'Boolean control configuration is invalid.',
  'input.radio-group': 'Radio orientation is invalid.',
  'input.switch': 'Boolean control configuration is invalid.',
  'input.select': 'Select emptyLabel is invalid.',
  'input.combobox': 'Combobox configuration is invalid.',
  'input.date-field': 'Date field configuration is invalid.',
  'input.date-range': 'Date range configuration is invalid.',
  'input.slider': 'Slider configuration is invalid.',
  'input.search-field': 'Search field configuration is invalid.',
  'input.file-input': 'File input configuration is invalid.',
  'input.field-group': 'Field group configuration is invalid.',
  'input.form': 'Form configuration is invalid.',
};

function validateConfiguration(ref: VarendoInputId, config: Record<string, unknown>): Outcome<void> {
  const structural = ref === 'input.field-group' || ref === 'input.form';
  const requireLabel = ref !== 'input.field-group';
  if (!commonConfig(config, CONFIG_KEYS[ref], requireLabel, !structural))
    return fail('binding', `${ref} contains an unknown or malformed common configuration field.`);
  if (
    ['input.radio-group', 'input.select', 'input.combobox'].includes(ref) &&
    !validOptionList(config, configFields(config))
  )
    return fail('binding', `${ref} requires a bounded registered option list.`);
  if (!CONFIG_VALIDATORS[ref](config)) return fail('binding', CONFIG_ERRORS[ref]);
  return { ok: true, value: undefined };
}

function invalidNumericTarget(ref: VarendoInputId, type: SemanticType['value']): boolean {
  return NUMERIC_INPUTS.has(ref) && !NUMERIC_TYPE_VALUES.has(type);
}

function invalidTextTarget(ref: VarendoInputId, type: SemanticType['value']): boolean {
  if (ref === 'input.date-field' || ref === 'input.date-range') return false;
  if (NUMERIC_INPUTS.has(ref) || BOOLEAN_INPUTS.has(ref)) return false;
  return type !== 'text' && !(ref === 'input.text-field' && type === 'instant');
}

function semanticTypeForTarget(ref: VarendoInputId, draft: VarendoInputDraftBinding): Outcome<void> {
  const type = draft.type.value;
  if (invalidNumericTarget(ref, type)) return fail('binding', `${ref} requires a numeric semantic type.`);
  if (invalidTextTarget(ref, type)) return fail('binding', `${ref} requires a text semantic type.`);
  if (BOOLEAN_INPUTS.has(ref) && type !== 'boolean') return fail('binding', `${ref} requires a boolean semantic type.`);
  if (ref === 'input.date-field' && type !== 'date')
    return fail('binding', 'A date field requires the date semantic type.');
  return { ok: true, value: undefined };
}

function draftBinding(binding: VarendoInputBinding): Outcome<VarendoInputDraftBinding | undefined> {
  if (binding.draft === undefined) return { ok: true, value: undefined };
  return fieldBinding(binding.draft, 'draft');
}

function rangeBinding(binding: VarendoInputBinding): Outcome<InputTargets['range']> {
  if (binding.range === undefined) return { ok: true, value: undefined };
  const start = fieldBinding(binding.range.start, 'range.start');
  if (!start.ok) return start;
  const end = fieldBinding(binding.range.end, 'range.end');
  if (!end.ok) return end;
  return { ok: true, value: { start: start.value, end: end.value } };
}

function validateTargetPresence(
  ref: VarendoInputId,
  draft: VarendoInputDraftBinding | undefined,
  range: InputTargets['range'],
): Outcome<void> {
  if (DRAFT_INPUTS.has(ref) && draft === undefined)
    return fail('binding', `${ref} requires a registered draft target.`);
  if (ref === 'input.date-range' && range === undefined)
    return fail('binding', 'A date range requires registered start and end field mappings.');
  if (ref !== 'input.date-range' && range !== undefined)
    return fail('binding', 'Only a date range may declare two field mappings.');
  return { ok: true, value: undefined };
}

function validateRangeType(ref: VarendoInputId, range: InputTargets['range']): Outcome<void> {
  if (ref !== 'input.date-range') return { ok: true, value: undefined };
  if (!validDateRangeTargets(range)) return fail('binding', 'Date range mappings must use the date semantic type.');
  if (!sameRangeTarget(range))
    return fail('binding', 'Date range start and end mappings must target the same registered entity revision.');
  return { ok: true, value: undefined };
}

function validateDraftType(ref: VarendoInputId, draft: VarendoInputDraftBinding | undefined): Outcome<void> {
  if (draft === undefined) return { ok: true, value: undefined };
  return semanticTypeForTarget(ref, draft);
}

function validatedTargets(binding: VarendoInputBinding, ref: VarendoInputId): Outcome<InputTargets> {
  const draft = draftBinding(binding);
  if (!draft.ok) return draft;
  const range = rangeBinding(binding);
  if (!range.ok) return range;
  const presence = validateTargetPresence(ref, draft.value, range.value);
  if (!presence.ok) return presence;
  const validRange = validateRangeType(ref, range.value);
  if (!validRange.ok) return validRange;
  const validDraftType = validateDraftType(ref, draft.value);
  if (!validDraftType.ok) return validDraftType;
  return {
    ok: true,
    value: {
      ...(draft.value === undefined ? {} : { draft: draft.value }),
      ...(range.value === undefined ? {} : { range: range.value }),
    },
  };
}

function validDateRangeTargets(range: NonNullable<InputTargets['range']> | undefined): boolean {
  return range !== undefined && range.start.type.value === 'date' && range.end.type.value === 'date';
}

function sameRangeTarget(range: NonNullable<InputTargets['range']> | undefined): boolean {
  return (
    range !== undefined &&
    range.start.entity === range.end.entity &&
    range.start.key === range.end.key &&
    range.start.entityRevision === range.end.entityRevision
  );
}

function draftValueCheck(
  ref: VarendoInputId,
  key: string,
  config: Record<string, unknown>,
  draft: VarendoInputDraftBinding,
): Outcome<Scalar | undefined> {
  if (ref === 'input.number-field') return numberValue(draft.type, config[key]);
  if (TEXT_VALUE_INPUTS.has(ref)) return typeValue(draft.type, config[key]);
  return { ok: true, value: undefined };
}

function validateDraftValues(
  ref: VarendoInputId,
  config: Record<string, unknown>,
  draft: VarendoInputDraftBinding | undefined,
): Outcome<void> {
  if (draft === undefined) return { ok: true, value: undefined };
  for (const key of ['value', 'defaultValue']) {
    const checked = draftValueCheck(ref, key, config, draft);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateDateRangeValues(ref: VarendoInputId, config: Record<string, unknown>): Outcome<void> {
  if (
    ref === 'input.date-range' &&
    ((config.start !== undefined && !dateValue(config.start)) || (config.end !== undefined && !dateValue(config.end)))
  )
    return fail('binding', 'Date range values must be valid calendar dates.');
  return { ok: true, value: undefined };
}

function unitMatches(type: SemanticType, unit: unknown): boolean {
  const registered = type.unit?.symbol;
  if (registered === undefined) return unit === undefined || unit === '';
  return unit === registered;
}

function sliderValue(value: unknown, type: SemanticType): Outcome<void> {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fail('binding', 'Slider numeric bounds must be finite numbers.');
  if (type.value === 'integer' && !Number.isSafeInteger(value))
    return fail('binding', 'An integer slider requires safe integer values.');
  if (!validateScalar(value, type).ok)
    return fail('binding', 'A slider value or bound does not satisfy its registered semantic type.');
  return { ok: true, value: undefined };
}

const BOUNDED_VALUE_KEYS = ['value', 'defaultValue', 'min', 'max', 'step'] as const;

function validateSliderDraft(config: Record<string, unknown>, draft: VarendoInputDraftBinding): Outcome<void> {
  if (!unitMatches(draft.type, config.unit))
    return fail('binding', 'Slider unit must match the registered semantic unit exactly.');
  for (const key of BOUNDED_VALUE_KEYS) {
    if (config[key] === undefined) continue;
    const checked = sliderValue(config[key], draft.type);
    if (!checked.ok) return checked;
  }
  return { ok: true, value: undefined };
}

function validateNumberDraft(config: Record<string, unknown>, draft: VarendoInputDraftBinding): Outcome<void> {
  if (!unitMatches(draft.type, config.unit))
    return fail('binding', 'Number field unit must match the registered semantic unit exactly.');
  for (const key of BOUNDED_VALUE_KEYS) {
    if (config[key] === undefined || config[key] === '') continue;
    if (!numberValue(draft.type, config[key]).ok)
      return fail('binding', `Number field ${key} does not satisfy its registered semantic type.`);
  }
  return { ok: true, value: undefined };
}

function validateTypedDraft(
  ref: VarendoInputId,
  config: Record<string, unknown>,
  draft: VarendoInputDraftBinding | undefined,
): Outcome<void> {
  if (draft === undefined) return { ok: true, value: undefined };
  if (ref === 'input.slider') return validateSliderDraft(config, draft);
  if (ref === 'input.number-field') return validateNumberDraft(config, draft);
  return { ok: true, value: undefined };
}

function validateDraftSemantics(
  ref: VarendoInputId,
  config: Record<string, unknown>,
  draft: VarendoInputDraftBinding | undefined,
): Outcome<void> {
  const values = validateDraftValues(ref, config, draft);
  if (!values.ok) return values;
  const range = validateDateRangeValues(ref, config);
  if (!range.ok) return range;
  return validateTypedDraft(ref, config, draft);
}

function validateActionBinding(binding: VarendoInputBinding, ref: VarendoInputId): Outcome<void> {
  if (binding.action !== undefined && (!versionRef(binding.action.action) || !jsonRecord(binding.action.input)))
    return fail('binding', 'A registered action must contain a versioned action and bounded JSON parameters.');
  if (ref === 'input.form' && binding.action === undefined)
    return fail('binding', 'A form requires a host-registered action.');
  if (ref !== 'input.form' && binding.action !== undefined)
    return fail('binding', 'Only a form may declare an action binding.');
  return { ok: true, value: undefined };
}

function validateFileBinding(binding: VarendoInputBinding, ref: VarendoInputId): Outcome<void> {
  if (binding.file !== undefined && !versionRef(binding.file.schema))
    return fail('binding', 'A file input requires a registered metadata schema.');
  if (ref === 'input.file-input' && binding.file === undefined)
    return fail('binding', 'A file input requires a registered metadata schema.');
  if (ref !== 'input.file-input' && binding.file !== undefined)
    return fail('binding', 'Only a file input may declare a metadata schema.');
  return { ok: true, value: undefined };
}

function validateEffects(binding: VarendoInputBinding, ref: VarendoInputId): Outcome<void> {
  const action = validateActionBinding(binding, ref);
  if (!action.ok) return action;
  return validateFileBinding(binding, ref);
}

function snapshotBinding(
  binding: VarendoInputBinding,
  config: Record<string, unknown>,
  targets: InputTargets,
): Outcome<VarendoInputBinding> {
  const copied = copyJson({
    id: binding.id,
    ref: binding.ref,
    config,
    ...(targets.draft === undefined ? {} : { draft: targets.draft }),
    ...(targets.range === undefined ? {} : { range: targets.range }),
    ...(binding.action === undefined ? {} : { action: binding.action }),
    ...(binding.file === undefined ? {} : { file: binding.file }),
  });
  if (copied === undefined) return fail('binding', 'An input binding must be bounded JSON data.');
  return { ok: true, value: clone(copied as VarendoInputBinding) };
}

export function validateInputBinding(binding: VarendoInputBinding): Outcome<VarendoInputBinding> {
  const config = record(binding.config);
  if (
    !boundedId(binding.id) ||
    config === undefined ||
    !versionRef(binding.ref) ||
    !Object.values(VARENDO_INPUT_REFS).some((ref) => ref.id === binding.ref.id && ref.revision === binding.ref.revision)
  )
    return fail('binding', 'An input binding has an invalid identifier or primitive reference.');
  const ref = binding.ref.id as VarendoInputId;
  const targets = validatedTargets(binding, ref);
  if (!targets.ok) return targets;
  const configResult = validateConfiguration(ref, config);
  if (!configResult.ok) return configResult;
  const semantics = validateDraftSemantics(ref, config, targets.value.draft);
  if (!semantics.ok) return semantics;
  const effects = validateEffects(binding, ref);
  if (!effects.ok) return effects;
  return snapshotBinding(binding, config, targets.value);
}
