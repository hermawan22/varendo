import {
  parseWireValue,
  validateScalar,
  type Diagnostic,
  type Intent,
  type Outcome,
  type ReadonlyJsonValue,
  type ResourceDefinition,
  type Scalar,
  type Task,
  type VersionRef,
} from '@varendo/core';
import { AELIQO_INPUT_REFS, type AeliqoInputRef } from '../input/manifest.js';
import type { AeliqoInputBinding, AeliqoInputBindings } from '../region/input-registry.js';
import type { AeliqoFormState } from './types.js';

function failure<T>(code: string, message: string): Outcome<T> {
  const item: Diagnostic = { code, message, retryable: false };
  return { ok: false, diagnostics: [item] };
}

function isJsonValue(value: unknown): value is ReadonlyJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return value !== null && typeof value === 'object' && Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is Readonly<Record<string, ReadonlyJsonValue>> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isJsonValue)
  );
}

type FieldTypeValue = ResourceDefinition['entity']['fields'][number]['type']['value'];

const FIELD_REFS: Readonly<Partial<Record<FieldTypeValue, AeliqoInputRef>>> = {
  boolean: AELIQO_INPUT_REFS.checkbox,
  integer: AELIQO_INPUT_REFS.numberField,
  float: AELIQO_INPUT_REFS.numberField,
  decimal: AELIQO_INPUT_REFS.numberField,
  date: AELIQO_INPUT_REFS.dateField,
};

function fieldRef(value: FieldTypeValue): AeliqoInputRef {
  return FIELD_REFS[value] ?? AELIQO_INPUT_REFS.textField;
}

function defaultConfig(ref: AeliqoInputRef, value: Scalar | undefined): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (ref.id === AELIQO_INPUT_REFS.checkbox.id) return typeof value === 'boolean' ? { defaultChecked: value } : {};
  if (ref.id === AELIQO_INPUT_REFS.numberField.id) {
    const text = numberDefaultValue(value);
    return text === undefined ? {} : { defaultValue: text };
  }
  return typeof value === 'string' ? { defaultValue: value } : {};
}

function numberDefaultValue(value: Scalar): string | undefined {
  if (value !== null && typeof value === 'object') return value.decimal;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function checkedValues(
  resource: ResourceDefinition,
  state: AeliqoFormState,
): Outcome<Readonly<Record<string, Scalar>>> {
  const parsed = parseWireValue(state.values);
  if (!parsed.ok || !isJsonObject(parsed.value))
    return failure('web.form-state.values', 'Form state values must be a bounded JSON object.');
  const raw = parsed.value;
  const fields = new Map(resource.entity.fields.map((field) => [field.id, field]));
  const output: Record<string, Scalar> = {};
  for (const [id, value] of Object.entries(raw)) {
    const field = fields.get(id);
    if (field === undefined) return failure('web.form-state.field', `Form state contains unknown field ${id}.`);
    const checked = validateScalar(value, field.type);
    if (!checked.ok)
      return failure('web.form-state.value', `Form state field ${id} does not satisfy its semantic type.`);
    output[id] = checked.value;
  }
  return { ok: true, value: Object.freeze(output) };
}

export function createFormBindings(
  resource: ResourceDefinition,
  intent: Intent,
  task: Task,
  state: AeliqoFormState,
): Outcome<AeliqoInputBindings> {
  if ((intent.kind !== 'create' && intent.kind !== 'edit') || task.kind !== 'form')
    return failure('web.form-state.intent', 'Form bindings require a compiled create or edit Task.');
  if (!validEntityRevision(state.entityRevision))
    return failure('web.form-state.revision', 'Form state requires a bounded entity revision.');
  const values = checkedValues(resource, state);
  if (!values.ok) return values;
  const editable = editableFields(resource, intent, values.value);
  if (!editable.ok) return editable;
  const key = task.entityKey ?? `new-${task.id}`;
  const inputs = editable.value.map((field) => fieldBinding(resource, field, key, state, values.value));
  const form = formBinding(resource, intent, task.action, values.value);
  return {
    ok: true,
    value: Object.freeze({ revision: `form-${task.revision}`.slice(0, 160), inputs: Object.freeze([form, ...inputs]) }),
  };
}

function validEntityRevision(revision: string): boolean {
  return revision.length > 0 && revision.length <= 160 && !/[\s\u0000-\u001f\u007f]/u.test(revision);
}

function editableFields(
  resource: ResourceDefinition,
  intent: Intent,
  values: Readonly<Record<string, Scalar>>,
): Outcome<readonly ResourceDefinition['entity']['fields'][number][]> {
  const fields = resource.entity.fields.filter((field) => isEditableField(resource, intent, field.id));
  if (fields.length > 31)
    return failure(
      'web.form-state.fields',
      'The standard form recipe supports at most 31 visible fields; group or customize this form.',
    );
  const missing = intent.kind === 'edit' ? fields.find((field) => !Object.hasOwn(values, field.id)) : undefined;
  if (missing !== undefined)
    return failure('web.form-state.missing', `Edit form state is missing current value for ${missing.id}.`);
  return { ok: true, value: fields };
}

function isEditableField(resource: ResourceDefinition, intent: Intent, fieldId: string): boolean {
  if (resource.fieldMetadata[fieldId]?.hidden === true) return false;
  if (intent.kind === 'edit' && resource.entity.identity.includes(fieldId)) return false;
  return true;
}

function fieldBinding(
  resource: ResourceDefinition,
  field: ResourceDefinition['entity']['fields'][number],
  key: string,
  state: AeliqoFormState,
  values: Readonly<Record<string, Scalar>>,
): AeliqoInputBinding {
  const metadata = resource.fieldMetadata[field.id];
  const ref = fieldRef(field.type.value);
  const unit = numberUnit(ref, field.type.unit?.symbol);
  return {
    id: `field-${field.id}`,
    ref,
    config: Object.freeze({
      label: field.label,
      ...(metadata?.description === undefined ? {} : { description: metadata.description }),
      required: !field.type.nullable,
      name: field.id,
      ...unit,
      ...defaultConfig(ref, values[field.id]),
    }),
    draft: {
      entity: resource.entity.id,
      key,
      field: field.id,
      entityRevision: state.entityRevision,
      type: field.type,
    },
  };
}

function numberUnit(ref: AeliqoInputRef, symbol: string | undefined): Record<string, string> {
  if (ref.id !== AELIQO_INPUT_REFS.numberField.id || symbol === undefined) return {};
  return { unit: symbol };
}

function formBinding(
  resource: ResourceDefinition,
  intent: Intent,
  action: VersionRef,
  values: Readonly<Record<string, Scalar>>,
): AeliqoInputBinding {
  const creating = intent.kind === 'create';
  const label = creating ? `Create a record in ${resource.label}` : `Edit a record in ${resource.label}`;
  const submitLabel = creating ? 'Create record' : 'Save changes';
  return {
    id: 'form',
    ref: AELIQO_INPUT_REFS.form,
    config: { label, submitLabel },
    action: { action, input: values },
  };
}
