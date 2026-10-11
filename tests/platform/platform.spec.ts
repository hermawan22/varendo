import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { html } from 'lit';
import { renderAeliqo } from '../../packages/web/src/server.js';

test('vanilla embedding keeps controlled events, forms, focus and style isolation', async ({ page }) => {
  await page.goto('/index.html');
  const input = page.locator('#standalone-form aeliqo-text-field').locator('input');
  await expect(input).toHaveValue('Ada');
  await expect(input).toHaveAccessibleName('Name');
  await expect(input).toHaveAccessibleDescription('The value is controlled by the host.');
  await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    (element as HTMLElement & { error: string }).error = 'Name is invalid.';
  });
  await expect(input).toHaveAccessibleName('Name');
  await expect(input).toHaveAccessibleDescription('The value is controlled by the host. Name is invalid.');
  await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    (element as HTMLElement & { error: string }).error = '';
  });
  await expect(input).toHaveAccessibleDescription('The value is controlled by the host.');

  await input.fill('Lin');
  await expect(page.locator('#standalone-status')).toHaveText('Draft: Lin');
  await expect(input).toHaveValue('Lin');

  await input.focus();
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 2));
  const focusedInsideShadow = await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    const nativeInput = element.shadowRoot?.querySelector('input');
    return document.activeElement === element && element.shadowRoot?.activeElement === nativeInput;
  });
  expect(focusedInsideShadow).toBe(true);

  const shadowStyle = await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    const style = element.shadowRoot?.querySelector('style');
    const nativeInput = element.shadowRoot?.querySelector('input');
    return {
      nonce: style?.getAttribute('nonce'),
      hasAdoptedStyleSheet: (element.shadowRoot?.adoptedStyleSheets.length ?? 0) > 0,
      color: nativeInput === null || nativeInput === undefined ? '' : getComputedStyle(nativeInput).color,
    };
  });
  expect(shadowStyle.nonce === 't02nonce' || shadowStyle.hasAdoptedStyleSheet).toBe(true);
  expect(shadowStyle.color).not.toBe('rgb(255, 0, 0)');

  await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    (element as HTMLElement & { value: string }).value = 'Externally accepted';
  });
  await expect(input).toHaveValue('Externally accepted');
  const focusAfterControlledUpdate = await page.locator('#standalone-form aeliqo-text-field').evaluate((element) => {
    const nativeInput = element.shadowRoot?.querySelector('input');
    return document.activeElement === element && element.shadowRoot?.activeElement === nativeInput;
  });
  expect(focusAfterControlledUpdate).toBe(true);
  const caretAfterControlledUpdate = await input.evaluate((element) => ({
    start: (element as HTMLInputElement).selectionStart,
    end: (element as HTMLInputElement).selectionEnd,
  }));
  expect(caretAfterControlledUpdate).toEqual({ start: 2, end: 2 });

  await page.locator('#standalone-fieldset').evaluate((element) => {
    (element as HTMLFieldSetElement).disabled = true;
  });
  await expect(input).toBeDisabled();
  const disabledSubmitted = await page.locator('#standalone-form').evaluate((element) => {
    const form = element as HTMLFormElement;
    return new FormData(form).get('person');
  });
  expect(disabledSubmitted).toBeNull();
  await page.locator('#standalone-fieldset').evaluate((element) => {
    (element as HTMLFieldSetElement).disabled = false;
  });
  await expect(input).toBeEnabled();
  const enabledSubmitted = await page.locator('#standalone-form').evaluate((element) => {
    const form = element as HTMLFormElement;
    return new FormData(form).get('person');
  });
  expect(enabledSubmitted).toBe('Externally accepted');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(input).toHaveValue('Ada');
  const submitted = await page.locator('#standalone-form').evaluate((element) => {
    const form = element as HTMLFormElement;
    return new FormData(form).get('person');
  });
  expect(submitted).toBe('Ada');

  const axe = await new AxeBuilder({ page }).include('#standalone-root').analyze();
  expect(axe.violations).toEqual([]);
});

