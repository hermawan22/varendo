import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/foundation/index.html');
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { aeliqoFoundationReady?: boolean }).aeliqoFoundationReady),
    )
    .toBe(true);
});

test('native action controls submit, reset and cancellation exactly once', async ({ page }) => {
  const form = page.locator('#action-form');
  const draft = page.locator('#draft');
  await draft.fill('changed');
  await page.locator('#submit').locator('button').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              aeliqoFoundationStats: () => {
                submits: number;
                resets: number;
                submittedEntries: readonly [string, FormDataEntryValue][];
              };
            }
          ).aeliqoFoundationStats().submits,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              aeliqoFoundationStats: () => {
                submits: number;
                resets: number;
                submittedEntries: readonly [string, FormDataEntryValue][];
              };
            }
          ).aeliqoFoundationStats().submittedEntries,
      ),
    )
    .toEqual([
      ['draft', 'changed'],
      ['intent', 'save'],
    ]);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { aeliqoFoundationEvents: { kind: string; event: CustomEvent }[] }
      ).aeliqoFoundationEvents
        .filter((entry) => entry.kind === 'action')
        .map((entry) => entry.event.detail),
    ),
  ).toEqual([{ source: 'user', action: 'button', type: 'submit' }]);
  expect(await page.locator('#submit').getAttribute('type')).toBe('submit');
  await page.locator('#cancelled').locator('button').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { aeliqoFoundationStats: () => { submits: number; resets: number } }
          ).aeliqoFoundationStats().submits,
      ),
    )
    .toBe(1);
  await page.locator('#reset').locator('button').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { aeliqoFoundationStats: () => { submits: number; resets: number } }
          ).aeliqoFoundationStats().resets,
      ),
    )
    .toBe(1);
  await expect(draft).toHaveValue('initial');

  const submit = page.locator('#submit');
  await submit.evaluate((element) => {
    (element as HTMLElement & { pending: boolean }).pending = true;
  });
  await expect(submit.locator('button')).toBeDisabled();
  await submit
    .locator('button')
    .press('Enter')
    .catch(() => undefined);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { aeliqoFoundationStats: () => { submits: number; resets: number } }
          ).aeliqoFoundationStats().submits,
      ),
    )
    .toBe(1);
  await expect(page.locator('#icon button')).toHaveAttribute('aria-label', 'Open details');
});

test('links, identity fallback, hierarchy and composed foundations retain semantics', async ({ page }) => {
  await expect(page.locator('#unsafe-link').locator('a')).toHaveCount(0);
  await expect(page.locator('#external-link').locator('a')).toHaveAttribute('target', '_blank');
  await expect(page.locator('#external-link').locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('#avatar').locator('[part=initials]')).toHaveText('AL');
  await expect(page.locator('#avatar').locator('[part=avatar]')).toHaveAttribute('role', 'img');
  await expect(page.locator('#heading').locator('h3')).toHaveClass(/display/);
  await expect(page.locator('#composition').locator('aeliqo-stack')).toHaveCount(1);
  await expect(page.locator('#composition').locator('aeliqo-grid')).toHaveCount(1);
  await expect(page.locator('#scroll').locator('[part=scroll]')).toHaveAttribute('role', 'region');
  await expect(page.locator('#scroll').locator('[part=scroll]')).toHaveAttribute('aria-label', 'Results');
});

test('scroll areas constrain their viewport, separators follow properties, and surfaces expose names', async ({
  page,
}) => {
  const scroll = page.locator('#constrained-scroll').locator('[part=scroll]');
  const scrollMetrics = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(scrollMetrics.clientHeight).toBeLessThan(scrollMetrics.scrollHeight);
  await scroll.focus();
  await scroll.press('PageDown');
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const separatorHost = page.locator('#vertical-separator');
  const separator = separatorHost.locator('[part=separator]');
  const horizontalBox = await separator.boundingBox();
  if (horizontalBox === null) throw new Error('separator is not measurable');
  expect(horizontalBox.width).toBeGreaterThan(15);
  expect(horizontalBox.height).toBeLessThan(5);
  await separatorHost.evaluate((element) => {
    (element as HTMLElement & { orientation: 'horizontal' | 'vertical' }).orientation = 'vertical';
  });
  await expect
    .poll(async () => {
      const box = await separator.boundingBox();
      return box === null ? { width: 0, height: 0 } : { width: box.width, height: box.height };
    })
    .toEqual({ width: 1, height: 100 });

  const surface = page.locator('#labelled-surface');
  await expect(surface).toHaveAttribute('role', 'region');
  await expect(surface).toHaveAccessibleName('Panel title');
  await surface.evaluate((element) => {
    const surfaceElement = element as HTMLElement & { labelledBy: string; label: string };
    surfaceElement.labelledBy = '';
    surfaceElement.label = 'Explicit panel';
  });
  await expect(surface).toHaveAccessibleName('Explicit panel');
});

