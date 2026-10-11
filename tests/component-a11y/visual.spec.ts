import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const family of ['input', 'navigation', 'feedback', 'data-components'])
  for (const variant of ['desktop', 'narrow-dark-rtl']) {
    test(`${family} ${variant} visual and accessibility capture`, async ({ page }, testInfo) => {
      await page.setViewportSize(variant === 'desktop' ? { width: 1280, height: 900 } : { width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: variant === 'desktop' ? 'light' : 'dark', reducedMotion: 'reduce' });
      await page.goto(`/tests/${family}/index.html`);
      await page.waitForFunction(() => Array.from(document.querySelectorAll('*')).some((el) => el.shadowRoot));
      await page.evaluate((narrow) => {
        document.documentElement.dir = narrow ? 'rtl' : 'ltr';
        document.body.style.cssText = `margin:16px;font-family:ui-sans-serif,system-ui;background:${narrow ? '#101318' : '#fff'};color:${narrow ? '#f4f5f7' : '#161a20'}`;
        if (narrow) document.documentElement.style.fontSize = '24px';
      }, variant !== 'desktop');
      if (family === 'input' && variant !== 'desktop') {
        const positions = await page
          .locator('aeliqo-date-range')
          .locator('input')
          .evaluateAll((els) =>
            els.map((el) => ({
              y: el.getBoundingClientRect().y,
              width: el.getBoundingClientRect().width,
              available: el.parentElement!.getBoundingClientRect().width,
            })),
          );
        expect(positions[1]!.y).toBeGreaterThan(positions[0]!.y);
        expect(positions[0]!.width).toBeCloseTo(positions[0]!.available, 0);
      }
      if (family === 'data-components' && variant !== 'desktop') {
        await expect(page.locator('aeliqo-delta').locator('[part="number"]')).toHaveAttribute('dir', 'ltr');
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${family}-${variant}.png`), fullPage: true, timeout: 10000 });
    });
  }
