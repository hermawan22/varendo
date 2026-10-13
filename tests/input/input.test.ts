import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VARENDO_INPUT_MANIFESTS,
  VARENDO_INPUT_REFS,
  getVarendoInputManifest,
} from '../../packages/web/src/input/manifest.js';
import { VarendoCheckboxElement } from '../../packages/web/src/input/checkbox.js';
import { VarendoComboboxElement } from '../../packages/web/src/input/combobox.js';
import { VarendoDateFieldElement } from '../../packages/web/src/input/date-field.js';
import { VarendoDateRangeElement } from '../../packages/web/src/input/date-range.js';
import { VarendoFieldGroupElement } from '../../packages/web/src/input/field-group.js';
import { VarendoFileInputElement } from '../../packages/web/src/input/file-input.js';
import { VarendoFormElement } from '../../packages/web/src/input/form.js';
import { VarendoNumberFieldElement } from '../../packages/web/src/input/number-field.js';
import { VarendoRadioGroupElement } from '../../packages/web/src/input/radio-group.js';
import { VarendoSearchFieldElement } from '../../packages/web/src/input/search-field.js';
import { VarendoSelectElement } from '../../packages/web/src/input/select.js';
import { VarendoSliderElement } from '../../packages/web/src/input/slider.js';
import { VarendoSwitchElement } from '../../packages/web/src/input/switch.js';
import { VarendoTextAreaElement } from '../../packages/web/src/input/text-area.js';
import { VarendoTextFieldElement } from '../../packages/web/src/input/text-field.js';
import { dateOnly, formatLocalizedDecimal, parseLocalizedDecimal } from '../../packages/web/src/input/locale.js';

describe('input primitive manifests', () => {
  it('exposes all 15 required entries and browser-free constructors', () => {
    expect(VARENDO_INPUT_MANIFESTS).toHaveLength(15);
    expect(new Set(VARENDO_INPUT_MANIFESTS.map((manifest) => manifest.ref.id)).size).toBe(15);
    expect(VARENDO_INPUT_MANIFESTS.map((manifest) => manifest.tagName)).toEqual([
      'varendo-text-field',
      'varendo-text-area',
      'varendo-number-field',
      'varendo-checkbox',
      'varendo-radio-group',
      'varendo-switch',
      'varendo-select',
      'varendo-combobox',
      'varendo-date-field',
      'varendo-date-range',
      'varendo-slider',
      'varendo-search-field',
      'varendo-file-input',
      'varendo-field-group',
      'varendo-form',
    ]);
    expect([
      VarendoTextFieldElement,
      VarendoTextAreaElement,
      VarendoNumberFieldElement,
      VarendoCheckboxElement,
      VarendoRadioGroupElement,
      VarendoSwitchElement,
      VarendoSelectElement,
      VarendoComboboxElement,
      VarendoDateFieldElement,
      VarendoDateRangeElement,
      VarendoSliderElement,
      VarendoSearchFieldElement,
      VarendoFileInputElement,
      VarendoFieldGroupElement,
      VarendoFormElement,
    ]).toHaveLength(15);
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
  });

  it('rejects unknown executable fields and freezes accepted configuration', () => {
    const text = getVarendoInputManifest(VARENDO_INPUT_REFS.textField.id)!;
    expect(text.resolveConfig({ label: 'Name', value: 'Ada', onInput: 'alert(1)' })).toMatchObject({ ok: false });
    const accepted = text.resolveConfig({ label: 'Name', value: 'Ada' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(Object.isFrozen(accepted.value.values)).toBe(true);
    const dateRange = getVarendoInputManifest(VARENDO_INPUT_REFS.dateRange.id)!;
    expect(
      dateRange.resolveConfig({ start: '2026-01-01', end: '2026-01-03', boundary: 'exclusive', timezone: 'local' }),
    ).toMatchObject({ ok: false });
  });

  it('keeps every input module independent of runtime, region and provider code', () => {
    const root = resolve(import.meta.dirname, '../../packages/web/src/input');
    for (const file of [
      'base.ts',
      'events.ts',
      'locale.ts',
      'options.ts',
      'text-control.ts',
      'text-field.ts',
      'text-area.ts',
      'number-field.ts',
      'checkbox.ts',
      'radio-group.ts',
      'switch.ts',
      'select.ts',
      'combobox.ts',
      'date-field.ts',
      'date-range.ts',
      'slider.ts',
      'search-field.ts',
      'file-input.ts',
      'field-group.ts',
      'form.ts',
      'manifest.ts',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(
        /from\s+["'][^"']*(?:runtime|region|agent|provider|mcp|database|filesystem|react|d3)/iu,
      );
    }
  });
});

describe('input locale and date semantics', () => {
  it('preserves exact decimal strings through locale separators', () => {
    expect(parseLocalizedDecimal('1.234.567,890', 'de-DE')).toEqual({ canonical: '1234567.890', valid: true });
    expect(parseLocalizedDecimal('12,345,678,901,234,567,890.123', 'en-US')).toEqual({
      canonical: '12345678901234567890.123',
      valid: true,
    });
    expect(formatLocalizedDecimal('12345678901234567890.123', 'de-DE')).toBe('12.345.678.901.234.567.890,123');
    expect(parseLocalizedDecimal('.5', 'en-US')).toEqual({ canonical: '0.5', valid: true });
    expect(parseLocalizedDecimal('1,2', 'en-US').valid).toBe(false);
    expect(parseLocalizedDecimal('1 2', 'en-US').valid).toBe(false);
    expect(parseLocalizedDecimal('12,34,567.89', 'en-IN')).toEqual({ canonical: '1234567.89', valid: true });
    expect(parseLocalizedDecimal('123,456,78.9', 'en-IN').valid).toBe(false);
    expect(parseLocalizedDecimal('', 'en-US')).toEqual({ canonical: undefined, valid: true });
    expect(parseLocalizedDecimal('nope', 'en-US').valid).toBe(false);
  });

  it('uses calendar dates without timezone conversion', () => {
    expect(dateOnly('2026-02-28')).toBe('2026-02-28');
    expect(dateOnly('2026-02-29')).toBeUndefined();
    expect(dateOnly('2026-03-01T00:00:00Z')).toBeUndefined();
  });
});
