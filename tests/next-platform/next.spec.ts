import { test, expect } from '@playwright/test';

test('Next App Router serves real shadow content and hydrates a controlled form', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).toContain('shadowrootmode="open"');
  expect(source).toContain('Next person');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => customElements.get('aeliqo-text-field') !== undefined);
  const input = page.getByLabel('Next person');
  await expect(input).toHaveValue('Ada');
  await input.fill('Lin');
  await expect(input).toHaveValue('Lin');
  await expect(page.locator('#aeliqo-server-proof')).not.toHaveAttribute('data-hydration-error', /.+/);
  expect(
    await page.locator('form').evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error('Expected form');
      return new FormData(form).get('person');
    }),
  ).toBe('Lin');
  await expect(page.locator('#aeliqo-server-proof aeliqo-text-field').locator('input')).toHaveCount(1);
  await expect(page.locator('#adaptive-people-status')).toHaveText('renderer-ready');
  await expect(page.locator('[data-varendo-react-region="next-people"] aeliqo-table')).toContainText('Ada Chen');
  expect(errors).toEqual([]);
});
