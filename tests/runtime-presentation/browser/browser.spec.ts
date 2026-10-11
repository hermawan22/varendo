import { expect, test } from '@playwright/test';

test('holds a resize transition during focused IME draft and retries after focus release', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/index.html');
  const editor = page.locator('aeliqo-region').locator('#editor');
  await editor.fill('draft');
  await editor.focus();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { region: any }).region.snapshot().state?.presentation))
    .toBeUndefined();
  const first = await page.evaluate(async () =>
    (window as typeof window & { requestWide: () => Promise<unknown> }).requestWide(),
  );
  expect(first).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
  await page.evaluate(() => {
    const input = (document.querySelector('aeliqo-region') as HTMLElement).shadowRoot!.querySelector('#editor')!;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  });
  const blocked = await page.evaluate(async () =>
    (window as typeof window & { requestNarrow: () => Promise<unknown> }).requestNarrow(),
  );
  expect(blocked).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
  const before = await page.evaluate(
    () => (window as typeof window & { region: any }).region.snapshot().state?.presentation,
  );
  expect(before).toBeUndefined();
  await page.evaluate(() => {
    const input = (document.querySelector('aeliqo-region') as HTMLElement).shadowRoot!.querySelector('#editor')!;
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true }));
    (input as HTMLInputElement).blur();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { region: any }).region.snapshot().state?.presentation?.nodes[0]?.representation
            .id,
      ),
    )
    .toBe('layout.narrow');
  await expect.poll(() => page.locator('aeliqo-region').locator('#editor').inputValue()).toBe('draft');
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { editor: HTMLInputElement }).editor === document.activeElement),
    )
    .toBe(false);
});

test('holds a transition during an active pointer drag and removes listeners on disconnect', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/index.html');
  await page.evaluate(async () => (window as typeof window & { requestWide: () => Promise<unknown> }).requestWide());
  await page.evaluate(() => {
    const region = document.querySelector('aeliqo-region')!;
    region.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 7, button: 0 }));
  });
  const blocked = await page.evaluate(async () =>
    (window as typeof window & { requestNarrow: () => Promise<unknown> }).requestNarrow(),
  );
  expect(blocked).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, button: 0 })),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { region: any }).region.snapshot().state?.presentation?.nodes[0]?.representation
            .id,
      ),
    )
    .toBe('layout.narrow');
  await page.evaluate(() =>
    (window as typeof window & { adaptation: { disconnect: () => void } }).adaptation.disconnect(),
  );
  const before = await page.evaluate(
    () => (window as typeof window & { region: any }).region.snapshot().regionRevision,
  );
  await page.evaluate(async () => (window as typeof window & { requestWide: () => Promise<unknown> }).requestWide());
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { region: any }).region.snapshot().regionRevision))
    .toBe(before);
});

test('guards focused editable controls when the region is mounted in a nested shadow tree', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/index.html');
  await page.evaluate(async () => (window as typeof window & { requestWide: () => Promise<unknown> }).requestWide());
  await page.evaluate(() => {
    const region = document.querySelector('aeliqo-region')!;
    const outerHost = document.createElement('div');
    outerHost.id = 'outer-host';
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    outerRoot.append(region);
    document.body.append(outerHost);
    (region.shadowRoot!.querySelector('#editor') as HTMLInputElement).focus();
  });
  const blocked = await page.evaluate(async () =>
    (window as typeof window & { requestNarrow: () => Promise<unknown> }).requestNarrow(),
  );
  expect(blocked).toMatchObject({ ok: true, value: { status: 'deferred', reason: 'transition-blocked' } });
  await page.evaluate(() =>
    (
      document
        .querySelector('#outer-host')!
        .shadowRoot!.querySelector('aeliqo-region')!
        .shadowRoot!.querySelector('#editor') as HTMLInputElement
    ).blur(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { region: any }).region.snapshot().state?.presentation?.nodes[0]?.representation
            .id,
      ),
    )
    .toBe('layout.narrow');
});

test('re-resolves live when media preferences change under auto observation', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/index.html');
  await page.evaluate(() => (window as typeof window & { observeMedia: () => void }).observeMedia());
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { contextReads: () => number }).contextReads()))
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as typeof window & { contextReads: () => number }).contextReads());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { contextReads: () => number }).contextReads()))
    .toBeGreaterThan(before);
  await page.evaluate(() => (window as typeof window & { disconnectObserved: () => void }).disconnectObserved());
  const settled = await page.evaluate(() => (window as typeof window & { contextReads: () => number }).contextReads());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as typeof window & { contextReads: () => number }).contextReads())).toBe(
    settled,
  );
});

type ResizeFixtureWindow = typeof window & {
  resizeFixture: {
    snapshot(): {
      environment: {
        inlineSize: { state: string; value?: number };
        blockSize: { state: string; value?: number };
      };
      queries: number;
      recipeCalls: number;
      renderedWidths: number[];
    };
    dispose(): void;
  };
};

test('app reevaluates host layouts within one width category and on height changes without data requests', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/app-resize.html');
  await expect(page.locator('aeliqo-table')).toContainText('Ada');
  const snapshot = () => page.evaluate(() => (window as ResizeFixtureWindow).resizeFixture.snapshot());
  await expect.poll(async () => (await snapshot()).environment.inlineSize.value).toBe(1440);
  await page.locator('#target').evaluate((target) => {
    target.style.width = '900px';
  });
  await expect.poll(async () => (await snapshot()).environment.inlineSize.value).toBe(900);
  await page.locator('#target').evaluate((target) => {
    target.style.height = '420px';
  });
  await expect.poll(async () => (await snapshot()).environment.blockSize.value).toBe(420);
  expect((await snapshot()).queries).toBe(1);
  expect((await snapshot()).renderedWidths).toContain(900);
  await expect(page.locator('aeliqo-table')).toContainText('Ada');
  const settled = (await snapshot()).recipeCalls;
  await page.waitForTimeout(100);
  expect((await snapshot()).recipeCalls).toBe(settled);
  await page.evaluate(() => (window as ResizeFixtureWindow).resizeFixture.dispose());
  await page.locator('#target').evaluate((target) => {
    target.style.width = '1100px';
  });
  await page.waitForTimeout(100);
  expect((await snapshot()).recipeCalls).toBe(settled);
});

test('app defers same-category resize during IME and focus ownership then uses the latest size', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-resize.html');
  const editor = page.locator('aeliqo-region').locator('#editor');
  await editor.fill('draft');
  await editor.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  });
  await page.locator('#target').evaluate((target) => {
    target.style.width = '900px';
    target.style.height = '420px';
  });
  await page.waitForTimeout(100);
  const snapshot = () => page.evaluate(() => (window as ResizeFixtureWindow).resizeFixture.snapshot());
  expect((await snapshot()).environment.inlineSize.value).toBe(1440);
  await editor.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(100);
  expect((await snapshot()).environment.inlineSize.value).toBe(1440);
  await editor.evaluate((input) => input.blur());
  await expect.poll(async () => (await snapshot()).environment.inlineSize.value).toBe(900);
  expect((await snapshot()).environment.blockSize.value).toBe(420);
  expect((await snapshot()).queries).toBe(1);
  await expect(editor).toHaveValue('draft');
});
