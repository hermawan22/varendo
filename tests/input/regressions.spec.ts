import { expect, test } from '@playwright/test';
import type { AeliqoDateRangeElement, AeliqoFormElement } from '../../packages/web/src/input/index.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/input/index.html');
  await page.waitForFunction(() => (window as Window & { aeliqoInputReady?: boolean }).aeliqoInputReady === true);
});

test('DateRange contributes the same endpoints through native and wrapper forms', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const wrapper = document.createElement('aeliqo-form') as AeliqoFormElement;
    const native = document.createElement('form');
    const fields = [wrapper, native].map((form) => {
      const field = document.createElement('aeliqo-date-range') as AeliqoDateRangeElement;
      field.name = 'period';
      field.defaultStart = '2026-09-01';
      field.defaultEnd = '2026-09-08';
      form.append(field);
      document.body.append(form);
      return field;
    });
    const read = () => [wrapper.formData(), new FormData(native)].map((data) => [...(data?.entries() ?? [])]);
    await Promise.all([wrapper.updateComplete, ...fields.map((field) => field.updateComplete)]);
    const initial = read();
    fields.forEach((field) => (field.end = '2026-09-09'));
    await Promise.all(fields.map((field) => field.updateComplete));
    const updated = read();
    fields.forEach((field) => (field.start = '2026-09-10'));
    await Promise.all(fields.map((field) => field.updateComplete));
    const invalid = read();
    wrapper.reset();
    native.reset();
    await Promise.all(fields.map((field) => field.updateComplete));
    const reset = read();
    fields.forEach((field) => (field.disabled = true));
    await Promise.all(fields.map((field) => field.updateComplete));
    const disabled = read();
    fields.forEach((field) => (field.disabled = false));
    await Promise.all(fields.map((field) => field.updateComplete));
    return { initial, updated, invalid, reset, disabled, enabled: read() };
  });
  const initial = [
    ['period[start]', '2026-09-01'],
    ['period[end]', '2026-09-08'],
  ];
  const updated = [
    ['period[start]', '2026-09-01'],
    ['period[end]', '2026-09-09'],
  ];
  expect(result).toEqual({
    initial: [initial, initial],
    updated: [updated, updated],
    invalid: [[], []],
    reset: [initial, initial],
    disabled: [[], []],
    enabled: [initial, initial],
  });
});

for (const method of ['click', 'Enter'] as const) {
  test(`invalid slotted ${method} focuses the Form error summary`, async ({ page }) => {
    await page.evaluate(async () => {
      const form = document.createElement('aeliqo-form') as AeliqoFormElement;
      form.id = 'summary-regression';
      form.innerHTML =
        '<aeliqo-text-field label="Required name" required></aeliqo-text-field><button type="submit">Save</button>';
      document.body.append(form);
      await form.updateComplete;
    });
    const form = page.locator('#summary-regression');
    if (method === 'click') await form.locator('button').click();
    else await form.locator('aeliqo-text-field').locator('input').press('Enter');
    await expect(form.locator('[part=error-summary]')).toBeFocused();
  });
}

test('Form matches native disabled fieldsets including the first legend', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const markup = `<fieldset disabled>
      <legend><input name="first" value="included"><input name="direct" value="excluded" disabled>
        <aeliqo-text-field name="custom-first" default-value="included"></aeliqo-text-field>
        <aeliqo-text-field name="custom-direct" default-value="excluded" disabled></aeliqo-text-field>
        <fieldset disabled><legend><input name="nested-first" value="included">
          <aeliqo-text-field name="custom-nested-first" default-value="included"></aeliqo-text-field></legend>
          <input name="nested-body" value="excluded">
          <aeliqo-text-field name="custom-nested-body" default-value="excluded"></aeliqo-text-field></fieldset>
      </legend>
      <legend><input name="later" value="excluded">
        <aeliqo-text-field name="custom-later" default-value="excluded"></aeliqo-text-field></legend>
      <input name="body" value="excluded">
      <aeliqo-text-field name="custom-body" default-value="excluded"></aeliqo-text-field>
    </fieldset>`;
    const wrapper = document.createElement('aeliqo-form') as AeliqoFormElement;
    const native = document.createElement('form');
    wrapper.innerHTML = markup;
    native.innerHTML = markup;
    document.body.append(wrapper, native);
    await Promise.all([
      wrapper.updateComplete,
      ...[wrapper, native].flatMap((form) =>
        [...form.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>('aeliqo-text-field')].map(
          (field) => field.updateComplete,
        ),
      ),
    ]);
    const entries = [...(wrapper.formData()?.entries() ?? [])];
    const nativeEntries = [...new FormData(native).entries()];
    const enabled = wrapper.querySelector<HTMLInputElement>('[name=first]')!;
    enabled.required = true;
    enabled.value = '';
    let submits = 0;
    wrapper.addEventListener('aeliqo-form-submit', () => {
      submits += 1;
    });
    wrapper.requestSubmit();
    await wrapper.updateComplete;
    const nativeBlocks = submits === 0;
    enabled.value = 'included';
    const custom = wrapper.querySelector<
      HTMLElement & { value: string; required: boolean; updateComplete: Promise<unknown> }
    >('[name=custom-first]')!;
    custom.required = true;
    custom.value = '';
    await custom.updateComplete;
    wrapper.requestSubmit();
    await wrapper.updateComplete;
    return { entries, nativeEntries, submits, nativeBlocks };
  });
  expect([...result.entries].sort()).toEqual(
    [
      ['first', 'included'],
      ['custom-first', 'included'],
      ['nested-first', 'included'],
      ['custom-nested-first', 'included'],
    ].sort(),
  );
  expect([...result.nativeEntries].sort()).toEqual([...result.entries].sort());
  expect(result.nativeBlocks).toBe(true);
  expect(result.submits).toBe(0);
});