test('a rejected controlled edit cannot become native form data', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('#standalone-form');
    if (form === null) {
      throw new Error('form missing');
    }
    form.replaceChildren();
    const input = document.createElement('aeliqo-text-field') as HTMLElement & { value: string };
    input.setAttribute('label', 'Locked');
    input.setAttribute('name', 'locked');
    input.setAttribute('value', 'fixed');
    input.addEventListener('aeliqo-input-change', (event) => {
      const proposedValue = (event as CustomEvent<{ readonly value: string }>).detail.value;
      if (proposedValue !== 'fixed') input.value = 'fixed';
    });
    form.append(input);
  });

  const input = page.locator('#standalone-form aeliqo-text-field').locator('input');
  await expect(input).toHaveValue('fixed');
  await input.fill('rejected');
  await expect(input).toHaveValue('fixed');
  const submitted = await page.locator('#standalone-form').evaluate((element) => {
    const form = element as HTMLFormElement;
    return new FormData(form).get('locked');
  });
  expect(submitted).toBe('fixed');
});

test('property-only names remain form-associated', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(async () => {
    const form = document.querySelector<HTMLFormElement>('#standalone-form');
    if (form === null) {
      throw new Error('form missing');
    }
    form.replaceChildren();
    const input = document.createElement('aeliqo-text-field') as HTMLElement & {
      name: string;
      value: string;
      updateComplete: Promise<unknown>;
    };
    input.setAttribute('label', 'Property name');
    input.name = 'person-property';
    input.value = 'Ada';
    input.addEventListener('aeliqo-input-change', (event) => {
      input.value = (event as CustomEvent<{ readonly value: string }>).detail.value;
    });
    form.append(input);
    await input.updateComplete;
  });

  const input = page.locator('#standalone-form aeliqo-text-field').locator('input');
  await input.fill('Lin');
  const submitted = await page.locator('#standalone-form').evaluate((element) => {
    const form = element as HTMLFormElement;
    return {
      name: form.querySelector('aeliqo-text-field')?.getAttribute('name'),
      value: new FormData(form).get('person-property'),
    };
  });
  expect(submitted).toEqual({ name: 'person-property', value: 'Lin' });
});

test('IME composition preserves drafts across host updates and commits once', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const form = document.querySelector<HTMLFormElement>('#standalone-form');
    if (form === null) {
      throw new Error('form missing');
    }
    form.replaceChildren();
    const element = document.createElement('aeliqo-text-field') as HTMLElement & {
      name: string;
      value: string;
      updateComplete: Promise<unknown>;
    };
    element.name = 'ime';
    element.value = 'base';
    const state = { accept: true, proposals: [] as string[] };
    element.addEventListener('aeliqo-input-change', (event) => {
      const value = (event as CustomEvent<{ readonly value: string }>).detail.value;
      state.proposals.push(value);
      element.value = state.accept ? value : 'host update';
    });
    form.append(element);
    await element.updateComplete;
    const input = element.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (input === null || input === undefined) {
      throw new Error('native input missing');
    }

    const run = async (draft: string, accept: boolean) => {
      state.accept = accept;
      element.value = 'base';
      await element.updateComplete;
      input.focus();
      input.value = draft;
      input.setSelectionRange(2, 2);
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.value = 'host update';
      await element.updateComplete;
      const preserved = {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await element.updateComplete;
      const afterCompositionEnd = {
        value: input.value,
        formValue: new FormData(form).get('ime'),
        proposalCount: state.proposals.length,
      };
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await element.updateComplete;
      return {
        preserved,
        afterCompositionEnd,
        trailingProposalCount: state.proposals.length,
      };
    };

    return {
      accepted: await run('draft accepted', true),
      rejected: await run('draft rejected', false),
      proposals: state.proposals,
    };
  });

  expect(result).toEqual({
    accepted: {
      preserved: { value: 'draft accepted', start: 2, end: 2 },
      afterCompositionEnd: { value: 'draft accepted', formValue: 'draft accepted', proposalCount: 1 },
      trailingProposalCount: 1,
    },
    rejected: {
      preserved: { value: 'draft rejected', start: 2, end: 2 },
      afterCompositionEnd: { value: 'host update', formValue: 'host update', proposalCount: 2 },
      trailingProposalCount: 2,
    },
    proposals: ['draft accepted', 'draft rejected'],
  });
});

type EnterScenario =
  | 'readonly-required-empty'
  | 'readonly-value'
  | 'default-first-enabled'
  | 'default-first-disabled'
  | 'default-fieldset-disabled'
  | 'image-first-enabled'
  | 'external-image-first'
  | 'external-image-after'
  | 'no-submit-one-field'
  | 'no-submit-two-fields';

type SubmissionRecord = {
  readonly submitter: string | null;
  readonly data: Record<string, string>;
};

