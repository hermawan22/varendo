import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const family of ['input', 'navigation', 'feedback', 'data-components']) {
  test(`${family} fixture retains valid accessible component semantics`, async ({ page }) => {
    await page.goto(`/tests/${family}/index.html`);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('*')).some((el) => el.shadowRoot));
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
    if (family === 'data-components') {
      await page.locator('#cards').evaluate(async (el: any) => {
        el.selection = 'multiple';
        await el.updateComplete;
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await expect(page.locator('#cards').getByRole('heading')).toHaveCount(2);
    }
  });
}
