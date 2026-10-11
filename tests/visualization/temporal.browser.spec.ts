import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/visualization/temporal.html');
  await page.locator('aeliqo-matrix table').waitFor();
});
test('renders exact matrix, overlap lanes and declared-zone calendar with honest scope', async ({ page }) => {
  await expect(
    page.locator('aeliqo-matrix').getByRole('cell', { name: '100000000000000000000.01', exact: true }),
  ).toBeVisible();
  expect(
    await page.locator('aeliqo-timeline line').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('y1'))),
  ).toEqual(['24', '52']);
  await expect(page.locator('aeliqo-calendar-grid strong')).toHaveText('2026-09-07');
  await expect(page.locator('aeliqo-calendar-grid')).toContainText('2 rows');
  await expect(page.locator('aeliqo-timeline [part=scope]')).toContainText('Partial result');
  await expect(page.locator('aeliqo-timeline')).toContainText('Rows beyond this page are unavailable.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('keyboard selection keeps stable identities and focus across row reordering, clears revoked values', async ({
  page,
}) => {
  const button = page.locator('aeliqo-matrix').getByRole('button', { name: 'Select a', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const before = await page.evaluate(() => (window as any).selection);
  expect(before.source).toBe('user');
  expect(before.result.scopeDigest).toBe('scope-1');
  await page.evaluate(async () => {
    const v = (window as any).views[0];
    v.datasets = v.datasets.map((d: any) => ({ ...d, rows: [...d.rows].reverse() }));
    await v.updateComplete;
  });
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).selection)).toEqual(before);
  await page.evaluate(async () => {
    for (const v of (window as any).views) {
      v.context = { results: [] };
      await v.updateComplete;
    }
  });
  await expect(page.locator('table')).toHaveCount(0);
  await expect(page.locator('svg')).toHaveCount(0);
  await expect(page.locator('.day')).toHaveCount(0);
});
test('narrow RTL large text preserves accessible values and bounded visual scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.body.style.fontSize = '24px';
    for (const v of (window as any).views) v.style.fontSize = '24px';
  });
  await expect(
    page.locator('aeliqo-matrix').getByRole('cell', { name: '100000000000000000000.01', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'artifacts/temporal-browser/narrow-rtl.png', fullPage: true });
});