async function runEnterScenario(
  page: import('@playwright/test').Page,
  scenario: EnterScenario,
): Promise<{
  readonly native: readonly SubmissionRecord[];
  readonly custom: readonly SubmissionRecord[];
}> {
  await page.evaluate(async (currentScenario) => {
    const root = document.querySelector<HTMLElement>('#standalone-root');
    if (root === null) {
      throw new Error('fixture root missing');
    }
    root.replaceChildren();

    const nativeForm = document.createElement('form');
    nativeForm.id = 'native-enter-form';
    const customForm = document.createElement('form');
    customForm.id = 'custom-enter-form';
    const externalBefore: HTMLInputElement[] = [];
    const externalAfter: HTMLInputElement[] = [];

    const nativeInput = document.createElement('input');
    nativeInput.id = 'native-enter-input';
    nativeInput.name = 'field';
    nativeInput.value = currentScenario === 'readonly-required-empty' ? '' : 'value';
    const customInput = document.createElement('aeliqo-text-field') as HTMLElement & {
      name: string;
      value: string;
      required: boolean;
      readOnly: boolean;
      updateComplete: Promise<unknown>;
    };
    customInput.id = 'custom-enter-input';
    customInput.name = 'field';
    customInput.value = currentScenario === 'readonly-required-empty' ? '' : 'value';

    nativeForm.append(nativeInput);
    customForm.append(customInput);

    if (currentScenario === 'readonly-required-empty' || currentScenario === 'readonly-value') {
      nativeInput.readOnly = true;
      customInput.readOnly = true;
      nativeInput.required = currentScenario === 'readonly-required-empty';
      customInput.required = currentScenario === 'readonly-required-empty';
    }

    if (currentScenario === 'no-submit-two-fields') {
      const nativeSecond = document.createElement('input');
      nativeSecond.name = 'second';
      nativeSecond.value = 'second';
      nativeForm.append(nativeSecond);
      const customSecond = document.createElement('input');
      customSecond.name = 'second';
      customSecond.value = 'second';
      customForm.append(customSecond);
    }

    if (
      currentScenario === 'default-first-enabled' ||
      currentScenario === 'default-first-disabled' ||
      currentScenario === 'default-fieldset-disabled'
    ) {
      const addSubmitters = (form: HTMLFormElement): void => {
        const first = document.createElement('button');
        first.id = 'first-submit';
        first.type = 'submit';
        first.name = 'submitter';
        first.value = 'first';
        first.textContent = 'First';
        const second = document.createElement('button');
        second.id = 'second-submit';
        second.type = 'submit';
        second.name = 'submitter';
        second.value = 'second';
        second.textContent = 'Second';
        if (currentScenario === 'default-fieldset-disabled') {
          const fieldset = document.createElement('fieldset');
          fieldset.disabled = true;
          fieldset.append(first);
          form.append(fieldset, second);
        } else {
          first.disabled = currentScenario === 'default-first-disabled';
          form.append(first, second);
        }
      };
      addSubmitters(nativeForm);
      addSubmitters(customForm);
    } else if (currentScenario === 'image-first-enabled') {
      const addImageSubmitters = (form: HTMLFormElement): void => {
        const image = document.createElement('input');
        image.id = 'image-submit';
        image.type = 'image';
        image.name = 'image';
        const button = document.createElement('button');
        button.id = 'button-submit';
        button.type = 'submit';
        button.name = 'submitter';
        button.value = 'button';
        form.append(image, button);
      };
      addImageSubmitters(nativeForm);
      addImageSubmitters(customForm);
    } else if (currentScenario === 'external-image-first' || currentScenario === 'external-image-after') {
      const addExternalImage = (id: string, formId: string): HTMLInputElement => {
        const image = document.createElement('input');
        image.id = id;
        image.type = 'image';
        image.name = 'image';
        image.setAttribute('form', formId);
        return image;
      };
      const addButton = (form: HTMLFormElement): void => {
        const button = document.createElement('button');
        button.id = 'button-submit';
        button.type = 'submit';
        button.name = 'submitter';
        button.value = 'button';
        form.append(button);
      };
      addButton(nativeForm);
      addButton(customForm);
      const images = [
        addExternalImage('native-image-submit', nativeForm.id),
        addExternalImage('custom-image-submit', customForm.id),
      ];
      (currentScenario === 'external-image-first' ? externalBefore : externalAfter).push(...images);
    }

    root.append(...externalBefore, nativeForm, customForm, ...externalAfter);
    for (const form of [nativeForm, customForm]) {
      (form as HTMLFormElement & { records: SubmissionRecord[] }).records = [];
      form.addEventListener('submit', (event) => {
        const records = (form as HTMLFormElement & { records: SubmissionRecord[] }).records;
        const submitter = (event as SubmitEvent).submitter;
        records.push({
          submitter: submitter?.matches('input[type=image]') ? 'image' : (submitter?.id ?? null),
          data: Object.fromEntries(new FormData(form).entries()) as Record<string, string>,
        });
        event.preventDefault();
      });
    }
    await customInput.updateComplete;
  }, scenario);

  await page.locator('#native-enter-form #native-enter-input').press('Enter');
  await page.waitForTimeout(30);
  await page.locator('#custom-enter-form aeliqo-text-field').locator('input').press('Enter');
  await page.waitForTimeout(30);
  return page.evaluate(() => ({
    native: (document.querySelector('#native-enter-form') as HTMLFormElement & { records: SubmissionRecord[] }).records,
    custom: (document.querySelector('#custom-enter-form') as HTMLFormElement & { records: SubmissionRecord[] }).records,
  }));
}

