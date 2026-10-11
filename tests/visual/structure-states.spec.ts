import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport, type ReviewVariant } from './review-variants.js';

type ReviewWindow = Window & {
  aeliqoReviewReady?: boolean;
  structureStateEvents?: readonly { type: string; detail: Record<string, unknown> }[];
};

type ReviewSession = {
  readonly errors: string[];
  readonly host: Locator;
  readonly id: string;
  readonly variant: ReviewVariant;
};

async function openCatalog(page: Page, info: TestInfo, id: string, variant: ReviewVariant): Promise<ReviewSession> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(reviewViewport(variant));
  await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
  await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
  await page.waitForFunction(() => Boolean((window as ReviewWindow).aeliqoReviewReady));
  const host = page.locator(`#fixture aeliqo-${id}`).first();
  await expect(host).toBeAttached();
  await page.evaluate(() => {
    const events: { type: string; detail: Record<string, unknown> }[] = [];
    for (const type of [
      'aeliqo-action',
      'aeliqo-navigation',
      'aeliqo-tabs-change',
      'aeliqo-menu-action',
      'aeliqo-page-change',
      'aeliqo-tree-nav-select',
      'aeliqo-tree-nav-expand',
      'aeliqo-popover-close',
      'aeliqo-dialog-close',
      'aeliqo-drawer-close',
      'aeliqo-toast-dismiss',
      'aeliqo-alert-dismiss',
      'aeliqo-alert-action',
      'aeliqo-empty-state-action',
    ]) {
      document.addEventListener(type, (event) =>
        events.push({ type, detail: (event as CustomEvent).detail as Record<string, unknown> }),
      );
    }
    (window as ReviewWindow).structureStateEvents = events;
  });
  return { errors, host, id, variant };
}

async function events(page: Page): Promise<readonly { type: string; detail: Record<string, unknown> }[]> {
  return page.evaluate(() => (window as ReviewWindow).structureStateEvents ?? []);
}

