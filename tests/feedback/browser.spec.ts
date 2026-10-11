import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/feedback/index.html');
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { aeliqoFeedbackReady?: boolean }).aeliqoFeedbackReady))
    .toBe(true);
});

test('tooltip is supplemental, focusable and dismissible', async ({ page }) => {
  const tooltip = page.locator('#tooltip');
  const trigger = tooltip.getByRole('button', { name: 'Help' });
  await expect(trigger).toHaveAccessibleName('Help');
  await trigger.focus();
  await expect(tooltip.locator('[role=tooltip]')).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-describedby', /content/);
  await trigger.hover();
  const surface = tooltip.locator('[role=tooltip]');
  const triggerBox = await trigger.boundingBox();
  const surfaceBox = await surface.boundingBox();
  if (triggerBox === null || surfaceBox === null) throw new Error('Tooltip geometry is unavailable.');
  await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height + 2);
  await page.mouse.move(surfaceBox.x + surfaceBox.width / 2, surfaceBox.y + surfaceBox.height / 2);
  await page.waitForTimeout(150);
  await expect(surface).toBeVisible();
  await trigger.press('Escape');
  await expect(tooltip.locator('[role=tooltip]')).toBeHidden();
  await expect(trigger).toHaveAccessibleName('Help');
});

test('popover distinguishes nonmodal dismissal from modal focus containment', async ({ page }) => {
  const popover = page.locator('#popover');
  const trigger = popover.getByRole('button', { name: 'Details' });
  await trigger.focus();
  await trigger.press('Enter');
  const firstSurface = popover.locator('[part=popover]');
  await expect(firstSurface).toBeVisible();
  const action = popover.getByRole('button', { name: 'Popover action' });
  await action.focus();
  await popover.evaluate((element) => {
    (element as HTMLElement & { modal: boolean }).modal = true;
  });
  const modalSurface = popover.locator('[part=popover]');
  await expect(modalSurface).toHaveAttribute('aria-modal', 'true');
  await expect(action).toBeFocused();
  await popover.evaluate((element) => {
    (element as HTMLElement & { modal: boolean }).modal = false;
  });
  await expect(popover.locator('[part=popover]')).toHaveAttribute('aria-modal', 'false');
  await expect(action).toBeFocused();
  await page.locator('#after').click();
  await expect(popover.locator('[part=popover]')).toBeHidden();

  await popover.evaluate((element) => {
    (element as HTMLElement & { modal: boolean }).modal = true;
  });
  await trigger.focus();
  await trigger.press('Enter');
  const surface = popover.locator('[part=popover]');
  await expect(surface).toHaveAttribute('aria-modal', 'true');
  const close = popover.getByRole('button', { name: 'Close' });
  await action.focus();
  await action.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(action).toBeFocused();
  await action.press('Escape');
  await expect(surface).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('dialog uses native modal semantics and returns focus', async ({ page }) => {
  const dialog = page.locator('#dialog');
  const before = page.locator('#before');
  await before.focus();
  await dialog.evaluate((element) => {
    (element as HTMLElement & { open: boolean }).open = true;
  });
  const nativeDialog = dialog.locator('dialog');
  await expect(nativeDialog).toBeVisible();
  await expect(nativeDialog).toHaveAccessibleName('Confirm details');
  await expect(dialog.getByRole('banner')).toHaveCount(0);
  await expect.poll(() => nativeDialog.evaluate((element) => element.matches(':modal'))).toBe(true);
  const action = dialog.getByRole('button', { name: 'Continue' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await action.focus();
  await action.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(action).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nativeDialog).toBeHidden();
  await expect(before).toBeFocused();

  await dialog.evaluate((element) => {
    const value = element as HTMLElement & { modal: boolean; open: boolean };
    value.modal = false;
    value.open = true;
  });
  await expect.poll(() => nativeDialog.evaluate((element) => element.matches(':modal'))).toBe(false);
  await expect(action).toBeVisible();
  await action.focus();
  await dialog.evaluate((element) => {
    (element as HTMLElement & { modal: boolean }).modal = true;
  });
  await expect.poll(() => nativeDialog.evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect(action).toBeFocused();
  await close.click();
  await expect(nativeDialog).toBeHidden();
});

test('dialog focus containment skips hidden slotted controls', async ({ page }) => {
  const dialog = page.locator('#focus-dialog');
  await dialog.evaluate((element) => {
    (element as HTMLElement & { open: boolean }).open = true;
  });
  const close = dialog.getByRole('button', { name: 'Close' });
  const real = dialog.getByRole('button', { name: 'Real' });
  await close.focus();
  await close.press('Shift+Tab');
  await expect(real).toBeFocused();
});

test('dialog focus containment follows nested shadow controls', async ({ page }) => {
  const dialog = page.locator('#nested-dialog');
  await dialog.evaluate((element) => {
    (element as HTMLElement & { open: boolean }).open = true;
  });
  const close = dialog.getByRole('button', { name: 'Close' });
  const nested = dialog.getByRole('button', { name: 'Nested control' });
  await nested.focus();
  await nested.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(nested).toBeFocused();
});

test('drawer keeps inline and modal modes separate', async ({ page }) => {
  const drawer = page.locator('#drawer');
  await drawer.evaluate((element) => {
    (element as HTMLElement & { open: boolean }).open = true;
  });
  await expect(drawer.locator('[part=inline]')).toBeVisible();
  await expect(drawer.locator('dialog')).toHaveCount(0);
  const drawerAction = drawer.getByRole('button', { name: 'Drawer action' });
  await drawerAction.focus();
  await drawer.evaluate((element) => {
    const value = element as HTMLElement & { mode: string };
    value.mode = 'modal';
  });
  await expect(drawer.locator('[part=modal]')).toBeVisible();
  await expect.poll(() => drawer.locator('dialog').evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect(drawerAction).toBeFocused();
  await drawer.evaluate((element) => {
    const value = element as HTMLElement & { mode: string };
    value.mode = 'inline';
  });
  await expect(drawer.locator('[part=inline]')).toBeVisible();
  await expect(drawerAction).toBeFocused();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer.locator('dialog')).toBeHidden();
});

test('drawer modal traps Tab and returns focus to the opener', async ({ page }) => {
  const drawer = page.locator('#drawer');
  const before = page.locator('#before');
  await before.focus();
  await drawer.evaluate((element) => {
    const value = element as HTMLElement & { mode: string; open: boolean };
    value.mode = 'modal';
    value.open = true;
  });
  await expect.poll(() => drawer.locator('dialog').evaluate((element) => element.matches(':modal'))).toBe(true);
  const close = drawer.getByRole('button', { name: 'Close' });
  const action = drawer.getByRole('button', { name: 'Drawer action' });
  // Focus order inside the surface is Close then the slotted action: Tab at
  // the last control wraps to the first and Shift+Tab at the first wraps back.
  await action.focus();
  await action.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(action).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer.locator('dialog')).toBeHidden();
  await expect(before).toBeFocused();
});

test('drawer modal traps Tab even when native showModal is unavailable', async ({ page }) => {
  const drawer = page.locator('#drawer');
  await page.locator('#before').focus();
  await drawer.evaluate(async (element) => {
    const host = element as HTMLElement & {
      mode: string;
      open: boolean;
      updateComplete: Promise<boolean>;
      shadowRoot: ShadowRoot | null;
    };
    host.mode = 'modal';
    await host.updateComplete;
    const dialog = host.shadowRoot?.querySelector('dialog');
    if (dialog !== null && dialog !== undefined)
      Object.defineProperty(dialog, 'showModal', { value: undefined, configurable: true });
    host.open = true;
  });
  const surface = drawer.locator('dialog');
  await expect(surface).toBeVisible();
  const close = drawer.getByRole('button', { name: 'Close' });
  const action = drawer.getByRole('button', { name: 'Drawer action' });
  await action.focus();
  await action.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(action).toBeFocused();
});

test('toast, alert and progress expose honest status states', async ({ page }) => {
  const toast = page.locator('#toast');
  await toast.evaluate((element) => {
    (element as HTMLElement & { open: boolean }).open = true;
  });
  await expect(toast.locator('[role=status]')).toBeVisible();
  await expect(toast.locator('[role=status]')).toBeHidden();
  await toast.evaluate((element) => {
    const value = element as HTMLElement & { open: boolean; tone: string; duration: number };
    value.tone = 'danger';
    value.duration = 20;
    value.open = true;
  });
  await page.waitForTimeout(80);
  await expect(toast.locator('[role=alert]')).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss' }).click();

  const alert = page.locator('#alert');
  await expect(alert.locator('[role=alert]')).toBeVisible();
  await alert.getByRole('button', { name: 'Review' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as typeof window & { aeliqoFeedbackEvents: CustomEvent[] }).aeliqoFeedbackEvents;
        return events?.[events.length - 1]?.detail;
      }),
    )
    .toMatchObject({ source: 'user' });
  await alert.getByRole('button', { name: 'Dismiss' }).click();
  await expect(alert.locator('[role=alert]')).toBeHidden();

  const determinate = page.locator('#determinate').locator('progress');
  await expect(determinate).toHaveAttribute('value', '100');
  const indeterminate = page.locator('#indeterminate').locator('[role=progressbar]');
  await expect(indeterminate).toHaveAttribute('aria-valuetext', 'In progress');
  await expect(indeterminate).not.toHaveAttribute('aria-valuenow', /./);

  const skeleton = page.locator('#skeleton').locator('[part=skeleton]');
  await expect(skeleton).toHaveRole('status');
  await expect(skeleton).toHaveAttribute('aria-label', 'Loading records');
  await expect(skeleton.locator('[part=line]')).toHaveCount(3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      skeleton
        .locator('[part=line]')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe('none');
  const empty = page.locator('#empty');
  await expect(empty.locator('[part=state]')).toHaveAttribute('data-kind', 'no-matches');
  await empty.getByRole('button', { name: 'Clear filter' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as typeof window & { aeliqoFeedbackEvents: CustomEvent[] }).aeliqoFeedbackEvents;
        return events?.[events.length - 1]?.detail;
      }),
    )
    .toMatchObject({ kind: 'no-matches', source: 'user' });
  await empty.evaluate((element) => {
    (element as HTMLElement & { kind: string }).kind = 'forbidden';
  });
  await expect(empty.locator('[role=alert]')).toHaveAttribute('data-kind', 'forbidden');
  await empty.evaluate((element) => {
    (element as HTMLElement & { kind: string }).kind = 'loading';
  });
  await expect(empty.locator('[role=status]')).toHaveAttribute('aria-busy', 'true');
  await expect(empty.getByRole('button', { name: 'Clear filter' })).toHaveCount(0);
  await empty.evaluate((element) => {
    (element as HTMLElement & { kind: string }).kind = 'failure';
  });
  await expect(empty.locator('[role=alert]')).toHaveAttribute('data-kind', 'failure');
});

