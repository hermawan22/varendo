import { expect, test } from '@playwright/test';

// These tests exercise the rendered controls from source, without depending on package build output.
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/design/controls.html');
  await expect(page.locator('#country select')).toHaveValue('id');
});

test('reduced motion overrides theme defaults and inherited motion tokens', async ({ page }) => {
  const host = page.locator('#button');
  const button = host.locator('button');
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const theme of ['light', 'dark', 'inherit', 'system']) {
      await host.evaluate((element, mode) => {
        if (mode === 'system') element.removeAttribute('data-aeliqo-theme');
        else element.setAttribute('data-aeliqo-theme', mode);
        element.parentElement!.style.setProperty('--aeliqo-motion-duration-fast', '260ms');
        element.parentElement!.style.setProperty('--aeliqo-motion-duration-standard', '360ms');
      }, theme);
      await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
      await expect(button, `${colorScheme}/${theme} default`).toHaveCSS(
        'transition-duration',
        theme === 'inherit' ? '0.26s' : '0.12s',
      );
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect(host, `${colorScheme}/${theme} fast token`).toHaveCSS('--aeliqo-motion-duration-fast', '0ms');
      await expect(host, `${colorScheme}/${theme} standard token`).toHaveCSS(
        '--aeliqo-motion-duration-standard',
        '0ms',
      );
      await expect(button, `${colorScheme}/${theme} computed motion`).toHaveCSS('transition-duration', '0s');
      await button.focus();
      await expect(button).toBeFocused();
      await expect(button).toHaveCSS('outline-style', 'solid');
      await button.hover();
      expect(
        await button.evaluate(
          (element) => element.getAnimations().filter((animation) => animation.playState === 'running').length,
        ),
      ).toBe(0);
    }
  }
});

for (const direction of ['ltr', 'rtl']) {
  test(`select keeps one centered chevron clear of long text in ${direction}`, async ({ page }, info) => {
    await page.locator('#country').evaluate((element, dir) => {
      element.setAttribute('dir', dir);
      Object.assign(element, {
        label: 'A long country label that wraps without clipping its control',
        options: [{ value: 'id', label: 'Indonesia with a very long descriptive country name' }],
      });
    }, direction);
    const select = page.locator('#country select');
    const chevron = page.locator('#country svg');
    await expect(select).toHaveCSS('appearance', 'none');
    await expect(chevron).toHaveCount(1);
    await expect(chevron).toHaveAttribute('aria-hidden', 'true');
    await expect(chevron).toHaveCSS('pointer-events', 'none');
    for (const width of [240, 320, 480]) {
      await page.locator('#country').evaluate((element, size) => {
        (element as HTMLElement).style.width = `${size}px`;
      }, width);
      const field = await select.boundingBox();
      const arrow = await chevron.boundingBox();
      expect(field).not.toBeNull();
      expect(arrow).not.toBeNull();
      if (field === null || arrow === null) throw new Error('Missing control geometry');
      expect(Math.abs(field.y + field.height / 2 - arrow.y - arrow.height / 2)).toBeLessThan(1);
      const endSpace = direction === 'ltr' ? field.x + field.width - arrow.x : arrow.x + arrow.width - field.x;
      const padding = await select.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingInlineEnd));
      expect(padding - endSpace).toBeGreaterThanOrEqual(4);
      expect(await page.locator('#country').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: info.outputPath(`select-${direction}.png`), fullPage: true });
  });
}

test('native select retains keyboard, form, read-only, invalid and forced-color behavior', async ({ page }) => {
  const host = page.locator('#country');
  const select = host.locator('select');
  await select.focus();
  await select.press('u');
  await select.press('Enter');
  await expect(select).toHaveValue('us');
  expect(
    await page.locator('#native-form').evaluate((element) => new FormData(element as HTMLFormElement).get('country')),
  ).toBe('us');
  await host.evaluate((element) => {
    Object.assign(element, { readOnly: true });
  });
  await select.selectOption('id');
  await expect(select).toHaveValue('us');
  await host.evaluate((element) => {
    Object.assign(element, { readOnly: false, error: 'Choose another country' });
    const style = (element as HTMLElement).style;
    style.setProperty('--aeliqo-focus-width', '4px');
    style.setProperty('--aeliqo-focus-offset', '5px');
  });
  await select.focus();
  await expect(select).toHaveAttribute('aria-invalid', 'true');
  await expect(select).toHaveCSS('outline-width', '4px');
  await expect(select).toHaveCSS('outline-offset', '5px');
  await expect(select).toHaveCSS('outline-color', 'rgb(185, 28, 28)');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(host.locator('svg')).toBeHidden();
  await expect(select).toHaveCSS('appearance', 'auto');
  await expect(select).toHaveCSS('outline-style', 'solid');
  await host.evaluate((element) => {
    Object.assign(element, { disabled: true });
  });
  await expect(select).toBeDisabled();
  expect(
    await page.locator('#native-form').evaluate((element) => new FormData(element as HTMLFormElement).has('country')),
  ).toBe(false);
});

