import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/adaptation-semantic/index.html');
  await page.waitForFunction(() => (window as any).ready === true);
});
test('real registered components adapt through the default renderer and preserve drafts inside nested shadow roots', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(input).toHaveValue('Ada');
  await expect(page.getByRole('cell', { name: 'e-1', exact: true })).toBeVisible();
  expect(await page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('row');
  await input.fill('Unfinished draft');
  const deferred = await page.evaluate(() => (window as any).proof.request(320));
  expect(deferred).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Unfinished draft');
  await page.locator('#outside').click();
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('column');
  await expect(input).toHaveValue('Unfinished draft');
  expect(
    await page.evaluate(() => {
      const p = (window as any).proof;
      return (
        JSON.stringify(p.element.presentation.plan.preconditions) ===
        JSON.stringify(p.region.snapshot().state.presentation.preconditions)
      );
    }),
  ).toBe(true);
  const wide = await page.evaluate(() => (window as any).proof.request(900));
  expect(wide).toMatchObject({ ok: true, value: { status: 'committed' } });
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('row');
  await expect(input).toHaveValue('Unfinished draft');
  const zoom = await page.evaluate(() => (window as any).proof.request(900, 2));
  expect(zoom).toMatchObject({ ok: true, value: { status: 'committed' } });
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('column');
  await page.evaluate(() => (window as any).proof.region.revoke('test revoked'));
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'e-1', exact: true })).toHaveCount(0);
});
test('IME and active pointer defer changes until their native event ends', async ({ page }) => {
  const host = page.locator('aeliqo-region');
  await host.dispatchEvent('compositionstart');
  expect(await page.evaluate(() => (window as any).proof.request(320))).toMatchObject({
    ok: true,
    value: { status: 'deferred' },
  });
  await host.dispatchEvent('compositionend');
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('column');
  await host.dispatchEvent('pointerdown', { pointerId: 7 });
  expect(await page.evaluate(() => (window as any).proof.request(900))).toMatchObject({
    ok: true,
    value: { status: 'deferred' },
  });
  await host.dispatchEvent('pointerup', { pointerId: 7 });
  await expect.poll(() => page.locator('aeliqo-stack').evaluate((el: any) => el.direction)).toBe('row');
  await page.evaluate(() => (window as any).proof.adaptation.disconnect());
  expect(await page.evaluate(() => (window as any).proof.request(320))).toMatchObject({ ok: false });
});
