import { expect, test } from '@playwright/test';

test('native React resolver measures its container when the host resizes', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');

  await page.getByRole('button', { name: 'Narrow host' }).click();
  await expect(page.getByTestId('native-choice')).toHaveText('narrow list');
});

test('keeps a native view usable after lazy load failure and promotes it on retry', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await expect(page.getByTestId('native-portal')).toHaveText('existing-host');
  await page.getByRole('textbox', { name: 'Native draft' }).fill('keep my draft');
  await page.getByRole('button', { name: 'Fail next view load' }).click();
  await page.getByRole('button', { name: 'Narrow host' }).click();

  await expect(page.getByRole('alert')).toContainText('Could not load the native React view');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await expect(page.getByRole('textbox', { name: 'Native draft' })).toHaveValue('keep my draft');
  await expect(page.getByTestId('native-portal')).toHaveText('existing-host');

  await page.getByRole('button', { name: 'Retry view load' }).click();
  await expect(page.getByTestId('native-choice')).toHaveText('narrow list');
});

test('removes a prior native view when current registration no longer permits it', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await page.getByRole('button', { name: 'Fail next view load' }).click();
  await page.getByRole('button', { name: 'Remove wide view' }).click();

  await expect(page.getByRole('alert')).toContainText('Could not load the native React view');
  await expect(page.getByTestId('native-choice')).toHaveCount(0);
  await expect(page.getByTestId('native-portal')).toHaveCount(0);
});

test('keeps one pending lazy load through an equivalent host registry update', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await page.getByRole('button', { name: 'Hold view loads' }).click();
  await page.getByRole('button', { name: 'Narrow host' }).click();
  await expect(page.getByLabel('View load count', { exact: true })).toHaveText('1');
  await page.getByRole('button', { name: 'Rerender host' }).click();
  await expect(page.getByLabel('View load count', { exact: true })).toHaveText('1');
  await page.getByRole('button', { name: 'Release one view load' }).click();
  await expect(page.getByTestId('native-choice')).toHaveText('narrow list');
});

test('keeps a controlled native view mounted through an equivalent host registry update', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await page.getByRole('textbox', { name: 'Native draft' }).fill('draft stays');
  await page.getByRole('button', { name: 'Rerender host' }).click();
  await expect(page.getByRole('textbox', { name: 'Native draft' })).toHaveValue('draft stays');
  await expect(page.getByTestId('native-portal')).toHaveText('existing-host');
});

test('loads an initially selected lazy native view once in StrictMode', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await page.getByRole('button', { name: 'Mount initial lazy view' }).click();
  await expect(page.getByTestId('initial-lazy-view')).toHaveText('initial lazy view');
  await expect(page.getByLabel('Initial view load count')).toHaveText('1');
});

test('unmount during a pending native load releases listeners and leaves no rendered view', async ({ page }) => {
  await page.goto('/react-adaptive/');
  await expect(page.getByTestId('native-choice')).toHaveText('wide table');
  await page.getByRole('button', { name: 'Hold view loads' }).click();
  await page.getByRole('button', { name: 'Narrow host' }).click();
  await expect(page.getByLabel('View load count', { exact: true })).toHaveText('1');

  await page.getByRole('button', { name: 'Unmount host' }).click();
  await expect(page.getByLabel('Active surface listeners')).toHaveText('0');
  await page.getByRole('button', { name: 'Release one view load' }).click();
  await expect(page.getByTestId('native-choice')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
