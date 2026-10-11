import { expect, test, type Page } from '@playwright/test';

async function catalog(page: Page, component: string, direction: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/tests/visual/index.html?component=${component}&variant=narrow-dark-rtl`);
  await page.waitForFunction(() =>
    Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
  );
  await page.evaluate((dir) => {
    document.documentElement.dir = dir;
  }, direction);
}

for (const direction of ['ltr', 'rtl']) {
  test(`switch thumb remains inside its track for checked and unchecked ${direction}`, async ({ page }, info) => {
    await catalog(page, 'switch', direction);
    const host = page.locator('aeliqo-switch');
    const control = host.getByRole('switch');
    await expect(control).toBeChecked();
    const centers: number[] = [];
    for (const checked of [true, false]) {
      if (!checked) await host.locator('.switch-label').click();
      await expect(control).toBeChecked({ checked });
      const track = await host.locator('.switch-track').boundingBox();
      const thumb = await host.locator('.switch-thumb').boundingBox();
      if (track === null || thumb === null) throw new Error('Missing switch geometry');
      expect(thumb.x).toBeGreaterThanOrEqual(track.x);
      expect(thumb.x + thumb.width).toBeLessThanOrEqual(track.x + track.width);
      expect(thumb.y).toBeGreaterThanOrEqual(track.y);
      expect(thumb.y + thumb.height).toBeLessThanOrEqual(track.y + track.height);
      centers.push(thumb.x + thumb.width / 2);
      await page.screenshot({ path: info.outputPath(`switch-${direction}-${checked ? 'checked' : 'unchecked'}.png`) });
    }
    expect(direction === 'rtl' ? centers[0]! < centers[1]! : centers[0]! > centers[1]!).toBe(true);
    await host.evaluate((element) => Object.assign(element, { readOnly: true }));
    await host.locator('.switch-label').click();
    await expect(control).not.toBeChecked();
    await host.evaluate((element) => Object.assign(element, { readOnly: false, disabled: true }));
    await expect(control).toBeDisabled();
  });

  test(`heatmap numeric key follows its physical gradient in ${direction}`, async ({ page }, info) => {
    await catalog(page, 'heatmap', direction);
    const host = page.locator('aeliqo-heatmap');
    const bar = host.locator('[part="color-key-bar"]');
    const tickList = host.locator('[part="color-key-ticks"]');
    await expect(tickList.locator('li')).toHaveText(['96', '120', '144']);
    const ticks = await tickList.locator('li').evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { value: Number(element.textContent), left: bounds.left, right: bounds.right };
      }),
    );
    expect(ticks[0]!.left).toBeLessThan(ticks[1]!.left);
    expect(ticks[1]!.left).toBeLessThan(ticks[2]!.left);
    const bounds = await bar.boundingBox();
    if (bounds === null) throw new Error('Missing quantitative key');
    expect(Math.abs(ticks[0]!.left - bounds.x)).toBeLessThan(1);
    expect(Math.abs(ticks[2]!.right - bounds.x - bounds.width)).toBeLessThan(1);
    await expect(bar).toHaveCSS('background-image', /linear-gradient\(to right,/);
    await page.screenshot({ path: info.outputPath(`heatmap-${direction}.png`), fullPage: true });
  });
}