test('an outer disabled fieldset excludes an inner first legend outside its own first legend', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const form = document.createElement('aeliqo-form') as AeliqoFormElement;
    form.innerHTML = `<fieldset disabled><legend>Disabled outer group</legend>
      <fieldset disabled><legend><input name="inner-first" required>
        <aeliqo-text-field name="custom-inner-first" required></aeliqo-text-field></legend></fieldset>
      </fieldset><button type="submit">Save</button>`;
    document.body.append(form);
    const field = form.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>('aeliqo-text-field')!;
    await Promise.all([form.updateComplete, field.updateComplete]);
    let submits = 0;
    form.addEventListener('aeliqo-form-submit', () => {
      submits += 1;
    });
    const entries = [...(form.formData()?.entries() ?? [])];
    const valid = form.checkValidity();
    const reported = form.reportValidity();
    form.requestSubmit();
    await form.updateComplete;
    return { entries, submits, valid, reported };
  });
  expect(result).toEqual({ entries: [], submits: 1, valid: true, reported: true });
});

test('a result queued before a same-turn host replacement emits no stale validation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    type Field = HTMLElement & {
      value: string;
      error: string;
      validationState: string;
      updateComplete: Promise<unknown>;
      validator: (value: unknown, signal: AbortSignal) => Promise<boolean | string>;
    };
    const outcomes: Array<{
      kind: string;
      replacement: string;
      validResult: boolean;
      states: string[];
      error: string;
      state: string;
    }> = [];
    for (const kind of ['number-field', 'select']) {
      for (const replacement of ['value', 'validator']) {
        for (const validResult of [false, true]) {
          const field = document.createElement(`aeliqo-${kind}`) as Field;
          Object.assign(field, {
            options: [
              { value: 'old', label: 'Old' },
              { value: 'new', label: 'New' },
            ],
          });
          let finish: (value: boolean | string) => void = () => {};
          field.validator = () =>
            new Promise((resolve) => {
              finish = resolve;
            });
          document.body.append(field);
          await field.updateComplete;
          const input = field.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>('[part=input]')!;
          input.value = kind === 'number-field' ? '1' : 'old';
          input.dispatchEvent(new Event(kind === 'select' ? 'change' : 'input', { bubbles: true }));
          await field.updateComplete;
          const states: string[] = [];
          field.addEventListener('aeliqo-validation', (event) =>
            states.push((event as CustomEvent<{ state: string }>).detail.state),
          );
          finish(validResult ? true : 'Old value invalid');
          if (replacement === 'validator') field.validator = async () => true;
          else field.value = kind === 'number-field' ? '2' : 'new';
          await new Promise((resolve) => setTimeout(resolve, 0));
          outcomes.push({ kind, replacement, validResult, states, error: field.error, state: field.validationState });
          field.remove();
        }
      }
    }
    return outcomes;
  });
  expect(result).toEqual(
    ['number-field', 'select'].flatMap((kind) =>
      ['value', 'validator'].flatMap((replacement) =>
        [false, true].map((validResult) => ({
          kind,
          replacement,
          validResult,
          states: [],
          error: '',
          state: 'idle',
        })),
      ),
    ),
  );
});

test('NumberField compares signed zero equally while preserving its exact value', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const field = document.createElement('aeliqo-number-field') as HTMLElement & {
      value: string;
      min: string;
      max: string;
      step: string;
      text: string;
      updateComplete: Promise<unknown>;
      checkValidity(): boolean;
    };
    field.min = '0';
    field.max = '0';
    field.step = '0.1';
    document.body.append(field);
    const cases: Array<{ value: string; valid: boolean; text: string }> = [];
    for (const value of ['-0', '-0.00', '0', '0.00', '-0.1', '0.1']) {
      field.value = value;
      await field.updateComplete;
      cases.push({ value: field.value, valid: field.checkValidity(), text: field.text });
    }
    return cases;
  });
  expect(result).toEqual([
    { value: '-0', valid: true, text: '-0' },
    { value: '-0.00', valid: true, text: '-0.00' },
    { value: '0', valid: true, text: '0' },
    { value: '0.00', valid: true, text: '0.00' },
    { value: '-0.1', valid: false, text: '-0.1' },
    { value: '0.1', valid: false, text: '0.1' },
  ]);
});

