import { expect, test, type Locator } from '@playwright/test';
import type { AeliqoHierarchyElementBase } from '../../packages/web/src/visualization/hierarchy/index.js';

for (const direction of ['ltr', 'rtl']) {
  for (const family of ['hierarchy', 'temporal']) {
    test(`${family} stays readable in narrow ${direction} containers`, async ({ page, browserName }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/tests/visualization/${family === 'hierarchy' ? 'index' : 'temporal'}.html`);
      const tags = family === 'hierarchy' ? ['tree', 'treemap', 'relationship'] : ['timeline', 'calendar-grid'];
      for (const width of [240, 320, 480]) {
        for (const tag of tags) {
          const host = page.locator(`aeliqo-${tag}`);
          await host.evaluate(
            (element, settings) => {
              element.setAttribute('dir', settings.direction);
              element.setAttribute('data-aeliqo-theme', settings.direction === 'rtl' ? 'dark' : 'light');
              (element as HTMLElement).style.width = `${settings.width}px`;
            },
            { direction, width },
          );
          await expect(host.locator('td').first()).toHaveCSS('display', 'grid');
          const viewport = host.locator('[part="viewport"]');
          const svg = viewport.locator('svg');
          if (await svg.count()) {
            const dimensions = await svg.evaluate((element) => ({
              displayed: element.getBoundingClientRect().width,
              intrinsic: Number(element.getAttribute('width')),
            }));
            expect(dimensions.displayed).toBeGreaterThanOrEqual(dimensions.intrinsic);
            await viewport.evaluate((element) => {
              element.scrollLeft = 0;
            });
            await verifyScroll(viewport, browserName);
          }
          expect(await host.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
      }
      await page.screenshot({ path: info.outputPath(`${family}-${direction}-480.png`), fullPage: true });
      await page.emulateMedia({ forcedColors: 'active' });
      const button = page.locator(`aeliqo-${tags[0]} [part="data"] button`).first();
      await button.focus();
      await expect(button).toHaveCSS('outline-style', 'solid');
    });
  }
}

test('matrix retains readable columns and keyboard scrolling in a 240px container', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tests/visualization/temporal.html');
  const host = page.locator('aeliqo-matrix');
  await host.evaluate((element) => {
    (element as HTMLElement).style.width = '240px';
  });
  await expect(host.locator('th').first()).toHaveCSS('min-width', '180px');
  const data = host.locator('[part="data"]');
  await verifyScroll(data, browserName);
  expect(await host.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const family of ['hierarchy', 'temporal']) {
  test(`${family} exact data reflows at 320px with enlarged text`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/tests/visualization/${family === 'hierarchy' ? 'index' : 'temporal'}.html`);
    await expect(page.locator(family === 'hierarchy' ? 'aeliqo-tree td' : 'aeliqo-timeline td').first()).toBeVisible();
    for (const scale of ['200%', '400%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, scale);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    }
  });
}

async function verifyScroll(region: Locator, browserName: string): Promise<void> {
  await region.focus();
  await expect(region).toBeFocused();
  const completion = await region.evaluateHandle((element) => {
    const state = { ended: false };
    const finish = () => {
      // A queued event from resetting to zero must not complete the keyboard check.
      if (element.scrollLeft <= 0) return;
      state.ended = true;
      element.removeEventListener('scrollend', finish);
    };
    element.addEventListener('scrollend', finish);
    return state;
  });
  try {
    await region.press('ArrowRight');
    // Headless WebKit also ignores native arrow scrolling in plain HTML overflow regions.
    // Assert its scroll geometry here; Chromium and Firefox prove the native key behavior.
    if (browserName === 'webkit') await region.evaluate((element) => element.scrollBy(40, 0));
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    // Resizing/resetting after only the first pixel can cancel the next native key scroll.
    await expect.poll(() => completion.evaluate((state) => state.ended)).toBe(true);
  } finally {
    await completion.dispose();
  }
}

for (const direction of ['ltr', 'rtl']) {
  test(`investigation caution keeps text inside its border padding in enlarged ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/tests/compound/index.html');
    const host = page.locator('aeliqo-investigation');
    const caution = host.locator('[part="caution"]');
    await expect(caution).toContainText('They do not establish causal claims.');
    for (const size of ['32px', '64px']) {
      await host.evaluate(
        (element, settings) => {
          document.documentElement.dir = settings.direction;
          document.documentElement.style.fontSize = settings.size;
          (element as HTMLElement).style.width = '328px';
          element.setAttribute('data-aeliqo-theme', 'dark');
        },
        { direction, size },
      );
      const geometry = await caution.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const edges: { left: number; right: number }[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
            if (!node.textContent?.[index]?.trim()) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const glyph = range.getBoundingClientRect();
            edges.push({ left: glyph.left, right: glyph.right });
          }
        }
        return {
          contentLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
          textLeft: Math.min(...edges.map((edge) => edge.left)),
          textRight: Math.max(...edges.map((edge) => edge.right)),
          glyphCount: edges.length,
          overflow: element.scrollWidth - element.clientWidth,
        };
      });
      expect(geometry.glyphCount).toBeGreaterThan(0);
      expect(geometry.textLeft, `${size} left inset`).toBeGreaterThanOrEqual(geometry.contentLeft - 1);
      expect(geometry.textRight, `${size} right inset`).toBeLessThanOrEqual(geometry.contentRight + 1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      await expect(caution).toHaveCSS('direction', direction);
      await expect(caution.locator('span')).toHaveCSS('unicode-bidi', 'plaintext');
    }
  });
}

for (const tag of ['timeline', 'calendar-grid']) {
  for (const direction of ['ltr', 'rtl']) {
    test(`${tag} Select labels fit narrow ${direction} controls at enlarged text`, async ({ page }, info) => {
      await page.goto('/tests/visualization/temporal.html');
      const host = page.locator(`aeliqo-${tag}`);
      for (const width of [176, 240, 320, 480, 752]) {
        await page.setViewportSize({ width: Math.max(320, width + 48), height: 900 });
        for (const textScale of [1, 2]) {
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${16 * scale}px`;
            Object.assign(window, { selection: undefined });
          }, textScale);
          await host.evaluate(
            async (element, settings) => {
              element.setAttribute('dir', settings.direction);
              (element as HTMLElement).style.width = `${settings.width}px`;
              const view = element as HTMLElement & { selectedIdentity: string; updateComplete: Promise<unknown> };
              view.selectedIdentity = '';
              await view.updateComplete;
            },
            { width, direction },
          );
          const button = host.locator('[part="data"] button').first();
          const geometry = await button.evaluate((element) => {
            const text = [...element.childNodes].find(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Select'),
            );
            if (text === undefined) throw new Error('Missing Select text');
            const start = text.textContent!.indexOf('Select');
            const range = document.createRange();
            range.setStart(text, start);
            range.setEnd(text, start + 'Select'.length);
            const rects = [...range.getClientRects()].map((rect) => rect.toJSON());
            const box = element.getBoundingClientRect();
            const cell = element.closest('td')!.getBoundingClientRect();
            return { rects, button: box.toJSON(), cell: cell.toJSON() };
          });
          const label = `${tag} ${direction} ${width}px ${textScale * 100}%`;
          expect(geometry.rects, `${label} one-line Select label`).toHaveLength(1);
          expect(geometry.button.width, `${label} target width`).toBeGreaterThanOrEqual(44);
          expect(geometry.button.height, `${label} target height`).toBeGreaterThanOrEqual(44);
          for (const rect of geometry.rects) {
            expect(rect.left, `${label} text start`).toBeGreaterThanOrEqual(geometry.button.left);
            expect(rect.right, `${label} text end`).toBeLessThanOrEqual(geometry.button.right);
            expect(rect.top, `${label} text top`).toBeGreaterThanOrEqual(geometry.button.top);
            expect(rect.bottom, `${label} text bottom`).toBeLessThanOrEqual(geometry.button.bottom);
          }
          expect(geometry.button.left, `${label} control start`).toBeGreaterThanOrEqual(geometry.cell.left);
          expect(geometry.button.right, `${label} control end`).toBeLessThanOrEqual(geometry.cell.right);
          await button.focus();
          await button.press('Enter');
          await expect(button).toHaveAttribute('aria-pressed', 'true');
          const identity = await host.evaluate(
            (element) => (element as HTMLElement & { selectedIdentity: string }).selectedIdentity,
          );
          expect(identity).not.toBe('');
          const receipt = await page.evaluate(
            () => (window as Window & { selection?: { source: string; identity: string } }).selection,
          );
          expect(receipt, `${label} Enter selection receipt`).toMatchObject({ source: 'user', identity });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
            `${label} page containment`,
          ).toBeLessThanOrEqual(Math.max(320, width + 48));
          await host.screenshot({ path: info.outputPath(`${tag}-${direction}-${width}-${textScale}x.png`) });
        }
      }
    });
  }
}

