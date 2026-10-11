import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/catalog-examples/index.html');
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { catalogExamplesReady?: boolean }).catalogExamplesReady),
    )
    .toBe(true);
});

test('mounts every catalog entry through its executable example', async ({ page }) => {
  await expect(page.locator('[data-example-id]')).toHaveCount(71);
  const missing = await page
    .locator('[data-example-id]')
    .evaluateAll((sections) =>
      sections
        .filter((section) => !section.querySelector(`aeliqo-${section.getAttribute('data-example-id') ?? ''}`))
        .map((section) => section.getAttribute('data-example-id')),
    );
  expect(missing).toEqual([]);
  expect(
    await page.evaluate(() => (window as typeof window & { catalogExamplesCount: number }).catalogExamplesCount),
  ).toBe(71);
});

test('uses real renderers and compound host boundaries', async ({ page }) => {
  await expect(page.locator('[data-example-id="trend"] aeliqo-trend svg')).toBeVisible();
  await expect(page.locator('[data-example-id="bar"] aeliqo-bar svg')).toBeVisible();
  await expect(page.locator('[data-example-id="table"] aeliqo-table [part="table"]')).toBeVisible();
  await expect(page.locator('[data-example-id="explorer"] aeliqo-explorer [part="collection"]')).toBeVisible();
  await expect(page.locator('[data-example-id="record-editor"] aeliqo-record-editor aeliqo-text-field')).toBeAttached();
  await expect(page.locator('[data-example-id="form-flow"] aeliqo-form-flow [slot="step-identity"]')).toBeAttached();
  await expect(page.locator('[data-example-id="quality-panel"] aeliqo-quality-panel')).toBeAttached();
});

test('keyboard focus reaches a direct action and cleanup removes mounted roots', async ({ page }) => {
  const button = page.locator('[data-example-id="button"] aeliqo-button').locator('button');
  await button.press('Enter');
  await page.evaluate(() =>
    (window as typeof window & { disposeCatalogExamples: () => void }).disposeCatalogExamples(),
  );
  await expect(page.locator('[data-example-host] > [data-catalog-example-root]')).toHaveCount(0);
});
