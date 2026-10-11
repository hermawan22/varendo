import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('shared region preserves input defaults, drafts and semantic targets', async ({ page }) => {
  await page.goto('/tests/input-semantic/index.html');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('Ada');
  await expect(page.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('1.234,50');
  await expect(page.locator('aeliqo-region').locator('[part=region]')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
  await name.fill('Grace');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => (window as any).inputSemantic.requests))
    .toContainEqual({
      nodeId: 'name',
      portId: 'draft',
      payload: { kind: 'draft', entity: 'profile', key: 'self', field: 'name', entityRevision: '1', value: 'Grace' },
    });
  await name.focus();
  await page.evaluate(() => (window as any).inputSemantic.rerender());
  await expect(name).toHaveValue('Grace');
  await expect(name).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