test('controls share text size and radius while focus tokens still customize button and combobox', async ({ page }) => {
  const controls = ['#name input', '#country select', '#combo input', '#button button'];
  const metrics = await Promise.all(
    controls.map((selector) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return { font: style.fontSize, radius: style.borderTopLeftRadius };
      }),
    ),
  );
  expect(new Set(metrics.map((metric) => metric.font)).size).toBe(1);
  expect(new Set(metrics.map((metric) => metric.radius)).size).toBe(1);
  await page.locator('#name').evaluate((element) => {
    Object.assign(element, { description: 'Help', error: 'Error', validationState: 'pending' });
  });
  const sizes = await Promise.all(
    ['description', 'error', 'pending'].map((part) =>
      page.locator(`#name [part="${part}"]`).evaluate((element) => getComputedStyle(element).fontSize),
    ),
  );
  expect(new Set(sizes).size).toBe(1);
  for (const selector of ['#button', '#combo']) {
    await page.locator(selector).evaluate((element) => {
      (element as HTMLElement).style.setProperty('--aeliqo-focus-width', '4px');
      (element as HTMLElement).style.setProperty('--aeliqo-focus-offset', '5px');
    });
    const control = page.locator(`${selector} ${selector === '#button' ? 'button' : 'input'}`);
    await control.focus();
    await expect(control).toHaveCSS('outline-width', '4px');
    await expect(control).toHaveCSS('outline-offset', '5px');
  }
});

test.describe('coarse pointer', () => {
  test.use({ hasTouch: true });
  test('compact density and small buttons retain 44px touch targets', async ({ page }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.locator('#fixture').evaluate((element) => {
      for (const child of element.querySelectorAll('*')) {
        if (child.localName.startsWith('aeliqo-')) child.setAttribute('data-aeliqo-density', 'compact');
      }
    });
    await page.locator('#combo input').press('ArrowDown');
    for (const selector of [
      '#name input',
      '#country select',
      '#combo input',
      '#combo [role="option"]',
      '#agree label',
      '#radio [part="option"]',
      '#switch label',
      '#slider input',
      '#button button',
      '#icon-button button',
    ]) {
      const target = page.locator(selector).first();
      await expect(target).toBeVisible();
      expect((await target.boundingBox())?.height, selector).toBeGreaterThanOrEqual(44);
    }
    expect((await page.locator('#icon-button button').boundingBox())?.width).toBeGreaterThanOrEqual(44);
  });
});

test('combobox distinguishes its selected option and preserves high-contrast selection', async ({ page }) => {
  const combo = page.locator('#combo');
  await combo.evaluate((element) => {
    Object.assign(element, { value: 'ada', query: '' });
  });
  await combo.locator('input').focus();
  const selected = combo.locator('[role="option"][aria-selected="true"]');
  await expect(selected).toBeVisible();
  expect(await selected.evaluate((element) => getComputedStyle(element, '::after').content)).toBe('"✓"');
  await page.emulateMedia({ forcedColors: 'active' });
  const colors = await selected.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    text: getComputedStyle(element).color,
  }));
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors.background).not.toBe(colors.text);
  await combo.locator('input').press('Escape');
  await expect(combo.locator('input')).toHaveAttribute('aria-expanded', 'false');
});

for (const theme of ['light', 'dark']) {
  test(`${theme} controls reflow at narrow viewports and text zoom`, async ({ page }, info) => {
    await page.locator('#fixture').evaluate((element, mode) => {
      for (const child of element.querySelectorAll('*')) {
        if (child.localName.startsWith('aeliqo-')) child.setAttribute('data-aeliqo-theme', mode);
      }
    }, theme);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 900 });
    for (const scale of ['200%', '400%']) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, scale);
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll<HTMLElement>('#fixture *')]
          .filter((element) => element.getBoundingClientRect().right > width)
          .map((element) => ({ id: element.id, tag: element.localName, right: element.getBoundingClientRect().right }));
      });
      expect(overflow, scale).toEqual([]);
      const dimensions = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const outside: string[] = [];
        function inspect(root: Document | ShadowRoot) {
          for (const element of root.querySelectorAll('*')) {
            if (element.getBoundingClientRect().right > width)
              outside.push(
                `${element.localName}.${element.className}:${element.getAttribute('type')}:${(element.getRootNode() as ShadowRoot).host?.id}`,
              );
            if (element.shadowRoot) inspect(element.shadowRoot);
          }
        }
        inspect(document);
        return { width, scroll: document.documentElement.scrollWidth, outside };
      });
      expect(dimensions.scroll, JSON.stringify({ scale, ...dimensions })).toBeLessThanOrEqual(dimensions.width);
      await page.screenshot({ path: info.outputPath(`${theme}-320-${scale}.png`), fullPage: true });
    }
  });
}
