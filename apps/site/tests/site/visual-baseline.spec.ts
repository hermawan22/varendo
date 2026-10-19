import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const outputRoot = resolve(import.meta.dirname, '../../artifacts/site-visual-baseline');
const widths = [360, 768, 1440] as const;
const themes = ['light', 'dark'] as const;
const routes = [
  { id: 'landing', path: '/', title: 'Varendo' },
  { id: 'docs', path: '/docs/', title: 'Documentation' },
  { id: 'component', path: '/components/data.table/', title: 'Table' },
  { id: 'playground', path: '/playground/', title: 'Playground' },
] as const;

for (const route of routes) {
  for (const theme of themes) {
    for (const width of widths) {
      test(`${route.id} in ${theme} at ${width}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });

        await page.setViewportSize({ width, height: 960 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(route.path);
        await expect(page.locator('main')).toBeVisible();

        if (route.id === 'landing') {
          await expect(page.locator('#demo-status')).toContainText('4 of 4');
          if (width === 1440) await expect(page.locator('#home-demo varendo-table')).toBeVisible();
        }
        if (route.id === 'docs')
          await expect(page.getByRole('heading', { level: 1 })).toHaveText('Build interfaces that adapt to the task');
        if (route.id === 'component') {
          await expect(page.locator('[data-preview-status]')).toHaveText('Interactive preview loaded.');
        }
        if (route.id === 'playground') {
          await expect(page.locator('#pg-boot')).toBeHidden();
          await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
        }

        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const layout = await page.evaluate(() => {
          const main = document.querySelector('main');
          if (main === null) throw new Error('The main landmark is missing.');
          const rect = main.getBoundingClientRect();
          return {
            documentWidth: document.documentElement.scrollWidth,
            mainWidth: rect.width,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            colorScheme: getComputedStyle(document.documentElement).colorScheme,
            userAgent: navigator.userAgent,
          };
        });
        expect(layout.documentWidth).toBeLessThanOrEqual(width);
        expect(layout.mainWidth).toBeGreaterThan(0);
        expect(layout.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
        expect(layout.colorScheme).toBe(theme);
        expect(errors).toEqual([]);

        await mkdir(outputRoot, { recursive: true });
        const imagePath = resolve(outputRoot, `${route.id}-${theme}-${width}.png`);
        await page.screenshot({ path: imagePath, fullPage: true, animations: 'disabled' });
        const image = await readFile(imagePath);
        await writeFile(
          imagePath.replace(/\.png$/u, '.json'),
          `${JSON.stringify(
            {
              route: route.path,
              title: route.title,
              viewport: { width, height: 960 },
              theme,
              documentWidth: layout.documentWidth,
              userAgent: layout.userAgent,
              sha256: createHash('sha256').update(image).digest('hex'),
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      });
    }
  }
}