test('Enter semantics match native implicit submission across the platform table', async ({ page }) => {
  await page.goto('/index.html');
  const scenarios: readonly EnterScenario[] = [
    'readonly-required-empty',
    'readonly-value',
    'default-first-enabled',
    'default-first-disabled',
    'default-fieldset-disabled',
    'image-first-enabled',
    'external-image-first',
    'external-image-after',
    'no-submit-one-field',
    'no-submit-two-fields',
  ];

  for (const scenario of scenarios) {
    const result = await runEnterScenario(page, scenario);
    expect(result.custom, scenario).toEqual(result.native);
  }
});

test('readonly required empty inputs also match native direct requestSubmit', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('#standalone-root');
    if (root === null) {
      throw new Error('fixture root missing');
    }
    root.replaceChildren();
    const nativeForm = document.createElement('form');
    const customForm = document.createElement('form');
    root.append(nativeForm, customForm);
    const nativeInput = document.createElement('input');
    nativeInput.name = 'field';
    nativeInput.required = true;
    nativeInput.readOnly = true;
    const customInput = document.createElement('aeliqo-text-field') as HTMLElement & {
      name: string;
      required: boolean;
      readOnly: boolean;
      updateComplete: Promise<unknown>;
    };
    customInput.name = 'field';
    customInput.required = true;
    customInput.readOnly = true;
    nativeForm.append(nativeInput);
    customForm.append(customInput);
    for (const form of [nativeForm, customForm]) {
      (form as HTMLFormElement & { submitted: number }).submitted = 0;
      form.addEventListener('submit', (event) => {
        (form as HTMLFormElement & { submitted: number }).submitted += 1;
        event.preventDefault();
      });
    }
    await customInput.updateComplete;
    nativeForm.requestSubmit();
    customForm.requestSubmit();
    return {
      native: (nativeForm as HTMLFormElement & { submitted: number }).submitted,
      custom: (customForm as HTMLFormElement & { submitted: number }).submitted,
    };
  });
  expect(result).toEqual({ native: 1, custom: 1 });
});

test('Enter bridge honors outer cancellation and default submitter click cancellation', async ({ page }) => {
  await page.goto('/index.html');
  for (const cancellation of ['form-keydown', 'submitter-click'] as const) {
    await page.evaluate(async (currentCancellation) => {
      const root = document.querySelector<HTMLElement>('#standalone-root');
      if (root === null) {
        throw new Error('fixture root missing');
      }
      root.replaceChildren();
      const nativeForm = document.createElement('form');
      nativeForm.id = 'native-cancel-form';
      const customForm = document.createElement('form');
      customForm.id = 'custom-cancel-form';
      root.append(nativeForm, customForm);

      const addControls = (form: HTMLFormElement, custom: boolean): void => {
        const button = document.createElement('button');
        button.id = 'cancel-submit';
        button.type = 'submit';
        button.textContent = 'Submit';
        const control = custom
          ? (document.createElement('aeliqo-text-field') as HTMLElement & { name: string; value: string })
          : document.createElement('input');
        control.id = custom ? 'custom-cancel-input' : 'native-cancel-input';
        control.name = 'field';
        control.value = custom ? 'custom' : 'native';
        form.append(button, control);
        if (currentCancellation === 'form-keydown') {
          form.addEventListener('keydown', (event) => event.preventDefault());
        } else {
          button.addEventListener('click', (event) => event.preventDefault());
        }
      };
      addControls(nativeForm, false);
      addControls(customForm, true);
      for (const form of [nativeForm, customForm]) {
        (form as HTMLFormElement & { submitted: number }).submitted = 0;
        form.addEventListener('submit', (event) => {
          (form as HTMLFormElement & { submitted: number }).submitted += 1;
          event.preventDefault();
        });
      }
      await (customForm.querySelector('aeliqo-text-field') as HTMLElement & { updateComplete: Promise<unknown> })
        .updateComplete;
    }, cancellation);

    await page.locator('#native-cancel-form #native-cancel-input').press('Enter');
    await page.waitForTimeout(30);
    await page.locator('#custom-cancel-form aeliqo-text-field').locator('input').press('Enter');
    await page.waitForTimeout(30);
    const result = await page.evaluate(() => ({
      native: (document.querySelector('#native-cancel-form') as HTMLFormElement & { submitted: number }).submitted,
      custom: (document.querySelector('#custom-cancel-form') as HTMLFormElement & { submitted: number }).submitted,
    }));
    expect(result, cancellation).toEqual({ native: 0, custom: 0 });
  }
});

