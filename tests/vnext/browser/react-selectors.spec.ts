import { expect, test } from '@playwright/test';

test('object and array selectors stay stable across unrelated external updates', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/react-selectors/');
  await expect(page.getByTestId('surface-selection')).toHaveText('ada:1');
  await expect(page.getByTestId('scope-selection')).toHaveText('acme:1');
  await expect(page.getByTestId('primitive-selection')).toHaveText('ready:1');
  await expect(page.getByTestId('reference-selection')).toHaveText('ada:1');

  await page.getByRole('button', { name: 'Parent render' }).click();
  await expect(page.getByTestId('parent-version')).toHaveText('1');
  await expect(page.getByTestId('surface-selection')).toHaveText('ada:2');
  await expect(page.getByTestId('scope-selection')).toHaveText('acme:2');

  await page.getByRole('button', { name: 'Unrelated surface' }).click();
  await page.getByRole('button', { name: 'Unrelated scope' }).click();
  await expect(page.getByTestId('surface-selection')).toHaveText('ada:2');
  await expect(page.getByTestId('scope-selection')).toHaveText('acme:2');
  await expect(page.getByTestId('primitive-selection')).toHaveText('ready:2');
  await expect(page.getByTestId('reference-selection')).toHaveText('ada:2');

  await page.getByRole('button', { name: 'Relevant surface' }).click();
  await page.getByRole('button', { name: 'Relevant scope' }).click();
  await expect(page.getByTestId('surface-selection')).toContainText('ada,sam:');
  await expect(page.getByTestId('scope-selection')).toContainText('globex:');
  expect(errors).toEqual([]);
});
