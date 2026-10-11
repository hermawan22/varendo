import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('beginner React surface mounts in Strict Mode and updates the same local instance', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByRole('table')).toContainText('Ada Chen');
  await expect(page.getByRole('table')).toContainText('Sam Rivera');
  const address = await page.getByTestId('surface-address').textContent();
  expect(address).not.toBe('pending');

  await page.getByRole('button', { name: 'Update people' }).click();
  await expect(page.getByRole('table')).toContainText('Engineering');
  await expect(page.getByRole('table')).not.toContainText('Sam Rivera');
  await expect(page.getByTestId('surface-address')).toHaveText(address ?? '');
});

test('a rejected local update reports the error and retains the last valid result', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByRole('table')).toContainText('Ada Chen');
  await page.getByRole('button', { name: 'Invalid update' }).click();

  await expect(page.getByRole('alert')).toContainText('data.identity-duplicate');
  await expect(page.getByRole('table')).toContainText('Ada Chen');
  await expect(page.getByRole('table')).not.toContainText('First duplicate');
});

test('restoring the last accepted data reference clears a rejected update error', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByTestId('source-state')).toHaveText('ready:2');
  const address = await page.getByTestId('surface-address').textContent();
  await page.getByRole('button', { name: 'Invalid update' }).click();
  await expect(page.getByRole('alert')).toContainText('data.identity-duplicate');

  await page.getByRole('button', { name: 'Restore original' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText('Ada Chen');
  await expect(page.getByTestId('surface-address')).toHaveText(address ?? '');
});

test('same-reference mutations require and respect an explicit version signal', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByRole('table')).toContainText('Engineering');
  const address = await page.getByTestId('surface-address').textContent();
  await page.getByRole('button', { name: 'Signal same-reference update' }).click();

  await expect(page.getByRole('table')).toContainText('Support');
  await expect(page.getByRole('table')).not.toContainText('Engineering');
  await expect(page.getByTestId('surface-address')).toHaveText(address ?? '');
});

test('keeps the same local surface updating beyond the old revision budget', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByTestId('source-state')).toHaveText('ready:2');
  const address = await page.getByTestId('surface-address').textContent();
  let revision = Number(await page.getByTestId('surface-revision').textContent());

  for (let update = 0; update < 260; update++) {
    await page.getByRole('button', { name: 'Update people' }).click();
    await expect
      .poll(async () => Number(await page.getByTestId('surface-revision').textContent()))
      .toBeGreaterThan(revision);
    await expect(page.getByTestId('source-state')).toHaveText('ready:1');
    revision = Number(await page.getByTestId('surface-revision').textContent());
  }

  await page.getByRole('button', { name: 'Restore people' }).click();
  await expect(page.getByRole('table')).toContainText('Sam Rivera');
  await expect(page.getByTestId('surface-address')).toHaveText(address ?? '');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('clearing local data keeps the same controller and shows an empty state', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByRole('table')).toContainText('Sam Rivera');
  const address = await page.getByTestId('surface-address').textContent();
  await page.getByRole('button', { name: 'Clear people' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'No records to show' })).toBeVisible();
  await expect(page.getByTestId('source-state')).toHaveText('ready:0');
  await expect(page.getByTestId('surface-address')).toHaveText(address ?? '');
});

test('an initially empty local surface waits for rows before creating its controller', async ({ page }) => {
  await page.goto('/react-local/?empty');
  await expect(page.getByRole('status').filter({ hasText: 'Add a schema' })).toBeVisible();
  await expect(page.getByTestId('surface-address')).toHaveText('pending');
  await page.getByRole('button', { name: 'Restore people' }).click();

  await expect(page.getByTestId('source-state')).toHaveText('ready:2');
  await expect(page.getByRole('table')).toContainText('Ada Chen');
  await expect(page.getByTestId('surface-address')).not.toHaveText('pending');
});

test('local browse chooses eligible cards when its container narrows', async ({ page }) => {
  await page.goto('/react-local/');
  await expect(page.getByTestId('source-state')).toHaveText('ready:2');
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: 'Narrow host' }).click();

  await expect(page.getByRole('list', { name: 'Records' })).toContainText('Ada Chen');
  await expect(page.getByRole('table')).toHaveCount(0);
});

for (const width of [360, 768, 1440]) {
  test(`local browse has no automated accessibility violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/react-local/');
    await expect(page.getByTestId('source-state')).toHaveText('ready:2');
    const report = await new AxeBuilder({ page }).analyze();
    expect(report.violations).toEqual([]);
  });
}
