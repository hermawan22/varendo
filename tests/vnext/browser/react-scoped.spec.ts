import { expect, test } from '@playwright/test';

test('keeps a dirty A form mounted while a voluntary guard waits, then creates B and A2 targets', async ({ page }) => {
  await page.goto('/react-scoped/');
  await expect(page.getByTestId('selector')).toHaveText('acme');
  await expect(page.getByTestId('surface-epoch')).toHaveText('1');
  await page.getByRole('textbox', { name: 'Scoped draft' }).fill('unfinished A');
  await page.getByRole('button', { name: 'Hold leave guard' }).click();
  await page.getByRole('button', { name: 'Go to globex' }).click();
  await expect(page.getByTestId('pending')).toHaveText('globex');
  await expect(page.getByRole('textbox', { name: 'Scoped draft' })).toHaveValue('unfinished A');
  await expect(page.getByTestId('selector')).toHaveText('acme');

  await page.getByRole('button', { name: 'Approve leave' }).click();
  await expect(page.getByTestId('selector')).toHaveText('globex');
  await expect(page.getByTestId('surface-epoch')).toHaveText('2');
  await page.getByRole('button', { name: 'Go to acme' }).click();
  await expect(page.getByTestId('surface-epoch')).toHaveText('3');
  await page.getByRole('button', { name: 'Call old A controller' }).click();
  await expect(page.getByTestId('old-result')).toContainText(/disposed|stale|cancelled/);
});

test('forced invalidation hides content and unmount leaves the injected scope undisposed', async ({ page }) => {
  await page.goto('/react-scoped/');
  await expect(page.getByTestId('selector')).toHaveText('acme');
  await page.getByRole('button', { name: 'Revoke scope' }).click();
  await expect(page.getByRole('textbox', { name: 'Scoped draft' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('no longer available');
  await page.getByRole('button', { name: 'Unmount provider' }).click();
  await expect(page.getByTestId('scope-status')).toHaveText('denied');
});

test('external scope disposal immediately hides the active React subtree', async ({ page }) => {
  await page.goto('/react-scoped/');
  await expect(page.getByTestId('selector')).toHaveText('acme');
  await expect(page.getByRole('textbox', { name: 'Scoped draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Dispose scope' }).click();
  await expect(page.getByRole('textbox', { name: 'Scoped draft' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('scope has closed');
  await expect(page.getByTestId('scope-status')).toHaveText('disposed');
});

test('replacing a surface ID in one activation retires its previous controller', async ({ page }) => {
  await page.goto('/react-scoped/');
  await expect(page.getByTestId('surface-phase')).toHaveText('ready');
  await expect(page.getByTestId('surface-id')).toHaveText('react-orders');
  await page.getByRole('button', { name: 'Replace surface ID' }).click();
  await expect(page.getByTestId('surface-id')).toHaveText('react-orders-replacement');
  await expect(page.getByTestId('surface-epoch')).toHaveText('1');
  await page.getByRole('button', { name: 'Call old A controller' }).click();
  await expect(page.getByTestId('old-result')).toContainText(/disposed|stale|cancelled/);
});

test('unmounts a scoped hook during a real pending read and releases its subscriptions', async ({ page }) => {
  await page.goto('/react-scoped/');
  await expect(page.getByTestId('surface-phase')).toHaveText('ready');
  const before = Number(await page.getByTestId('scope-listeners').textContent());
  await page.getByRole('button', { name: 'Hold next read' }).click();
  await page.getByRole('button', { name: 'Request active surface' }).click();
  await expect(page.getByTestId('read-started')).toHaveText('started');
  await expect(page.getByTestId('surface-phase')).toHaveText('loading');
  await page.getByRole('button', { name: 'Unmount provider' }).click();
  await expect(page.getByTestId('selector')).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId('scope-listeners').textContent())).toBeLessThan(before);
  await page.getByRole('button', { name: 'Release read' }).click();
  await expect(page.getByTestId('read-result')).toContainText(/disposed|stale|cancelled/);
  await expect(page.getByTestId('scope-status')).toHaveText('active');
});