test('split pane provides keyboard and RTL pointer semantics', async ({ page }) => {
  const split = page.locator('#split');
  const splitter = split.locator('[part=splitter]');
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
  await expect(splitter).toHaveAttribute('aria-controls', 'aeliqo-split-primary');
  await expect(splitter).toHaveAccessibleName('Resize panes');
  await expect(split.locator('[part=start]')).toHaveAttribute('role', 'region');
  await expect(split.locator('[part=start]')).toHaveAttribute('aria-label', 'Primary pane');

  const width = async (): Promise<number> => (await split.locator('[part=start]').boundingBox())?.width ?? 0;
  const initialWidth = await width();
  await split.evaluate((element) => {
    (element as HTMLElement & { position: number | undefined }).position = 20;
  });
  await expect.poll(width).toBeLessThan(initialWidth - 10);
  const minimumWidth = await width();
  await split.evaluate((element) => {
    (element as HTMLElement & { position: number | undefined }).position = 80;
  });
  await expect.poll(width).toBeGreaterThan(minimumWidth + 10);

  await split.evaluate((element) => {
    const splitPane = element as HTMLElement & { defaultPosition: number; position: number | undefined };
    splitPane.position = undefined;
    splitPane.defaultPosition = 50;
  });
  await expect.poll(width).toBeGreaterThan(minimumWidth + 10);

  await splitter.focus();
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '55');
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '20');
  await splitter.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '80');
  const box = await splitter.boundingBox();
  if (box === null) throw new Error('splitter is not measurable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const splitBox = await split.boundingBox();
  if (splitBox === null) throw new Error('split pane is not measurable');
  await page.mouse.move(splitBox.x + 2, box.y + box.height / 2);
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', '20');
  await expect.poll(width).toBeLessThan(minimumWidth + 10);
  await page.locator('html').evaluate((element) => {
    (element as HTMLElement).dir = 'rtl';
  });
  await splitter.press('End');
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '75');

  const vertical = page.locator('#vertical-split');
  const verticalSplitter = vertical.locator('[part=splitter]');
  await expect(verticalSplitter).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(verticalSplitter).toHaveAttribute('aria-controls', 'aeliqo-split-primary');
  const height = async (): Promise<number> => (await vertical.locator('[part=start]').boundingBox())?.height ?? 0;
  const initialHeight = await height();
  await vertical.evaluate((element) => {
    (element as HTMLElement & { position: number | undefined }).position = 20;
  });
  await expect.poll(height).toBeLessThan(initialHeight - 10);
  const minimumHeight = await height();
  await vertical.evaluate((element) => {
    (element as HTMLElement & { position: number | undefined }).position = 80;
  });
  await expect.poll(height).toBeGreaterThan(minimumHeight + 10);
  await vertical.evaluate((element) => {
    const splitPane = element as HTMLElement & { defaultPosition: number; position: number | undefined };
    splitPane.position = undefined;
    splitPane.defaultPosition = 80;
  });
  await expect.poll(height).toBeGreaterThan(minimumHeight + 10);
  await verticalSplitter.focus();
  await verticalSplitter.press('Home');
  await expect(verticalSplitter).toHaveAttribute('aria-valuenow', '20');
  const verticalBox = await verticalSplitter.boundingBox();
  const verticalSplitBox = await vertical.boundingBox();
  if (verticalBox === null || verticalSplitBox === null) throw new Error('vertical split is not measurable');
  await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalBox.y + verticalBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalSplitBox.y + 2);
  await page.mouse.up();
  await expect.poll(height).toBeLessThan(minimumHeight + 10);

  const eventCount = await page.evaluate(
    () => (window as typeof window & { aeliqoFoundationEvents: unknown[] }).aeliqoFoundationEvents.length,
  );
  expect(eventCount).toBeGreaterThanOrEqual(8);
});