test('feedback remains usable at narrow RTL text scale', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.locator('html').evaluate((element) => {
    (element as HTMLElement).dir = 'rtl';
  });
  await page.locator('body').evaluate((element) => {
    element.style.fontSize = '125%';
  });
  await expect(page.locator('#tooltip button')).toBeVisible();
  await expect(page.locator('#alert [part=alert]')).toBeVisible();
  const overflow = await page.locator('#fixture').evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
});

test('nonmodal popover does not steal focus on open or listener policy updates', async ({ page }) => {
  const popover = page.locator('#popover');
  const trigger = popover.getByRole('button', { name: 'Details' });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(popover.locator('[part=popover]')).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.locator('#before').focus();
  await popover.evaluate(async (el: any) => {
    el.closeOnOutside = false;
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('#before')).toBeFocused();
});

test.describe('enlarged narrow feedback controls', () => {
  test.use({ hasTouch: true });

  test('dialog keeps its close control and focus paint inside the surface', async ({ page }, info) => {
    for (const width of [320, 360]) {
      for (const direction of ['ltr', 'rtl']) {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '32px';
        });
        const host = page.locator('#dialog');
        await host.evaluate((element, dir) => {
          element.setAttribute('dir', dir);
          element.setAttribute('data-aeliqo-theme', 'dark');
          Object.assign(element, { heading: 'Confirm archive', open: true });
        }, direction);
        const close = host.locator('[part=close]');
        await close.focus();
        await expect(close).toBeFocused();
        const geometry = await close.evaluate((button) => {
          const surface = button.closest('dialog')!;
          const bounds = surface.getBoundingClientRect();
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const focus = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
          return {
            left: rect.left - focus,
            right: rect.right + focus,
            top: rect.top - focus,
            bottom: rect.bottom + focus,
            surfaceLeft: bounds.left,
            surfaceRight: bounds.right,
            surfaceTop: bounds.top,
            surfaceBottom: bounds.bottom,
            width: rect.width,
            height: rect.height,
          };
        });
        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.left).toBeGreaterThanOrEqual(geometry.surfaceLeft);
        expect(geometry.right).toBeLessThanOrEqual(geometry.surfaceRight);
        expect(geometry.top).toBeGreaterThanOrEqual(geometry.surfaceTop);
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.surfaceBottom);
        const headingWord = await host.locator('h2').evaluate((heading) => {
          const range = document.createRange();
          const text = Array.from(heading.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Confirm'),
          );
          if (text === undefined) throw new Error('Heading text is missing.');
          range.setStart(text, 0);
          range.setEnd(text, 'Confirm'.length);
          return {
            rects: Array.from(range.getClientRects(), (rect) => rect.toJSON()),
            font: getComputedStyle(heading).font,
            heading: heading.getBoundingClientRect().toJSON(),
          };
        });
        expect(headingWord.rects, JSON.stringify({ width, direction, ...headingWord })).toHaveLength(1);
        const action = host.getByRole('button', { name: 'Continue' });
        const actionBox = await action.boundingBox();
        expect(actionBox).not.toBeNull();
        expect(actionBox!.x).toBeGreaterThanOrEqual(geometry.surfaceLeft);
        expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(geometry.surfaceRight);
        expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(geometry.surfaceBottom);
        expect(actionBox!.width).toBeGreaterThanOrEqual(44);
        expect(actionBox!.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: info.outputPath(`dialog-${width}-${direction}.png`) });
        await close.press('Enter');
        await expect(host.locator('dialog')).toBeHidden();
      }
    }
  });

  test('popover close uses readable theme paint and a square touch target', async ({ page }, info) => {
    for (const width of [320, 360]) {
      for (const direction of ['ltr', 'rtl']) {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '32px';
        });
        const host = page.locator('#popover');
        await host.evaluate((element, dir) => {
          element.setAttribute('dir', dir);
          element.setAttribute('data-aeliqo-theme', 'dark');
          Object.assign(element, { content: 'The report includes the authorized current scope.', open: true });
        }, direction);
        const close = host.locator('[part=close]');
        await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        const box = await close.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await close.focus();
        await expect(close).toBeFocused();
        await expect(close).toHaveCSS('outline-style', 'solid');
        await page.screenshot({ path: info.outputPath(`popover-${width}-${direction}.png`) });
        await close.press('Enter');
        await expect(host.locator('[part=popover]')).toBeHidden();
      }
    }
  });
});
