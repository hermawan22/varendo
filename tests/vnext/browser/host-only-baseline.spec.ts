import { expect, test } from '@playwright/test';

test('host-only and Varendo fixtures complete the same Jakarta people task', async ({ browser, baseURL }) => {
  if (baseURL === undefined) throw new Error('A browser base URL is required.');
  const context = await browser.newContext({ baseURL });
  try {
    const varendo = await context.newPage();
    const hostOnly = await context.newPage();
    await Promise.all([varendo.goto('/'), hostOnly.goto('/host-only/')]);
    await expect(varendo.locator('#page-status')).toHaveText('Ready');
    await expect(hostOnly.getByRole('heading', { name: 'Host-only people baseline' })).toBeVisible();
    await expect(hostOnly.locator('varendo-region')).toHaveCount(0);

    await varendo.getByRole('button', { name: 'People in Jakarta' }).click();
    await hostOnly.getByRole('button', { name: 'People in Jakarta' }).click();

    await expect(varendo.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    await expect(hostOnly.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    await expect(varendo.locator('#people-host varendo-table').getByText('Ada Chen')).toBeVisible();
    await expect(hostOnly.getByRole('table').getByText('Ada Chen')).toBeVisible();
    for (const name of ['Sam Rivera', 'Iman Putra', 'Lee Morgan']) {
      await expect(varendo.locator('#people-host varendo-table').getByText(name)).toHaveCount(0);
      await expect(hostOnly.getByRole('table').getByText(name)).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});
