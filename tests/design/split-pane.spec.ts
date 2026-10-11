import { expect, test, type Locator } from '@playwright/test';

async function expectContainedFocus(splitter: Locator) {
  const paint = await splitter.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: parseFloat(style.outlineWidth),
      offset: parseFloat(style.outlineOffset),
      shadow: style.boxShadow,
      minimumExtent: Math.min(element.clientWidth, element.clientHeight),
    };
  });
  expect(paint.width).toBeGreaterThan(0);
  expect(paint.width + paint.offset).toBeLessThanOrEqual(0);
  expect(-paint.offset * 2).toBeLessThan(paint.minimumExtent);
  expect(paint.shadow).toBe('none');
}

for (const direction of ['ltr', 'rtl']) {
  test(`split pane separates enlarged text and preserves resizing in ${direction}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/tests/visual/index.html?component=split-pane&variant=narrow-dark-rtl');
    await page.waitForFunction(() =>
      Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
    );
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
    }, direction);
    const host = page.locator('aeliqo-split-pane');
    const splitter = host.getByRole('separator');
    for (const width of [240, 320]) {
      await host.evaluate((element, size) => {
        (element as HTMLElement).style.width = `${size}px`;
      }, width);
      const geometry = await host.evaluate((element) => {
        const root = element.shadowRoot!;
        const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect().toJSON();
        const label = element.querySelector('[slot="end"]')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        return {
          host: element.getBoundingClientRect().toJSON(),
          splitter: box('[part="splitter"]'),
          start: box('[part="start"]'),
          end: box('[part="end"]'),
          text: range.getBoundingClientRect().toJSON(),
          direction: getComputedStyle(element).direction,
          rootFont: getComputedStyle(document.documentElement).fontSize,
        };
      });
      await info.attach(`geometry-${width}.json`, {
        body: JSON.stringify(geometry, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath(`split-${direction}-${width}.png`) });
      expect(geometry.rootFont).toBe('32px');
      if (direction === 'rtl') {
        expect(geometry.end.right).toBeLessThanOrEqual(geometry.splitter.left);
        expect(geometry.text.right).toBeLessThanOrEqual(geometry.splitter.left);
        expect(geometry.start.left).toBeGreaterThanOrEqual(geometry.splitter.right);
      } else {
        expect(geometry.start.right).toBeLessThanOrEqual(geometry.splitter.left);
        expect(geometry.end.left).toBeGreaterThanOrEqual(geometry.splitter.right);
        expect(geometry.text.left).toBeGreaterThanOrEqual(geometry.splitter.right);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await splitter.focus();
    await splitter.press('Home');
    await expect(splitter).toHaveAttribute('aria-valuenow', '20');
    await splitter.press(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    await expect(splitter).toHaveAttribute('aria-valuenow', '25');
    await splitter.press('End');
    await expect(splitter).toHaveAttribute('aria-valuenow', '80');
    for (const fontSize of [16, 32]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontSize);
      await expectContainedFocus(splitter);
      await page.screenshot({ path: info.outputPath(`split-focused-${direction}-${fontSize}.png`) });
    }
    const target = await splitter.boundingBox();
    const bounds = await host.boundingBox();
    if (!target || !bounds) throw new Error('Missing split pane geometry');
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, target.y + target.height / 2);
    await page.mouse.up();
    // Firefox/WebKit quantize native pointer coordinates; retain the grab point within one CSS pixel.
    expect(Math.abs(Number(await splitter.getAttribute('aria-valuenow')) - 50)).toBeLessThanOrEqual(
      100 / (bounds.width - target.width),
    );
  });
}

test('vertical split reserves its resize handle between enlarged panes', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/visual/index.html?component=split-pane&variant=narrow-dark-rtl');
  await page.waitForFunction(() =>
    Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
  );
  const host = page.locator('aeliqo-split-pane');
  await host.evaluate((element) => {
    Object.assign(element, { orientation: 'vertical' });
    Object.assign((element as HTMLElement).style, { width: '240px', height: '320px' });
  });
  const splitter = host.getByRole('separator');
  await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
  const geometry = await host.evaluate((element) => {
    const root = element.shadowRoot!;
    const box = (part: string) => root.querySelector(`[part="${part}"]`)!.getBoundingClientRect().toJSON();
    return { start: box('start'), end: box('end'), splitter: box('splitter') };
  });
  expect(geometry.start.bottom).toBeLessThanOrEqual(geometry.splitter.top);
  expect(geometry.end.top).toBeGreaterThanOrEqual(geometry.splitter.bottom);
  expect(geometry.splitter.height).toBe(16);
  await page.screenshot({ path: info.outputPath('split-vertical-240.png') });
  await splitter.focus();
  await splitter.press('Home');
  await splitter.press('ArrowDown');
  await expect(splitter).toHaveAttribute('aria-valuenow', '25');
});

test.describe('coarse pointer', () => {
  test.use({ hasTouch: true });
  for (const orientation of ['horizontal', 'vertical']) {
    test(`${orientation} compact handle reserves 44px and accepts native touch`, async ({
      page,
      browserName,
    }, info) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto('/tests/visual/index.html?component=split-pane&variant=narrow-dark-rtl');
      await page.waitForFunction(() =>
        Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
      );
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const host = page.locator('aeliqo-split-pane');
      const splitter = host.getByRole('separator');
      await host.evaluate((element, axis) => {
        Object.assign(element, { orientation: axis });
        element.setAttribute('data-aeliqo-density', 'compact');
        Object.assign((element as HTMLElement).style, { width: '240px', height: '240px' });
        element.addEventListener('pointerdown', (event) =>
          element.setAttribute('data-pointer', (event as PointerEvent).pointerType),
        );
      }, orientation);
      for (const fontSize of [16, 32]) {
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(
            ({ fontSize, direction }) => {
              document.documentElement.style.fontSize = `${fontSize}px`;
              document.documentElement.dir = direction;
            },
            { fontSize, direction },
          );
          const geometry = await host.evaluate((element) => {
            const box = (part: string) =>
              element.shadowRoot!.querySelector(`[part="${part}"]`)!.getBoundingClientRect().toJSON();
            return { start: box('start'), end: box('end'), splitter: box('splitter') };
          });
          expect(geometry.splitter.width).toBeGreaterThanOrEqual(44);
          expect(geometry.splitter.height).toBeGreaterThanOrEqual(44);
          if (orientation === 'vertical') {
            expect(geometry.start.bottom).toBeLessThanOrEqual(geometry.splitter.top);
            expect(geometry.end.top).toBeGreaterThanOrEqual(geometry.splitter.bottom);
          } else if (direction === 'rtl') {
            expect(geometry.end.right).toBeLessThanOrEqual(geometry.splitter.left);
            expect(geometry.start.left).toBeGreaterThanOrEqual(geometry.splitter.right);
          } else {
            expect(geometry.start.right).toBeLessThanOrEqual(geometry.splitter.left);
            expect(geometry.end.left).toBeGreaterThanOrEqual(geometry.splitter.right);
          }
          expect(await host.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
          await splitter.tap();
          await expect(host).toHaveAttribute('data-pointer', 'touch');
          for (const position of [25, 75]) {
            const target = await splitter.boundingBox();
            const bounds = await host.locator('[part="split"]').boundingBox();
            if (!target || !bounds) throw new Error('Missing resize geometry');
            const vertical = orientation === 'vertical';
            const handleSize = vertical ? target.height : target.width;
            const available = (vertical ? bounds.height : bounds.width) - handleSize;
            const fraction = !vertical && direction === 'rtl' ? 1 - position / 100 : position / 100;
            const destination = handleSize / 2 + available * fraction;
            await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
            await page.mouse.down();
            await page.mouse.move(
              vertical ? target.x + target.width / 2 : bounds.x + destination,
              vertical ? bounds.y + destination : target.y + target.height / 2,
            );
            await page.mouse.up();
            expect(Math.abs(Number(await splitter.getAttribute('aria-valuenow')) - position)).toBeLessThanOrEqual(
              100 / available,
            );
            const primary = await host.locator('[part="start"]').boundingBox();
            const secondary = await host.locator('[part="end"]').boundingBox();
            if (!primary || !secondary) throw new Error('Missing resized panes');
            expect(Math.abs((vertical ? primary.height : primary.width) - (available * position) / 100)).toBeLessThan(
              1,
            );
            expect(vertical ? secondary.height : secondary.width).toBeGreaterThan(0);
          }
          const handle = await splitter.boundingBox();
          const split = await host.locator('[part="split"]').boundingBox();
          if (!handle || !split) throw new Error('Missing edge-grab target');
          const vertical = orientation === 'vertical';
          const grabX = vertical ? handle.x + handle.width / 2 : handle.x + 1;
          const grabY = vertical ? handle.y + 1 : handle.y + handle.height / 2;
          const previous = Number(await splitter.getAttribute('aria-valuenow'));
          await page.mouse.move(grabX, grabY);
          await page.mouse.down();
          await page.mouse.move(grabX + (vertical ? 0 : 1), grabY + (vertical ? 1 : 0));
          await page.mouse.up();
          const available = vertical ? split.height - handle.height : split.width - handle.width;
          const expected = previous + (100 / available) * (!vertical && direction === 'rtl' ? -1 : 1);
          expect(Math.abs(Number(await splitter.getAttribute('aria-valuenow')) - expected)).toBeLessThan(0.02);
          const textBounds = await host.evaluate((element) =>
            ['start', 'end'].map((part) => {
              const pane = element.shadowRoot!.querySelector<HTMLElement>(`[part="${part}"]`)!;
              const label = element.querySelector(`[slot="${part}"]`)!;
              const range = document.createRange();
              range.selectNodeContents(label);
              const bounds = pane.getBoundingClientRect();
              const fragments = [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right }));
              pane.scrollTop = pane.scrollHeight;
              const last = [...range.getClientRects()].at(-1)!;
              const bottomReachable = last.bottom <= bounds.bottom + 1;
              pane.scrollTop = 0;
              return { left: bounds.left, right: bounds.right, fragments, bottomReachable };
            }),
          );
          for (const pane of textBounds) {
            for (const fragment of pane.fragments) {
              expect(fragment.left).toBeGreaterThanOrEqual(pane.left - 1);
              expect(fragment.right).toBeLessThanOrEqual(pane.right + 1);
            }
            expect(pane.bottomReachable).toBe(true);
          }
        }
      }
      await page.screenshot({ path: info.outputPath(`split-touch-${orientation}.png`) });
      await splitter.focus();
      await splitter.press('Home');
      for (let step = 0; step < 6; step++) await splitter.press(orientation === 'vertical' ? 'ArrowDown' : 'ArrowLeft');
      await expect(splitter).toHaveAttribute('aria-valuenow', '50');
      await expectContainedFocus(splitter);
      await page.screenshot({ path: info.outputPath(`split-touch-balanced-${orientation}.png`) });
      if (browserName === 'chromium') {
        // CDP delivers a native touch sequence; Playwright's cross-browser touchscreen API only exposes taps.
        const session = await page.context().newCDPSession(page);
        const target = await splitter.boundingBox();
        const bounds = await host.boundingBox();
        if (!target || !bounds) throw new Error('Missing touch target');
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2 }],
        });
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x:
                orientation === 'horizontal'
                  ? bounds.x + target.width / 2 + (bounds.width - target.width) * 0.75
                  : target.x + target.width / 2,
              y:
                orientation === 'vertical'
                  ? bounds.y + target.height / 2 + (bounds.height - target.height) * 0.25
                  : target.y + target.height / 2,
            },
          ],
        });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(splitter).toHaveAttribute('aria-valuenow', '25');
        await session.detach();
      }
    });
  }
});
