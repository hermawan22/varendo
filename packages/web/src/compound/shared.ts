import type { Scalar } from '@varendo/core';
import type { TableCell } from '../types.js';

const statusValues = ['ready', 'loading', 'empty', 'partial', 'stale', 'error', 'unavailable'] as const;
type Status = (typeof statusValues)[number];
export const status = (value: unknown): Status =>
  typeof value === 'string' && (statusValues as readonly string[]).includes(value) ? (value as Status) : 'ready';
export const event = <T>(type: string, detail: T, cancelable = true): CustomEvent<T> =>
  new CustomEvent(type, { bubbles: true, composed: true, cancelable, detail: Object.freeze(detail) });
export const MAX_COMPARISON_KEYS = 32;
export const MAX_COMPARISON_METRICS = 64;
export const MAX_BREAKDOWN_GROUPS = 100;
const BUTTON_INPUT_TYPES: ReadonlySet<string> = new Set(['submit', 'reset', 'button', 'image']);
export const bounded = <T>(items: readonly T[], maximum: number): readonly T[] => items.slice(0, maximum);

export function tableCell(value: Scalar | undefined): TableCell {
  if (value === undefined) return 'Not available';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (typeof value === 'object' && !Array.isArray(value) && typeof value.decimal === 'string')
    return { decimal: value.decimal };
  return 'Not available';
}

export type CompoundControl = HTMLElement & {
  readonly name?: string;
  readonly value?: unknown;
  readonly formValue?: string | File | FormData | null;
  checkValidity?: () => boolean;
  reportValidity?: () => boolean;
};

type CompoundWireValue = string | readonly string[];
export type FormDraftValue = Scalar | readonly Scalar[];
export type FormDraftRecord = Record<string, FormDraftValue>;

export function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function isDisabledControl(control: CompoundControl): boolean {
  return control.matches(':disabled') || control.closest('fieldset:disabled') !== null;
}

function fileName(value: unknown): string | undefined {
  return typeof File !== 'undefined' && value instanceof File ? value.name : undefined;
}

function appendWireValue(output: Record<string, CompoundWireValue>, name: string, raw: unknown): void {
  if (raw === undefined || raw === null || name.length === 0) return;
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    for (const [key, value] of raw.entries()) appendWireValue(output, key, value);
    return;
  }
  if (Array.isArray(raw)) {
    for (const value of raw) appendWireValue(output, name, value);
    return;
  }
  const value = fileName(raw) ?? String(raw);
  const existing = output[name];
  if (existing === undefined) output[name] = value;
  else output[name] = [...(Array.isArray(existing) ? existing : [existing]), value];
}

function appendDraftFormData(output: FormDraftRecord, value: FormData): void {
  for (const [name, item] of value.entries()) appendDraftValue(output, name, item);
}

function appendDraftArray(output: FormDraftRecord, name: string, values: readonly unknown[]): void {
  for (const value of values) appendDraftValue(output, name, value);
}

function validDraftScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'object'
  );
}

function appendNamedDraftValue(output: FormDraftRecord, name: string, value: Scalar): void {
  const existing = output[name];
  if (existing === undefined) {
    output[name] = value;
    return;
  }
  const values = Array.isArray(existing) ? existing : [existing];
  output[name] = [...values, value];
}

function appendDraftScalar(output: FormDraftRecord, name: string, raw: unknown): void {
  const value = fileName(raw) ?? raw;
  if (!validDraftScalar(value)) return;
  appendNamedDraftValue(output, name, value);
}

export function appendDraftValue(output: FormDraftRecord, name: string, raw: unknown): void {
  if (raw === undefined || raw === null || name.length === 0) return;
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    appendDraftFormData(output, raw);
    return;
  }
  if (Array.isArray(raw)) {
    appendDraftArray(output, name, raw);
    return;
  }
  appendDraftScalar(output, name, raw);
}

/** DateRange exposes its named FormData through ElementInternals; retain the
 * public boundary values too because ElementInternals does not expose them
 * through the component's formValue receipt. */
export function dateRangeParts(control: CompoundControl, name: string): readonly [string, string] | undefined {
  if (control.localName !== 'varendo-date-range' || control.checkValidity?.() === false) return undefined;
  const start = (control as HTMLElement & { readonly start?: unknown }).start;
  const end = (control as HTMLElement & { readonly end?: unknown }).end;
  return typeof start === 'string' && start.length > 0 && typeof end === 'string' && end.length > 0
    ? ([`${name}[start]`, start] as const)
    : undefined;
}

export function compoundControls(host: HTMLElement): readonly CompoundControl[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, varendo-text-field, varendo-text-area, varendo-number-field, varendo-date-field, varendo-date-range, varendo-search-field, varendo-checkbox, varendo-switch, varendo-radio-group, varendo-select, varendo-combobox, varendo-slider, varendo-file-input',
    ),
  ).filter(
    (control): control is CompoundControl => control.closest('varendo-record-editor, varendo-form-flow') === host,
  );
}

function ignoredWireControl(control: CompoundControl, name: string): boolean {
  if (!name || isDisabledControl(control) || control instanceof HTMLButtonElement) return true;
  if (control instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(control.type)) return true;
  return control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type) && !control.checked;
}

function appendMultipleSelect(
  output: Record<string, CompoundWireValue>,
  control: CompoundControl,
  name: string,
): boolean {
  if (!(control instanceof HTMLSelectElement) || !control.multiple) return false;
  appendWireValue(
    output,
    name,
    [...control.selectedOptions].map((option) => option.value),
  );
  return true;
}

function appendDateRange(output: Record<string, CompoundWireValue>, control: CompoundControl, name: string): boolean {
  const range = dateRangeParts(control, name);
  if (range === undefined) return false;
  appendWireValue(output, range[0], range[1]);
  const end = (control as HTMLElement & { readonly end?: string }).end;
  if (typeof end === 'string') appendWireValue(output, name + '[end]', end);
  return true;
}

function appendControlValue(output: Record<string, CompoundWireValue>, control: CompoundControl, name: string): void {
  if (appendMultipleSelect(output, control, name)) return;
  if (appendDateRange(output, control, name)) return;
  const value = 'formValue' in control ? control.formValue : control.value;
  appendWireValue(output, name, value);
}

function appendCompoundControl(output: Record<string, CompoundWireValue>, control: CompoundControl): void {
  const name = control.getAttribute('name') || control.name || '';
  if (ignoredWireControl(control, name)) return;
  appendControlValue(output, control, name);
}

export function collectCompoundValues(host: HTMLElement): Readonly<Record<string, string | readonly string[]>> {
  const output = nullRecord<CompoundWireValue>();
  for (const control of compoundControls(host)) appendCompoundControl(output, control);
  return output;
}

export function reportCompoundValidity(host: HTMLElement): boolean {
  const controls = compoundControls(host);
  let valid = true;
  for (const control of controls) {
    if (isDisabledControl(control)) continue;
    const check = control.reportValidity ?? control.checkValidity;
    if (check !== undefined && !check.call(control)) valid = false;
  }
  return valid;
}