async function capture(session: ReviewSession, page: Page, info: TestInfo, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  await info.attach('accessibility.json', {
    body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
    contentType: 'application/json',
  });
  await info.attach('state.json', {
    body: JSON.stringify(
      {
        id: session.id,
        variant: session.variant,
        browser: page.context().browser()?.version(),
        project: info.project.name,
        label,
        events: await events(page),
        semantics: await session.host.ariaSnapshot(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
  expect(session.errors).toEqual([]);
  expect(axe.violations).toEqual([]);
}

async function setHostProperty(host: Locator, property: string, value: unknown): Promise<void> {
  await host.evaluate(
    async (element, change) => {
      (element as HTMLElement & Record<string, unknown>)[change.property] = change.value;
      await (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
    },
    { property, value },
  );
}

for (const variant of REVIEW_VARIANTS) {
  test.describe(variant, () => {
    for (const id of ['button', 'icon-button'] as const) {
      test(`${id} disabled and action-busy states remain native`, async ({ page }, info) => {
        const session = await openCatalog(page, info, id, variant);
        await setHostProperty(session.host, 'disabled', true);
        await expect(session.host.locator('button')).toBeDisabled();
        await session.host.locator('button').dispatchEvent('click');
        expect((await events(page)).filter((event) => event.type === 'aeliqo-action')).toHaveLength(0);

        await setHostProperty(session.host, 'disabled', false);
        await setHostProperty(session.host, 'pending', true);
        await expect(session.host.locator('button')).toBeDisabled();
        await expect(session.host.locator('button')).toHaveAttribute('aria-busy', 'true');
        await expect(session.host.locator('[part="pending"]')).toBeVisible();
        await session.host.locator('button').dispatchEvent('click');
        expect((await events(page)).filter((event) => event.type === 'aeliqo-action')).toHaveLength(0);
        await capture(session, page, info, `${id}-busy`);
      });
    }

    test(`link disabled state removes navigation affordance`, async ({ page }, info) => {
      const session = await openCatalog(page, info, 'link', variant);
      await setHostProperty(session.host, 'disabled', true);
      await expect(session.host.locator('a')).toHaveCount(0);
      await expect(session.host.locator('[part="link"]')).toHaveAttribute('aria-disabled', 'true');
      await capture(session, page, info, 'link-disabled');
    });

    test('breadcrumb preserves current-location semantics and approved navigation intent', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'breadcrumb', variant);
      const breadcrumb = session.host;
      await expect(breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Weekly report');
      await breadcrumb.evaluate((element) =>
        element.addEventListener('aeliqo-navigation', (event) => event.preventDefault()),
      );
      const before = page.url();
      await breadcrumb.getByRole('link', { name: 'Home' }).click();
      expect(page.url()).toBe(before);
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          type: 'aeliqo-navigation',
          detail: expect.objectContaining({ id: 'home', source: 'user' }),
        }),
      );
      await capture(session, page, info, 'breadcrumb-current');
    });

    test(`split pane disabled state blocks keyboard resizing`, async ({ page }, info) => {
      const session = await openCatalog(page, info, 'split-pane', variant);
      await setHostProperty(session.host, 'disabled', true);
      const splitter = session.host.locator('[part="splitter"]');
      const before = await splitter.getAttribute('aria-valuenow');
      await expect(splitter).toHaveAttribute('aria-disabled', 'true');
      await expect(splitter).toHaveAttribute('tabindex', '-1');
      await splitter.dispatchEvent('keydown', { key: 'ArrowRight' });
      await expect(splitter).toHaveAttribute('aria-valuenow', before ?? '42');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-action')).toHaveLength(0);
      await capture(session, page, info, 'split-pane-disabled');
    });

    test('tabs commit selection by stable ID and keep disabled history unavailable', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'tabs', variant);
      const tabs = session.host;
      await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
      await tabs.getByRole('tab', { name: 'Details' }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          type: 'aeliqo-tabs-change',
          detail: expect.objectContaining({ id: 'details', previousId: 'overview', source: 'user' }),
        }),
      );
      await expect(tabs.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
      await setHostProperty(tabs, 'value', 'details');
      await expect(tabs.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.getByRole('tabpanel', { name: 'Details' })).toBeVisible();

      const history = tabs.getByRole('tab', { name: 'History' });
      await expect(history).toBeDisabled();
      await history.dispatchEvent('click');
      expect(
        (await events(page)).filter((event) => event.type === 'aeliqo-tabs-change' && event.detail.id === 'history'),
      ).toHaveLength(0);
      await capture(session, page, info, 'tabs-selected');
    });

    test('menu skips disabled actions, closes on Escape, and restores trigger focus', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'menu', variant);
      const menu = session.host;
      const trigger = menu.getByRole('button', { name: 'Report actions' });
      const disabled = menu.getByRole('menuitem', { name: 'Unavailable' });
      await setHostProperty(menu, 'open', false);
      await expect(trigger).not.toBeFocused();
      await trigger.click();
      await expect(menu.getByRole('menu')).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Open report' })).toBeFocused();
      await menu.getByRole('menuitem', { name: 'Open report' }).press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeFocused();
      await disabled.dispatchEvent('click');
      await expect(menu.getByRole('menu')).toBeVisible();
      expect((await events(page)).filter((event) => event.type === 'aeliqo-menu-action')).toHaveLength(0);
      await menu.getByRole('menuitem', { name: 'Archive' }).press('Escape');
      await expect(menu.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');
      await expect(menu.getByRole('menuitem', { name: 'Open report' })).toBeFocused();
      await menu.getByRole('menuitem', { name: 'Open report' }).press('Escape');
      await expect(trigger).toBeFocused();
      await capture(session, page, info, 'menu-dismissed');
    });

    test('pagination blocks pending changes and commits an enabled page request', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'pagination', variant);
      const pagination = session.host;
      const next = pagination.getByRole('button', { name: 'Next page' });
      await setHostProperty(pagination, 'pending', true);
      await expect(next).toBeDisabled();
      await next.dispatchEvent('click');
      await expect(pagination.locator('[part="status"]')).toHaveText('Page 2 of 4');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-page-change')).toHaveLength(0);
      await setHostProperty(pagination, 'pending', false);
      await next.click();
      await expect(pagination.locator('[part="status"]')).toHaveText('Page 3 of 4');
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          type: 'aeliqo-page-change',
          detail: expect.objectContaining({ page: 3, previousPage: 2, direction: 'next', source: 'user' }),
        }),
      );
      await capture(session, page, info, 'pagination-page-change');
    });

    test('pagination disables both directions at a known single-page boundary', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'pagination', variant);
      const pagination = session.host;
      await setHostProperty(pagination, 'page', 1);
      await setHostProperty(pagination, 'pageCount', 1);
      await setHostProperty(pagination, 'hasPrevious', false);
      await setHostProperty(pagination, 'hasNext', false);
      await expect(pagination.locator('[part="status"]')).toHaveText('Page 1 of 1');
      await expect(pagination.getByRole('button', { name: 'Previous page' })).toBeDisabled();
      await expect(pagination.getByRole('button', { name: 'Next page' })).toBeDisabled();
      await capture(session, page, info, 'pagination-single-page');
    });

    test('tree navigation selects enabled IDs and leaves disabled nodes inert', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'tree-nav', variant);
      const tree = session.host;
      const settings = tree.getByRole('treeitem', { name: 'Settings' });
      await expect(tree.getByRole('treeitem', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
      await expect(settings).toHaveAttribute('aria-disabled', 'true');
      await settings.dispatchEvent('click');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-tree-nav-select')).toHaveLength(0);
      await tree.getByRole('treeitem', { name: 'Monthly' }).click();
      await expect(tree.getByRole('treeitem', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'true');
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          type: 'aeliqo-tree-nav-select',
          detail: expect.objectContaining({ id: 'monthly', previousId: 'weekly', source: 'user' }),
        }),
      );
      const reports = tree.getByRole('treeitem', { name: 'Reports' });
      await reports.getByRole('button', { name: 'Collapse' }).click();
      await expect(tree.getByRole('treeitem', { name: 'Weekly' })).toHaveCount(0);
      await reports.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByRole('treeitem', { name: 'Weekly' })).toBeVisible();
      await capture(session, page, info, 'tree-selected');
    });

    test('tooltip opens on focus and closes on Escape', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'tooltip', variant);
      const tooltip = session.host;
      const trigger = tooltip.getByRole('button', { name: 'More information' });
      await setHostProperty(tooltip, 'open', false);
      await trigger.focus();
      await expect(tooltip.getByRole('tooltip')).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-describedby', /content/);
      await trigger.press('Escape');
      await expect(tooltip.getByRole('tooltip')).toBeHidden();
      await expect(trigger).toBeFocused();
      await capture(session, page, info, 'tooltip-escape');
    });

    test('nonmodal popover dismisses outside while modal mode traps focus and Escape closes', async ({
      page,
    }, info) => {
      const session = await openCatalog(page, info, 'popover', variant);
      const popover = session.host;
      const trigger = popover.getByRole('button', { name: 'Report details' });
      await setHostProperty(popover, 'open', false);
      await trigger.click();
      await expect(popover.locator('[part="popover"]')).toBeVisible();
      await expect(popover.getByRole('button', { name: 'Close' })).not.toBeFocused();
      await page.locator('h1').click();
      await expect(popover.locator('[part="popover"]')).toBeHidden();

      await trigger.focus();
      await trigger.press('Enter');
      await expect(popover.locator('[part="popover"]')).toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.press('Escape');
      await expect(popover.locator('[part="popover"]')).toBeHidden();
      await expect(trigger).toBeFocused();

      await setHostProperty(popover, 'modal', true);
      await trigger.focus();
      await trigger.press('Enter');
      await expect(popover.locator('dialog[part="popover"]')).toBeVisible();
      await expect.poll(() => popover.locator('dialog').evaluate((element) => element.matches(':modal'))).toBe(true);
      await expect(popover.getByRole('button', { name: 'Close' })).toBeFocused();
      await popover.getByRole('button', { name: 'Close' }).press('Escape');
      await expect(popover.locator('dialog[part="popover"]')).toBeHidden();
      await expect(trigger).toBeFocused();
      await capture(session, page, info, 'popover-modal-escape');
    });

    test('dialog honors Escape policy and returns focus after close', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'dialog', variant);
      const dialog = session.host;
      const nativeDialog = dialog.locator('dialog');
      const trigger = page.getByRole('button', { name: 'Open confirmation' });
      await trigger.click();
      await expect(nativeDialog).toBeVisible();
      await expect.poll(() => nativeDialog.evaluate((element) => element.matches(':modal'))).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Close' }).press('Escape');
      await expect(nativeDialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await setHostProperty(dialog, 'closeOnEscape', false);
      await setHostProperty(dialog, 'open', true);
      await expect(nativeDialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).press('Escape');
      await expect(nativeDialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(nativeDialog).toBeHidden();
      await capture(session, page, info, 'dialog-escape-policy');
    });

    test('drawer preserves inline disclosure and modal Escape closure', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'drawer', variant);
      const drawer = session.host;
      await expect(drawer.locator('[part="inline"]')).toBeVisible();
      await setHostProperty(drawer, 'open', false);
      await expect(drawer.locator('[part="inline"]')).toBeHidden();
      await setHostProperty(drawer, 'mode', 'modal');
      await setHostProperty(drawer, 'open', true);
      await expect(drawer.locator('dialog[part="modal"]')).toBeVisible();
      await expect.poll(() => drawer.locator('dialog').evaluate((element) => element.matches(':modal'))).toBe(true);
      await drawer.getByRole('button', { name: 'Close' }).press('Escape');
      await expect(drawer.locator('dialog[part="modal"]')).toBeHidden();
      await capture(session, page, info, 'drawer-modal-escape');
    });

    test('toast distinguishes persistent danger feedback from dismissible success feedback', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'toast', variant);
      const toast = session.host;
      await expect(toast.locator('[role="status"]')).toBeVisible();
      await toast.getByRole('button', { name: 'Dismiss' }).click();
      await expect(toast.locator('[role="status"]')).toBeHidden();
      await setHostProperty(toast, 'tone', 'danger');
      await setHostProperty(toast, 'duration', 10);
      await setHostProperty(toast, 'open', true);
      await expect(toast.locator('[role="alert"]')).toBeVisible();
      await page.waitForTimeout(40);
      await expect(toast.locator('[role="alert"]')).toBeVisible();
      await toast.getByRole('button', { name: 'Dismiss' }).click();
      await expect(toast.locator('[role="alert"]')).toBeHidden();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({ type: 'aeliqo-toast-dismiss', detail: expect.objectContaining({ source: 'user' }) }),
      );
      await capture(session, page, info, 'toast-danger-dismiss');
    });

    test('alert action and dismissal preserve live status semantics', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'alert', variant);
      const alert = session.host;
      await expect(alert.locator('[role="alert"]')).toBeVisible();
      await alert.getByRole('button', { name: 'Inspect' }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({ type: 'aeliqo-alert-action', detail: expect.objectContaining({ source: 'user' }) }),
      );
      await alert.getByRole('button', { name: 'Dismiss' }).click();
      await expect(alert.locator('[role="alert"]')).toBeHidden();
      await setHostProperty(alert, 'tone', 'info');
      await setHostProperty(alert, 'open', true);
      await expect(alert.locator('[role="status"]')).toBeVisible();
      await capture(session, page, info, 'alert-status');
    });

    test('progress exposes determinate and indeterminate states without false values', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'progress', variant);
      const progress = session.host;
      await expect(progress.locator('progress')).toHaveAttribute('value', '62');
      await setHostProperty(progress, 'value', 120);
      await expect(progress.locator('progress')).toHaveAttribute('value', '100');
      await setHostProperty(progress, 'value', undefined);
      await expect(progress.locator('[role="progressbar"]')).toHaveAttribute('aria-valuetext', 'In progress');
      await expect(progress.locator('[role="progressbar"]')).not.toHaveAttribute('aria-valuenow', /./);
      await capture(session, page, info, 'progress-indeterminate');
    });

    test('empty and loading feedback states expose truthful live regions', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'empty-state', variant);
      const empty = session.host;
      await expect(empty.locator('[part="state"]')).toHaveAttribute('data-kind', 'no-matches');
      await empty.getByRole('button', { name: 'Clear filters' }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          type: 'aeliqo-empty-state-action',
          detail: expect.objectContaining({ kind: 'no-matches', source: 'user' }),
        }),
      );
      await setHostProperty(empty, 'kind', 'loading');
      await expect(empty.locator('[role="status"]')).toHaveAttribute('aria-busy', 'true');
      await expect(empty.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
      await setHostProperty(empty, 'kind', 'failure');
      await expect(empty.locator('[role="alert"]')).toBeVisible();
      await capture(session, page, info, 'empty-failure');
    });

    test('skeleton loading geometry respects reduced motion and alternate shape', async ({ page }, info) => {
      const session = await openCatalog(page, info, 'skeleton', variant);
      const skeleton = session.host;
      await expect(skeleton.locator('[part="skeleton"]')).toHaveRole('status');
      await expect(skeleton.locator('[part="skeleton"]')).toHaveAttribute('aria-busy', 'true');
      await setHostProperty(skeleton, 'variant', 'rect');
      await setHostProperty(skeleton, 'animated', true);
      await expect(skeleton.locator('[part="skeleton"]')).toHaveAttribute('data-variant', 'rect');
      await expect(skeleton.locator('[part="line"]')).toHaveCount(1);
      await expect
        .poll(() => skeleton.locator('[part="line"]').evaluate((element) => getComputedStyle(element).animationName))
        .toBe('none');
      await capture(session, page, info, 'skeleton-rect');
    });
  });
}