test('split pane rejects malformed numeric properties without exposing NaN geometry', async ({ page }) => {
  const split = page.locator('#split');
  await split.evaluate((element) => {
    const splitPane = element as HTMLElement & { defaultPosition: number; min: number; max: number; position: number };
    splitPane.defaultPosition = Number.NaN;
    splitPane.min = Number.NaN;
    splitPane.max = Number.NaN;
    splitPane.position = Number.NaN;
  });
  const splitter = split.locator('[part=splitter]');
  await expect(splitter).toHaveAttribute('aria-valuenow', '50');
  await expect(splitter).toHaveAttribute('aria-valuemin', '20');
  await expect(splitter).toHaveAttribute('aria-valuemax', '80');
  await expect(split.locator('[part=start]')).toHaveCSS('flex-basis', /.+/);
  const geometry = await split.locator('[part=start]').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(Number.isFinite(geometry.width)).toBe(true);
  expect(Number.isFinite(geometry.height)).toBe(true);
});

test('mount and dispose leaves no foundation nodes behind', async ({ page }) => {
  await page.evaluate(() => {
    for (let index = 0; index < 100; index += 1) {
      const element = document.createElement('aeliqo-split-pane');
      element.innerHTML = '<span slot="start">start</span><span slot="end">end</span>';
      document.body.append(element);
      element.remove();
    }
  });
  await expect(page.locator('body > aeliqo-split-pane')).toHaveCount(0);
});

test('forced colors, RTL and large text preserve visible controls', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((element) => {
    (element as HTMLElement).dir = 'rtl';
  });
  await page.locator('body').evaluate((element) => {
    element.style.fontSize = '200%';
  });
  await expect(page.locator('#submit button')).toBeVisible();
  await expect(page.locator('#icon button')).toBeVisible();
  await expect(page.locator('#split [part=splitter]')).toBeVisible();
  await expect(page.locator('#scroll [part=scroll]')).toBeVisible();
  const overflow = await page.locator('#fixture').evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
});

test('validated foundation composition dispatches host requests and preserves focused nodes', async ({ page }) => {
  await page.goto('/tests/foundation/semantic.html');
  const region = page.locator('#semantic');
  await expect(region.locator('[data-aeliqo-node-id]')).toHaveCount(13);
  await expect(region.locator('aeliqo-heading')).toHaveText('Account preferences');
  const button = region.locator('aeliqo-button button');
  await button.click();
  await region.locator('aeliqo-link a').click();
  const state = () =>
    page.evaluate(() => {
      const f = (window as any).foundationSemantic;
      return { requests: f.requests, submits: f.stats().submits };
    });
  expect(await state()).toEqual({
    submits: 0,
    requests: [
      {
        nodeId: 'button',
        portId: 'action',
        payload: {
          kind: 'action-request',
          action: { id: 'profile.save', revision: '1' },
          input: { profileId: 'self' },
        },
      },
      {
        nodeId: 'link',
        portId: 'navigate',
        payload: { kind: 'navigate', route: { id: 'profile.open', revision: '1' }, params: { profileId: 'self' } },
      },
    ],
  });
  expect(new URL(page.url()).pathname).toBe('/tests/foundation/semantic.html');
  const splitter = region.locator('aeliqo-split-pane [part=splitter]');
  await splitter.focus();
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '55');
  await page.evaluate(() => {
    (window as any).foundationSemantic.rerender();
  });
  await expect(splitter).toBeFocused();
  await expect(splitter).toHaveAttribute('aria-valuenow', '55');
});

for (const variant of ['light', 'dark', 'mobile', 'rtl-large', 'forced-colors'] as const) {
  test(`foundation semantic visual and accessibility matrix: ${variant}`, async ({ page }, testInfo) => {
    if (variant === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
    if (variant === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/tests/foundation/semantic.html');
    await expect(page.locator('#semantic aeliqo-button button')).toBeVisible();
    if (variant === 'dark')
      await page.locator('#semantic').evaluate((e) => e.setAttribute('data-aeliqo-theme', 'dark'));
    if (variant === 'rtl-large')
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
        document.documentElement.style.fontSize = '200%';
      });
    const result = await new AxeBuilder({ page }).include('#semantic').analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`foundation-${variant}.png`), fullPage: true });
  });
}