const validatingTags = [
  'text-field',
  'text-area',
  'search-field',
  'number-field',
  'checkbox',
  'switch',
  'radio-group',
  'select',
  'combobox',
  'date-field',
  'date-range',
  'slider',
  'file-input',
];

for (const tag of validatingTags) {
  test(`${tag} fences validation when its host value or validator changes`, async ({ page }) => {
    const result = await page.evaluate(async (kind) => {
      type Field = HTMLElement & {
        label: string;
        value: string | number;
        checked: boolean;
        start: string;
        end: string;
        selected: readonly unknown[];
        error: string;
        validationState: string;
        updateComplete: Promise<unknown>;
        reset(): void;
        checkValidity(): boolean;
        validator: (value: unknown, signal: AbortSignal) => Promise<boolean | string>;
      };
      const outcomes: Array<{ scenario: string; error: string; state: string; valid: boolean; aborted: boolean }> = [];
      for (const scenario of [
        'current-valid',
        'current-invalid',
        'late-invalid',
        'late-valid',
        'completed-invalid',
        'validator',
        'host-error',
        'reset',
        'disconnect',
      ]) {
        const field = document.createElement(`aeliqo-${kind}`) as Field;
        Object.assign(field, {
          options: [
            { value: 'old', label: 'Old' },
            { value: 'new', label: 'New' },
          ],
          open: true,
          start: '2026-09-01',
          end: '2026-09-03',
          label: 'Validation field',
        });
        let finish: (value: boolean | string) => void = () => {};
        let validationSignal: AbortSignal | undefined;
        field.validator = (_value, signal) => {
          validationSignal = signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        };
        document.body.append(field);
        await field.updateComplete;
        const control = field.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          kind === 'date-range' ? 'input.end' : '[part=input]',
        )!;
        if (kind === 'combobox') (field.shadowRoot!.querySelector('[part=option]') as HTMLElement).click();
        else {
          if (kind === 'file-input') {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['old'], 'old.txt', { lastModified: 1 }));
            (control as HTMLInputElement).files = transfer.files;
          } else if (kind === 'checkbox' || kind === 'switch' || kind === 'radio-group') {
            (control as HTMLInputElement).checked = true;
          } else
            control.value =
              kind === 'date-range'
                ? '2026-09-04'
                : kind === 'date-field'
                  ? '2026-09-01'
                  : kind === 'number-field' || kind === 'slider'
                    ? '1'
                    : 'old';
          const change = ['checkbox', 'switch', 'radio-group', 'select', 'file-input'].includes(kind);
          control.dispatchEvent(new Event(change ? 'change' : 'input', { bubbles: true }));
        }
        await field.updateComplete;
        if (scenario === 'completed-invalid') {
          finish('Old value invalid');
          await new Promise((resolve) => setTimeout(resolve, 0));
          await field.updateComplete;
        }
        if (scenario === 'host-error') field.error = 'Host rejected this record';
        if (scenario.startsWith('current-')) {
          field.label = 'Same value, updated label';
        } else if (scenario === 'validator') field.validator = async () => true;
        else if (scenario === 'reset') field.reset();
        else if (scenario === 'disconnect') field.remove();
        else if (kind === 'checkbox' || kind === 'switch') field.checked = false;
        else if (kind === 'date-range') field.end = '2026-09-08';
        else if (kind === 'file-input') field.selected = [{ name: 'new.txt', size: 1, type: '', lastModified: 2 }];
        else
          field.value =
            kind === 'date-field' ? '2026-09-08' : kind === 'slider' ? 2 : kind === 'number-field' ? '2' : 'new';
        if (scenario !== 'disconnect') await field.updateComplete;
        finish(scenario === 'late-valid' || scenario === 'current-valid' ? true : 'Old value invalid');
        await new Promise((resolve) => setTimeout(resolve, 0));
        outcomes.push({
          scenario,
          error: field.error,
          state: field.validationState,
          valid: field.checkValidity(),
          aborted: validationSignal?.aborted ?? false,
        });
        field.remove();
      }
      return outcomes;
    }, tag);
    expect(result).toEqual([
      { scenario: 'current-valid', error: '', state: 'valid', valid: true, aborted: false },
      { scenario: 'current-invalid', error: 'Old value invalid', state: 'invalid', valid: false, aborted: false },
      { scenario: 'late-invalid', error: '', state: 'idle', valid: true, aborted: true },
      { scenario: 'late-valid', error: '', state: 'idle', valid: true, aborted: true },
      { scenario: 'completed-invalid', error: '', state: 'idle', valid: true, aborted: true },
      { scenario: 'validator', error: '', state: 'idle', valid: true, aborted: true },
      { scenario: 'host-error', error: 'Host rejected this record', state: 'idle', valid: false, aborted: true },
      { scenario: 'reset', error: '', state: 'idle', valid: true, aborted: true },
      { scenario: 'disconnect', error: '', state: 'pending', valid: true, aborted: true },
    ]);
  });
}
