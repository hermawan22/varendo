import { expect, test } from '@playwright/test';

test('keeps manual adaptive controls usable without a model connection', async ({ page, baseURL }) => {
  if (baseURL === undefined) throw new Error('The vNext browser fixture requires a configured base URL.');
  const fixtureOrigin = new URL(baseURL).origin;
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== fixtureOrigin)
      providerRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('#page-status')).toHaveText('Ready');
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(page.locator('#people-status')).toContainText('renderer-ready:data.card-collection');
  await expect(page.getByText('Sam Rivera')).toBeVisible();
  expect(providerRequests).toEqual([]);
});