for (const font of ['system-ui', 'monospace']) {
  for (const direction of ['ltr', 'rtl']) {
    test(`hierarchy pagination keeps controls and row summary together in enlarged ${direction} with ${font}`, async ({
      page,
    }, info) => {
      await page.goto('/tests/visualization/index.html');
      const host = page.locator('aeliqo-tree');
      await expect(host.locator('tbody tr')).toHaveCount(3);
      await host.evaluate(async (element, fontFamily) => {
        (element as HTMLElement).style.fontFamily = fontFamily;
        const view = element as AeliqoHierarchyElementBase;
        const result = view.context!.results[0]!;
        const rows = Array.from({ length: 30 }, (_, index) => ({
          id: index === 0 ? 'root' : `node-${index}`,
          parent: index === 0 ? null : 'root',
          label: index === 0 ? 'Root' : `Node ${index}`,
          amount: index + 1,
        }));
        view.context = {
          ...view.context!,
          results: [{ ...result, counts: { ...result.counts, loaded: 30 } }],
        };
        view.datasets = [{ result: result.ref, rows }];
        view.maxMarks = 1;
        await view.updateComplete;
      }, font);
      const nav = host.getByRole('navigation', { name: 'Visualization data pages' });
      const previous = nav.getByRole('button', { name: 'Previous', exact: true });
      const next = nav.getByRole('button', { name: 'Next', exact: true });
      const baseFontSize = await nav.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      for (const width of [240, 320, 480]) {
        await page.setViewportSize({ width: width + 16, height: 900 });
        for (const scale of [2, 4]) {
          await host.evaluate(
            (element, settings) => {
              document.documentElement.dir = settings.direction;
              document.documentElement.style.fontSize = `${16 * settings.scale}px`;
              (element as HTMLElement).style.width = `${settings.width}px`;
            },
            { direction, width, scale },
          );
          await expect(nav).toContainText('Rows 1–25 of 30');
          await expect(previous).toBeDisabled();
          const geometry = await nav.evaluate((element) => ({
            box: element.getBoundingClientRect().toJSON(),
            children: [...element.children].map((child) => ({
              tag: child.tagName,
              fontSize: parseFloat(getComputedStyle(child).fontSize),
              overflow: child.scrollWidth - child.clientWidth,
              boxes: [...child.getClientRects()].map((rect) => rect.toJSON()),
            })),
          }));
          const label = `${width}px ${scale * 100}% ${direction} ${font}`;
          for (const child of geometry.children) {
            expect(child.fontSize, `${label} actual text size`).toBeCloseTo(baseFontSize * scale, 1);
            expect(child.overflow, `${label} ${child.tag} text fits its group`).toBeLessThanOrEqual(1);
            // The summary may wrap internally, but must remain one group between the controls.
            expect(child.boxes, `${label} ${child.tag} remains a single group`).toHaveLength(1);
            const box = child.boxes[0]!;
            expect(box.left, `${label} child start`).toBeGreaterThanOrEqual(geometry.box.left - 1);
            expect(box.right, `${label} child end`).toBeLessThanOrEqual(geometry.box.right + 1);
            if (child.tag === 'BUTTON') {
              expect(box.width, `${label} target width`).toBeGreaterThanOrEqual(44);
              expect(box.height, `${label} target height`).toBeGreaterThanOrEqual(44);
            }
          }
          const boxes = geometry.children.map((child) => child.boxes[0]!);
          for (let index = 1; index < boxes.length; index++) {
            const before = boxes[index - 1]!;
            const after = boxes[index]!;
            const separated =
              after.top >= before.bottom ||
              (direction === 'rtl' ? after.right <= before.left : after.left >= before.right);
            expect(separated, `${label} summary and controls do not interleave`).toBe(true);
          }
          expect(
            await host.evaluate((element) => element.scrollWidth - element.clientWidth),
            label,
          ).toBeLessThanOrEqual(1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth), label).toBeLessThanOrEqual(
            width + 16,
          );
          await next.focus();
          await next.press('Enter');
          await expect(host.locator('tbody tr')).toHaveCount(5);
          await expect(nav).toContainText('Rows 26–30 of 30');
          await expect(next).toBeDisabled();
          await expect(host.locator('tbody tr').first()).toContainText('node-25');
          await previous.focus();
          await previous.press('Enter');
          await expect(host.locator('tbody tr')).toHaveCount(25);
          await expect(nav).toContainText('Rows 1–25 of 30');
          await nav.screenshot({ path: info.outputPath(`pagination-${direction}-${font}-${width}-${scale}x.png`) });
        }
      }
    });
  }
}