test('strict script CSP blocks injected inline code while the fixture remains interactive', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = "document.body.dataset.inlineExecuted = 'yes'";
    document.head.append(script);
  });
  expect(await page.locator('body').getAttribute('data-inline-executed')).toBeNull();
  await expect(page.locator('#standalone-root aeliqo-table')).toBeVisible();
});

test('React and Vue consume the same registered web elements', async ({ page }) => {
  await page.goto('/react.html');
  const reactInput = page.locator('#react-form aeliqo-text-field').locator('input');
  await expect(reactInput).toHaveValue('React');
  await reactInput.fill('React updated');
  await expect(page.locator('#react-value')).toHaveText('React updated');
  await expect(page.locator('aeliqo-table').locator('tbody tr')).toHaveCount(2);

  await page.goto('/vue.html');
  const vueInput = page.locator('#vue-form aeliqo-text-field').locator('input');
  await expect(vueInput).toHaveValue('Vue');
  await vueInput.fill('Vue updated');
  await expect(page.locator('#vue-value')).toHaveText('Vue updated');
  await expect(page.locator('aeliqo-chart').locator('details')).toBeVisible();
});

test('SSR declarative shadow content upgrades and hydrates without duplication', async ({ page }) => {
  const serverMarkup = await renderAeliqo(html`
    <main>
      <aeliqo-text-field label="Name" value="Ada" name="person"></aeliqo-text-field>
    </main>
  `);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/ssr-document', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: serverMarkup });
  });
  await page.goto('/ssr-document');

  const registryBefore = await page.evaluate(() => customElements.get('aeliqo-text-field'));
  expect(registryBefore).toBeUndefined();

  const before = await page.locator('aeliqo-text-field').evaluate((element) => ({
    hasShadow: element.shadowRoot !== null,
    inputCount: element.shadowRoot?.querySelectorAll('input').length ?? 0,
  }));
  expect(before).toEqual({ hasShadow: true, inputCount: 1 });

  const serverInput = page.locator('aeliqo-text-field').locator('input');
  const serverInputHandle = await serverInput.elementHandle();
  if (serverInputHandle === null) {
    throw new Error('server input missing');
  }
  await serverInput.fill('typed before hydration');
  await serverInput.focus();
  await page.addScriptTag({ url: `${new URL('/src/hydrate.ts', page.url())}`, type: 'module' });
  await page.waitForFunction(() => {
    const constructor = customElements.get('aeliqo-text-field');
    const element = document.querySelector('aeliqo-text-field');
    return constructor !== undefined && element instanceof constructor;
  });
  await expect(serverInput).toHaveValue('typed before hydration');

  const after = await page.locator('aeliqo-text-field').evaluate((element) => ({
    inputCount: element.shadowRoot?.querySelectorAll('input').length ?? 0,
    shadowTemplateCount: element.shadowRoot?.querySelectorAll('template').length ?? 0,
    focused: document.activeElement === element && element.shadowRoot?.activeElement?.localName === 'input',
  }));
  expect(after).toEqual({ inputCount: 1, shadowTemplateCount: 0, focused: true });
  const sameInputNode = await page
    .locator('aeliqo-text-field')
    .evaluate(
      (element, originalInput) => element.shadowRoot?.querySelector('input') === originalInput,
      serverInputHandle,
    );
  expect(sameInputNode).toBe(true);
  await serverInputHandle.dispose();
  expect(pageErrors).toEqual([]);
});
