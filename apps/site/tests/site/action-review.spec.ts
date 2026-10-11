import { expect, test, type Page, type Route } from '@playwright/test';

async function openCreateDraft(page: Page): Promise<void> {
  await page.goto('/playground/');
  await page.locator('#pg-scenario').selectOption('products');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  const tasks = page.locator('#pg-request');
  if (!(await tasks.evaluate((element) => (element as HTMLDetailsElement).open)))
    await tasks.locator('summary').click();
  await page.getByRole('button', { name: 'Create product' }).click();
  await fillProductDraft(page);
  await page.getByRole('button', { name: 'Create record' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
}

async function fillProductDraft(
  page: Page,
  id = 'pr-5',
  productName = 'Travel ruler',
  price = '6.5',
  stock = '24',
): Promise<void> {
  for (const [name, value] of [
    ['Product ID', id],
    ['Name', productName],
    ['Category', 'Stationery'],
    ['Price', price],
    ['Stock', stock],
  ] as const) {
    await page.getByRole('textbox', { name, exact: true }).fill(value);
  }
}

async function expectRetainedFormFocus(page: Page, name = 'Travel ruler'): Promise<void> {
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create record' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
}

async function expectDraftAndReopen(page: Page): Promise<void> {
  await expectRetainedFormFocus(page);
  await page.getByRole('button', { name: 'Create record' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
  await expect(page.locator('#pg-action-content')).toContainText('Travel ruler');
}

test('create supersedes the first browse while its renderer family is still loading', async ({ page }) => {
  let hold!: (route: Route) => void;
  const loading = new Promise<Route>((resolve) => {
    hold = resolve;
  });
  await page.route('**/register-data*.js*', hold);
  await page.goto('/playground/?scenario=products', { waitUntil: 'domcontentloaded' });
  const route = await loading;
  try {
    const tasks = page.locator('#pg-request');
    if (!(await tasks.evaluate((element) => (element as HTMLDetailsElement).open)))
      await tasks.locator('summary').click();
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByRole('textbox', { name: 'Product ID', exact: true })).toBeVisible();
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    await expect(page.locator('#pg-result-title')).toHaveText('Create product');
  } finally {
    await route.continue();
  }
  await expect(page.locator('aeliqo-form')).toBeVisible();
  await expect(page.locator('#pg-region aeliqo-card-collection')).toHaveCount(0);
  await fillProductDraft(page);
  await page.getByRole('button', { name: 'Create record' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
});

test('double-clicking Done preserves form focus after a confirmed write', async ({ page }) => {
  await openCreateDraft(page);
  const confirm = page.getByRole('button', { name: 'Confirm action' });
  await confirm.dblclick();
  await expect(page.locator('#pg-status')).toHaveText('Action completed.');
  await expect(page.locator('#pg-receipt-state')).toHaveText('executed');
  await expect(confirm).toBeDisabled();
  // Let the close event run between presses, as it can during a human double-click.
  await page.getByRole('button', { name: 'Done', exact: true }).dblclick({ delay: 100 });
  await expectRetainedFormFocus(page, '');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('#pg-inspector')).toBeVisible();
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
});

test('double-clicking Cancel retains the draft and permits a later deliberate click', async ({ page }) => {
  await openCreateDraft(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).dblclick({ delay: 100 });
  await expectDraftAndReopen(page);
  await expect(page.locator('#pg-status')).not.toHaveText('Action completed.');
});

test('Escape and keyboard cancellation restore focus and retain the draft', async ({ page }) => {
  await openCreateDraft(page);
  await page.getByRole('button', { name: 'Confirm action' }).focus();
  await page.keyboard.press('Escape');
  await expectDraftAndReopen(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expectDraftAndReopen(page);
  await expect(page.locator('#pg-status')).not.toHaveText('Action completed.');
});

test('confirmed creation resets the form and permits a second complete product', async ({ page }, testInfo) => {
  await openCreateDraft(page);
  await page.getByRole('button', { name: 'Confirm action' }).click();
  await expect(page.locator('#pg-status')).toHaveText('Action completed.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expectRetainedFormFocus(page, '');
  for (const name of ['Product ID', 'Name', 'Category', 'Price', 'Stock']) {
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('');
  }

  await page.locator('aeliqo-form').screenshot({ path: testInfo.outputPath('saved-form-defaults.png') });
  await fillProductDraft(page, 'pr-6', 'Pocket compass', '3.75', '9');
  await page.getByRole('button', { name: 'Create record' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
  await expect(page.locator('#pg-action-content')).toContainText('Pocket compass');
  await page.getByRole('button', { name: 'Confirm action' }).click();
  await expect(page.locator('#pg-receipt-state')).toHaveText('executed');
  await expect(page.locator('#pg-status')).toHaveText('Action completed.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expectRetainedFormFocus(page, '');

  await page.getByRole('button', { name: 'Browse products' }).click();
  const products = page.locator('aeliqo-card-collection');
  await expect(products).toBeVisible();
  for (const [name, price, stock] of [
    ['Travel ruler', '6.5', '24'],
    ['Pocket compass', '3.75', '9'],
  ] as const) {
    const product = products.getByRole('article', { name, exact: true });
    await expect(product).toBeVisible();
    await expect(product.getByText(price, { exact: true })).toBeVisible();
    await expect(product.getByText(stock, { exact: true })).toBeVisible();
  }
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
});
