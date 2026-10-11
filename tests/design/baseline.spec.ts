import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('themes inherit, legacy overrides survive, and direct inputs keep native state', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto('/design.html');
  const input = page.locator('#team input');
  const designRoot = page.locator('#design-root');
  await expect(input).toHaveValue('Research');
  await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(input).toHaveCSS('min-height', '44px');
  await input.fill('Research draft');
  await page.locator('#theme').selectOption('dark');
  await expect(input).toHaveValue('Research draft');
  await expect(input).toHaveCSS('background-color', 'rgb(15, 17, 23)');
  await expect(page.locator('#people th').first()).toHaveCSS('background-color', 'rgb(24, 28, 37)');
  await expect(page.locator('#owner input')).toHaveAttribute('readonly', '');
  await expect(page.locator('#archive input')).toBeDisabled();
  await expect(page.locator('#code input')).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: info.outputPath('dark-1280.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await designRoot.evaluate((element) => {
    const style = (element as HTMLElement).style;
    style.setProperty('--aeliqo-input-color', 'rgb(160, 200, 240)');
    style.setProperty('--aeliqo-input-background', 'rgb(12, 34, 56)');
    style.setProperty('--aeliqo-input-border', 'rgb(200, 120, 80)');
    style.setProperty('--aeliqo-input-focus', 'rgb(250, 210, 70)');
    style.setProperty('--aeliqo-input-description', 'rgb(120, 220, 180)');
    style.setProperty('--aeliqo-input-error', 'rgb(255, 130, 140)');
  });
  await expect(input).toHaveCSS('color', 'rgb(160, 200, 240)');
  await expect(input).toHaveCSS('background-color', 'rgb(12, 34, 56)');
  await expect(input).toHaveCSS('border-top-color', 'rgb(200, 120, 80)');
  await expect(page.locator('#team').locator('[part="description"]')).toHaveCSS('color', 'rgb(120, 220, 180)');
  await expect(page.locator('#code').locator('[part="error"]')).toHaveCSS('color', 'rgb(255, 130, 140)');
  await input.focus();
  await expect(input).toHaveCSS('outline-color', 'rgb(250, 210, 70)');
  await designRoot.evaluate((element) => {
    const style = (element as HTMLElement).style;
    for (const key of [
      'input-color',
      'input-background',
      'input-border',
      'input-focus',
      'input-description',
      'input-error',
    ])
      style.removeProperty(`--aeliqo-${key}`);
  });
  await designRoot.evaluate((element) => {
    const style = (element as HTMLElement).style;
    style.setProperty('--aeliqo-focus-width', '4px');
    style.setProperty('--aeliqo-focus-offset', '5px');
    style.setProperty('--aeliqo-control-border-width', '2px');
    style.setProperty('--aeliqo-control-inline-padding', '18px');
  });
  await input.focus();
  await expect(input).toHaveCSS('outline-width', '4px');
  await expect(input).toHaveCSS('outline-offset', '5px');
  await expect(input).toHaveCSS('border-left-width', '2px');
  await expect(input).toHaveCSS('padding-inline-start', '18px');
  await page.locator('#design-root').evaluate((element) => {
    for (const key of ['focus-width', 'focus-offset', 'control-border-width', 'control-inline-padding'])
      (element as HTMLElement).style.removeProperty(`--aeliqo-${key}`);
  });
  await page.locator('#theme').selectOption('light');
  await input.focus();
  await expect(input).toHaveCSS('outline-style', 'solid');
  await page.screenshot({ path: info.outputPath('light-1280.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('narrow RTL, text scaling and forced colors preserve content access', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/design.html');
  await page.locator('#locale').selectOption('ar-EG');
  await expect(page.locator('#design-root')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#team input')).toHaveCSS('direction', 'rtl');
  await expect(page.locator('#people th')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('rtl-360.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await expect(page.locator('#people th')).toHaveCount(3);
  const scroll = page.locator('#people [part="scroll"]');
  await scroll.focus();
  await scroll.press('ArrowLeft');
  await expect.poll(() => scroll.evaluate((element) => Math.abs(element.scrollLeft))).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('rtl-text-200-320.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.locator('#team input').focus();
  await expect(page.locator('#team input')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('#team')).toHaveCSS('--aeliqo-motion-duration-fast', '0ms');
  await page.screenshot({ path: info.outputPath('forced-colors-320.png'), fullPage: true });
});

test('system preference and explicit ancestor choices remain distinct', async ({ page }, info) => {
  await page.setViewportSize({ width: 768, height: 960 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/design.html');
  const input = page.locator('#team input');
  await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.locator('#theme').selectOption('system');
  await expect(input).toHaveCSS('background-color', 'rgb(15, 17, 23)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.locator('#theme').selectOption('dark');
  await expect(input).toHaveCSS('background-color', 'rgb(15, 17, 23)');
  await page.screenshot({ path: info.outputPath('dark-768.png'), fullPage: true });
});
